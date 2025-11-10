const Message = require('../models/Message');
const Room = require('../models/Room');
const User = require('../models/User');
const logger = require('../config/logger');

class MessageService {
    /**
     * Send encrypted message (direct or group)
     */
    async sendMessage(senderId, senderDeviceId, messageData) {
        const {
            messageId,
            recipientId,
            roomId,
            messageType,
            encryptedContent,
            encryptionMetadata,
            expiresIn
        } = messageData;

        // Validate message type
        if (messageType === 'direct' && !recipientId) {
            throw new Error('Recipient ID required for direct messages');
        }

        if (messageType === 'group' && !roomId) {
            throw new Error('Room ID required for group messages');
        }

        // Check if message ID already exists (idempotency)
        const existingMessage = await Message.findOne({ messageId });
        if (existingMessage) {
            return existingMessage;
        }

        // Prepare message document
        const messageDoc = {
            messageId,
            senderId,
            senderDeviceId,
            messageType,
            encryptedContent,
            encryptionMetadata,
            deliveryStatus: 'sent'
        };

        // Handle direct messages
        if (messageType === 'direct') {
            const recipient = await User.findById(recipientId);
            if (!recipient) {
                throw new Error('Recipient not found');
            }

            messageDoc.recipientId = recipientId;
        }

        // Handle group messages
        if (messageType === 'group') {
            const room = await Room.findById(roomId);
            if (!room) {
                throw new Error('Room not found');
            }

            // Verify sender is participant
            if (!room.isParticipant(senderId)) {
                throw new Error('Not a member of this room');
            }

            messageDoc.roomId = roomId;

            // Initialize recipient statuses for group message
            messageDoc.recipientStatuses = room.participants
                .filter(p => p.userId.toString() !== senderId.toString())
                .map(p => ({
                    recipientId: p.userId,
                    status: 'sent'
                }));

            // Update room last activity
            room.lastActivity = new Date();
            await room.save();
        }

        // Set expiration if provided
        if (expiresIn) {
            messageDoc.expiresAt = new Date(Date.now() + expiresIn * 1000);
        }

        // Save message
        const message = await Message.create(messageDoc);

        logger.info({
            messageId,
            senderId,
            messageType,
            recipientId,
            roomId
        }, 'Message sent');

        return message;
    }

    /**
     * Get messages for a conversation (direct chat)
     */
    async getDirectMessages(userId, otherUserId, options = {}) {
        const { limit = 50, before, after } = options;

        const query = {
            messageType: 'direct',
            isDeleted: false,
            $or: [
                { senderId: userId, recipientId: otherUserId },
                { senderId: otherUserId, recipientId: userId }
            ]
        };

        if (before) {
            query.createdAt = { $lt: new Date(before) };
        }

        if (after) {
            query.createdAt = { $gt: new Date(after) };
        }

        const messages = await Message.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('-__v')
            .lean();

        return messages.reverse(); // Return in chronological order
    }

    /**
     * Get messages for a room (group chat)
     */
    async getRoomMessages(userId, roomId, options = {}) {
        const { limit = 50, before, after } = options;

        // Verify user is room member
        const room = await Room.findById(roomId);
        if (!room || !room.isParticipant(userId)) {
            throw new Error('Not authorized to view room messages');
        }

        const query = {
            roomId,
            messageType: 'group',
            isDeleted: false
        };

        if (before) {
            query.createdAt = { $lt: new Date(before) };
        }

        if (after) {
            query.createdAt = { $gt: new Date(after) };
        }

        const messages = await Message.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('-__v')
            .lean();

        return messages.reverse();
    }

    /**
     * Get offline messages for user
     */
    async getOfflineMessages(userId, deviceId, lastSyncTime) {
        const query = {
            isDeleted: false,
            createdAt: { $gt: new Date(lastSyncTime) },
            $or: [
                { recipientId: userId, messageType: 'direct' },
                {
                    messageType: 'group',
                    'recipientStatuses.recipientId': userId
                }
            ]
        };

        const messages = await Message.find(query)
            .sort({ createdAt: 1 })
            .limit(1000) // Cap at 1000 messages
            .select('-__v')
            .lean();

        logger.info({ userId, deviceId, count: messages.length }, 'Offline messages retrieved');

        return messages;
    }

    /**
     * Mark message as delivered
     */
    async markDelivered(messageId, recipientId, deviceId) {
        const message = await Message.findOne({ messageId });
        if (!message) {
            throw new Error('Message not found');
        }

        await message.markDelivered(recipientId, deviceId);

        return message;
    }

