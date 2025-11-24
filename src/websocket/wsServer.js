const WebSocket = require('ws');
const https = require('https');
const fs = require('fs');
const { authenticateWebSocket } = require('./wsAuth');
const wsHandlers = require('./wsHandlers');
const { getRedisSub } = require('../config/redis');
const logger = require('../config/logger');

class WebSocketServer {
    constructor() {
        this.clients = new Map(); // userId:deviceId -> ws
        this.heartbeatInterval = parseInt(process.env.WS_HEARTBEAT_INTERVAL) || 30000;
        this.clientTimeout = parseInt(process.env.WS_CLIENT_TIMEOUT) || 60000;
    }

    /**
     * Initialize WebSocket server
     */
    async initialize(httpServer) {
        // Create WebSocket server
        const wss = new WebSocket.Server({
            server: httpServer,
            path: '/ws',
            perMessageDeflate: false,
            clientTracking: true
        });

        this.wss = wss;

        // Setup connection handler
        wss.on('connection', async (ws, req) => {
            try {
                // Authenticate connection
                const auth = await authenticateWebSocket(req);
                ws.userId = auth.userId;
                ws.deviceId = auth.deviceId;
                ws.isAlive = true;

                // Store client connection
                const clientKey = `${auth.userId}:${auth.deviceId}`;
                this.clients.set(clientKey, ws);

                // Handle connection
                await wsHandlers.handleConnection(ws, auth.userId, auth.deviceId);

                // Setup message handler
                ws.on('message', async (data) => {
                    ws.isAlive = true; // Reset timeout on activity
                    await wsHandlers.handleMessage(ws, data, auth.userId, auth.deviceId);
                });

                // Setup pong handler for heartbeat
                ws.on('pong', () => {
                    ws.isAlive = true;
                });

                // Setup close handler
                ws.on('close', async (code, reason) => {
                    this.clients.delete(clientKey);
                    await wsHandlers.handleDisconnection(
                        auth.userId,
                        auth.deviceId,
                        code,
                        reason.toString()
                    );
                });

                // Setup error handler
                ws.on('error', (error) => {
                    logger.error({ err: error, userId: auth.userId }, 'WebSocket error');
                });

            } catch (error) {
                logger.error({ err: error }, 'WebSocket connection failed');
                ws.close(4001, 'Authentication failed');
            }
        });

        // Setup heartbeat
        this.setupHeartbeat();

        // Subscribe to Redis channels
        await this.setupRedisSubscriptions();

        logger.info('WebSocket server initialized');

        return wss;
    }

    /**
     * Setup heartbeat to detect dead connections
     */
    setupHeartbeat() {
        setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (ws.isAlive === false) {
                    logger.info({ userId: ws.userId, deviceId: ws.deviceId }, 'Terminating inactive connection');
                    return ws.terminate();
                }

                ws.isAlive = false;
                ws.ping();
            });
        }, this.heartbeatInterval);
    }

    /**
     * Setup Redis pub/sub for cross-instance communication
     */
    async setupRedisSubscriptions() {
        const sub = getRedisSub();

        // Subscribe to message channel
        await sub.subscribe('messages', (message) => {
            const data = JSON.parse(message);
            this.broadcastMessage(data);
        });

        // Subscribe to presence channel
        await sub.subscribe('presence', (message) => {
            const data = JSON.parse(message);
            this.broadcastPresence(data);
        });

        // Subscribe to receipts channel
        await sub.subscribe('receipts', (message) => {
            const data = JSON.parse(message);
            this.broadcastReceipt(data);
        });

        // Subscribe to typing indicators (pattern subscription)
        await sub.pSubscribe('typing:*', (message, channel) => {
            const data = JSON.parse(message);
            this.broadcastTyping(data, channel);
        });

        logger.info('Redis subscriptions established');
    }

    /**
     * Broadcast new message to recipients
     */
    broadcastMessage(data) {
        const { message, senderId } = data;

        if (message.messageType === 'direct') {
            // Send to recipient
            const recipientKey = `${message.recipientId}:*`;
            this.sendToUser(message.recipientId, {
                type: 'new_message',
                message
            });
        } else if (message.messageType === 'group') {
            // Send to all room participants except sender
            message.recipientStatuses.forEach(status => {
                if (status.recipientId.toString() !== senderId) {
                    this.sendToUser(status.recipientId, {
                        type: 'new_message',
                        message
                    });
                }
            });
        }
    }

    /**
     * Broadcast presence update
     */
    broadcastPresence(data) {
        const { userId, status } = data;

        // Broadcast to all connections except the user's own devices
        this.broadcast({
            type: 'presence',
            userId,
            status,
            timestamp: data.timestamp
        }, userId);
    }

    /**
     * Broadcast delivery/read receipt
     */
    broadcastReceipt(data) {
        const { type, messageId, userId } = data;

        // Send receipt to original sender
        // Note: We'd need to look up the sender from the message
        this.broadcast({
            type: `${type}_receipt`,
            messageId,
            userId,
            timestamp: data.timestamp
        });
    }

    /**
     * Broadcast typing indicator
     */
    broadcastTyping(data, channel) {
        const { userId, conversationId, conversationType, isTyping } = data;

        if (conversationType === 'direct') {
            // Send to the other person in the conversation
            // Note: conversationId would be the recipient's userId
            this.sendToUser(conversationId, {
                type: 'typing',
                userId,
                isTyping,
                timestamp: data.timestamp
            });
        } else if (conversationType === 'group') {
            // Send to all room participants except sender
            this.broadcast({
                type: 'typing',
                userId,
                roomId: conversationId,
                isTyping,
                timestamp: data.timestamp
            }, userId);
        }
    }

    /**
     * Send message to specific user (all devices)
     */
    sendToUser(userId, payload) {
        this.clients.forEach((ws, clientKey) => {
            if (clientKey.startsWith(userId.toString() + ':')) {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(payload));
                }
            }
        });
    }

    /**
     * Send message to specific device
     */
    sendToDevice(userId, deviceId, payload) {
        const clientKey = `${userId}:${deviceId}`;
        const ws = this.clients.get(clientKey);

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
        }
    }

    /**
     * Broadcast to all clients except specified user
     */
    broadcast(payload, excludeUserId = null) {
        this.clients.forEach((ws, clientKey) => {
            if (excludeUserId && clientKey.startsWith(excludeUserId.toString() + ':')) {
                return; // Skip this user
            }

            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(payload));
            }
        });
    }

    /**
     * Get connected clients count
     */
    getConnectedCount() {
        return this.clients.size;
    }

    /**
     * Get user's connected devices
     */
    getUserDevices(userId) {
        const devices = [];
        this.clients.forEach((ws, clientKey) => {
            if (clientKey.startsWith(userId.toString() + ':')) {
                const deviceId = clientKey.split(':')[1];
                devices.push(deviceId);
            }
        });
        return devices;
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        logger.info('Shutting down WebSocket server...');

        // Close all connections
        this.clients.forEach((ws) => {
            ws.close(1001, 'Server shutting down');
        });

        // Close server
        return new Promise((resolve) => {
            this.wss.close(() => {
                logger.info('WebSocket server closed');
                resolve();
            });
        });
    }
}

module.exports = new WebSocketServer();