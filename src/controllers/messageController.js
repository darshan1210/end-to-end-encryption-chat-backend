const messageService = require('../services/messageService');
const { asyncHandler } = require('../middleware/errorHandler');

class MessageController {
    /**
     * POST /api/messages/send
     */
    sendMessage = asyncHandler(async (req, res) => {
        const message = await messageService.sendMessage(
            req.userId,
            req.deviceId,
            req.body
        );

        res.status(201).json({
            success: true,
            data: message,
            message: 'Message sent successfully'
        });
    });

    /**
     * GET /api/messages/direct/:userId
     */
    getDirectMessages = asyncHandler(async (req, res) => {
        const { userId: otherUserId } = req.params;
        const { limit, before, after } = req.query;

        const messages = await messageService.getDirectMessages(
            req.userId,
            otherUserId,
            { limit: parseInt(limit), before, after }
        );

        res.status(200).json({
            success: true,
            data: messages,
            count: messages.length
        });
    });

    /**
     * GET /api/messages/room/:roomId
     */
    getRoomMessages = asyncHandler(async (req, res) => {
        const { roomId } = req.params;
        const { limit, before, after } = req.query;

        const messages = await messageService.getRoomMessages(
            req.userId,
            roomId,
            { limit: parseInt(limit), before, after }
        );

        res.status(200).json({
            success: true,
            data: messages,
            count: messages.length
        });
    });

    /**
     * GET /api/messages/offline
     */
    getOfflineMessages = asyncHandler(async (req, res) => {
        const { lastSyncTime } = req.query;

        if (!lastSyncTime) {
            return res.status(400).json({
                error: 'lastSyncTime query parameter required'
            });
        }

        const messages = await messageService.getOfflineMessages(
            req.userId,
            req.deviceId,
            lastSyncTime
        );

        res.status(200).json({
            success: true,
            data: messages,
            count: messages.length
        });
    });

    /**
     * PUT /api/messages/:messageId/status
     */
    updateStatus = asyncHandler(async (req, res) => {
        const { messageId } = req.params;
        const { status } = req.body;

        let result;
        if (status === 'delivered') {
            result = await messageService.markDelivered(messageId, req.userId, req.deviceId);
        } else if (status === 'read') {
            result = await messageService.markRead(messageId, req.userId, req.deviceId);
        } else {
            return res.status(400).json({ error: 'Invalid status' });
        }

        res.status(200).json({
            success: true,
            data: result
        });
    });

    /**
     * POST /api/messages/status/bulk
     */
    bulkUpdateStatus = asyncHandler(async (req, res) => {
        const { messageIds, status } = req.body;

        const result = await messageService.bulkUpdateStatus(
            messageIds,
            req.userId,
            req.deviceId,
            status
        );

        res.status(200).json({
            success: true,
            data: result
        });
    });

    /**
     * DELETE /api/messages/:messageId
     */
    deleteMessage = asyncHandler(async (req, res) => {
        const { messageId } = req.params;

        const result = await messageService.deleteMessage(messageId, req.userId);

        res.status(200).json({
            success: true,
            data: result,
            message: 'Message deleted successfully'
        });
    });

    /**
     * GET /api/messages/conversations
     */
    getConversations = asyncHandler(async (req, res) => {
        const { limit } = req.query;

        const conversations = await messageService.getConversations(
            req.userId,
            parseInt(limit) || 20
        );

        res.status(200).json({
            success: true,
            data: conversations,
            count: conversations.length
        });
    });

    /**
     * POST /api/messages/search
     */
    searchMessages = asyncHandler(async (req, res) => {
        const messages = await messageService.searchMessages(req.userId, req.body);

        res.status(200).json({
            success: true,
            data: messages,
            count: messages.length
        });
    });
}

module.exports = new MessageController();