    /**
     * Mark message as read
     */
    async markRead(messageId, recipientId, deviceId) {
        const message = await Message.findOne({ messageId });
        if (!message) {
            throw new Error('Message not found');
        }

        await message.markRead(recipientId, deviceId);

        return message;
    }

    /**
     * Bulk update delivery status
     */
    async bulkUpdateStatus(messageIds, recipientId, deviceId, status) {
        const messages = await Message.find({
            messageId: { $in: messageIds }
        });

        const updatePromises = messages.map(message => {
            if (status === 'delivered') {
                return message.markDelivered(recipientId, deviceId);
            } else if (status === 'read') {
                return message.markRead(recipientId, deviceId);
            }
        });

        await Promise.all(updatePromises);

        logger.info({
            recipientId,
            deviceId,
            count: messageIds.length,
            status
        }, 'Bulk status update');

        return { updated: messageIds.length };
    }

    /**
     * Delete message (soft delete)
     */
    async deleteMessage(messageId, userId) {
        const message = await Message.findOne({ messageId });
        if (!message) {
            throw new Error('Message not found');
        }

        // Only sender can delete
        if (message.senderId.toString() !== userId.toString()) {
            throw new Error('Not authorized to delete this message');
        }

        await message.softDelete();

        logger.info({ messageId, userId }, 'Message deleted');

        return message;
    }

    /**
     * Get conversation list for user
     */
    async getConversations(userId, limit = 20) {
        // Get direct conversations
        const directMessages = await Message.aggregate([
            {
                $match: {
                    messageType: 'direct',
                    isDeleted: false,
                    $or: [{ senderId: userId }, { recipientId: userId }]
                }
            },
            {
                $sort: { createdAt: -1 }
            },
            {
                $group: {
                    _id: {
                        $cond: [
                            { $eq: ['$senderId', userId] },
                            '$recipientId',
                            '$senderId'
                        ]
                    },
                    lastMessage: { $first: '$$ROOT' },
                    unreadCount: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ['$recipientId', userId] },
                                        { $ne: ['$deliveryStatus', 'read'] }
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            },
            {
                $sort: { 'lastMessage.createdAt': -1 }
            },
            {
                $limit: limit
            }
        ]);

        // Get rooms
        const rooms = await Room.find({
            'participants.userId': userId,
            isActive: true
        })
            .sort({ lastActivity: -1 })
            .limit(limit)
            .lean();

        // Get last message for each room
        const roomConversations = await Promise.all(
            rooms.map(async (room) => {
                const lastMessage = await Message.findOne({
                    roomId: room._id,
                    isDeleted: false
                })
                    .sort({ createdAt: -1 })
                    .lean();

                const unreadCount = await Message.countDocuments({
                    roomId: room._id,
                    'recipientStatuses': {
                        $elemMatch: {
                            recipientId: userId,
                            status: { $ne: 'read' }
                        }
                    }
                });

                return {
                    _id: room._id,
                    type: 'group',
                    room,
                    lastMessage,
                    unreadCount
                };
            })
        );

        // Populate user info for direct conversations
        const directConversations = await User.populate(directMessages, {
            path: '_id',
            select: 'username displayName avatar isOnline lastSeen'
        });

        const formattedDirect = directConversations.map(conv => ({
            _id: conv._id._id,
            type: 'direct',
            user: conv._id,
            lastMessage: conv.lastMessage,
            unreadCount: conv.unreadCount
        }));

        // Combine and sort all conversations
        const allConversations = [...formattedDirect, ...roomConversations]
            .sort((a, b) => {
                const aTime = a.lastMessage?.createdAt || a.room?.lastActivity || 0;
                const bTime = b.lastMessage?.createdAt || b.room?.lastActivity || 0;
                return new Date(bTime) - new Date(aTime);
            })
            .slice(0, limit);

        return allConversations;
    }

    /**
     * Search messages (only metadata, not content since it's encrypted)
     */
    async searchMessages(userId, query) {
        // Can only search by sender, date range, etc. - NOT by content
        const { senderId, recipientId, roomId, startDate, endDate, limit = 50 } = query;

        const searchQuery = {
            isDeleted: false,
            $or: [
                { senderId: userId },
                { recipientId: userId },
                { 'recipientStatuses.recipientId': userId }
            ]
        };

        if (senderId) searchQuery.senderId = senderId;
        if (recipientId) searchQuery.recipientId = recipientId;
        if (roomId) searchQuery.roomId = roomId;

        if (startDate || endDate) {
            searchQuery.createdAt = {};
            if (startDate) searchQuery.createdAt.$gte = new Date(startDate);
            if (endDate) searchQuery.createdAt.$lte = new Date(endDate);
        }

        const messages = await Message.find(searchQuery)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        return messages;
    }
}

module.exports = new MessageService();