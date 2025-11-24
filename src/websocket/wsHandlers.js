const messageService = require('../services/messageService');
const presenceService = require('../services/presenceService');
const { getRedisPub } = require('../config/redis');
const logger = require('../config/logger');

class WebSocketHandlers {
    /**
     * Handle incoming WebSocket messages
     */
    async handleMessage(ws, data, userId, deviceId) {
        try {
            const message = JSON.parse(data);
            const { type, payload } = message;

            switch (type) {
                case 'message':
                    await this.handleChatMessage(ws, payload, userId, deviceId);
                    break;

                case 'typing':
                    await this.handleTyping(ws, payload, userId);
                    break;

                case 'stop_typing':
                    await this.handleStopTyping(ws, payload, userId);
                    break;

                case 'delivery_receipt':
                    await this.handleDeliveryReceipt(ws, payload, userId, deviceId);
                    break;

                case 'read_receipt':
                    await this.handleReadReceipt(ws, payload, userId, deviceId);
                    break;

                case 'heartbeat':
                    await this.handleHeartbeat(ws, userId, deviceId);
                    break;

                default:
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: 'Unknown message type'
                    }));
            }
        } catch (error) {
            logger.error({ err: error, userId }, 'Error handling WebSocket message');
            ws.send(JSON.stringify({
                type: 'error',
                error: error.message
            }));
        }
    }

    /**
     * Handle chat message
     */
    async handleChatMessage(ws, payload, userId, deviceId) {
        // Store message in database
        const message = await messageService.sendMessage(userId, deviceId, payload);

        // Publish to Redis for other server instances
        const pub = getRedisPub();
        await pub.publish('messages', JSON.stringify({
            type: 'new_message',
            message,
            senderId: userId
        }));

        // Send acknowledgment
        ws.send(JSON.stringify({
            type: 'message_sent',
            messageId: payload.messageId,
            timestamp: message.createdAt
        }));
    }

    /**
     * Handle typing indicator
     */
    async handleTyping(ws, payload, userId) {
        const { conversationId, conversationType } = payload;

        await presenceService.setTyping(userId, conversationId, conversationType);

        // Publish to Redis
        const pub = getRedisPub();
        await pub.publish(`typing:${conversationType}:${conversationId}`, JSON.stringify({
            userId,
            conversationId,
            conversationType,
            isTyping: true
        }));
    }

    /**
     * Handle stop typing
     */
    async handleStopTyping(ws, payload, userId) {
        const { conversationId, conversationType } = payload;

        await presenceService.stopTyping(userId, conversationId, conversationType);

        // Publish to Redis
        const pub = getRedisPub();
        await pub.publish(`typing:${conversationType}:${conversationId}`, JSON.stringify({
            userId,
            conversationId,
            conversationType,
            isTyping: false
        }));
    }

    /**
     * Handle delivery receipt
     */
    async handleDeliveryReceipt(ws, payload, userId, deviceId) {
        const { messageId } = payload;

        await messageService.markDelivered(messageId, userId, deviceId);

        // Publish to Redis
        const pub = getRedisPub();
        await pub.publish('receipts', JSON.stringify({
            type: 'delivered',
            messageId,
            userId,
            deviceId,
            timestamp: new Date().toISOString()
        }));
    }

    /**
     * Handle read receipt
     */
    async handleReadReceipt(ws, payload, userId, deviceId) {
        const { messageId } = payload;

        await messageService.markRead(messageId, userId, deviceId);

        // Publish to Redis
        const pub = getRedisPub();
        await pub.publish('receipts', JSON.stringify({
            type: 'read',
            messageId,
            userId,
            deviceId,
            timestamp: new Date().toISOString()
        }));
    }

    /**
     * Handle heartbeat/ping
     */
    async handleHeartbeat(ws, userId, deviceId) {
        await presenceService.heartbeat(userId, deviceId);

        ws.send(JSON.stringify({
            type: 'pong',
            timestamp: new Date().toISOString()
        }));
    }

    /**
     * Handle connection
     */
    async handleConnection(ws, userId, deviceId) {
        await presenceService.setOnline(userId, deviceId);

        // Send connection acknowledgment
        ws.send(JSON.stringify({
            type: 'connected',
            userId,
            deviceId,
            timestamp: new Date().toISOString()
        }));

        // Publish presence update
        const pub = getRedisPub();
        await pub.publish('presence', JSON.stringify({
            userId,
            deviceId,
            status: 'online',
            timestamp: new Date().toISOString()
        }));

        logger.info({ userId, deviceId }, 'WebSocket connected');
    }

    /**
     * Handle disconnection
     */
    async handleDisconnection(userId, deviceId, code, reason) {
        await presenceService.setOffline(userId, deviceId);

        // Publish presence update
        const pub = getRedisPub();
        await pub.publish('presence', JSON.stringify({
            userId,
            deviceId,
            status: 'offline',
            timestamp: new Date().toISOString()
        }));

        logger.info({ userId, deviceId, code, reason }, 'WebSocket disconnected');
    }
}

module.exports = new WebSocketHandlers();