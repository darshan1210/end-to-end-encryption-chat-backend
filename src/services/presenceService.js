const { getRedisClient, getRedisPub } = require('../config/redis');
const User = require('../models/User');
const logger = require('../config/logger');

class PresenceService {
    constructor() {
        this.PRESENCE_TIMEOUT = 60; // seconds
        this.TYPING_TIMEOUT = 5; // seconds
    }

    /**
     * Set user online
     */
    async setOnline(userId, deviceId) {
        const redis = getRedisClient();
        const pub = getRedisPub();

        // Store in Redis with expiration
        await redis.setEx(
            `presence:${userId}:${deviceId}`,
            this.PRESENCE_TIMEOUT,
            'online'
        );

        // Update database
        await User.findByIdAndUpdate(userId, {
            isOnline: true,
            lastSeen: new Date()
        });

        // Publish presence event
        await pub.publish('presence', JSON.stringify({
            userId,
            deviceId,
            status: 'online',
            timestamp: new Date().toISOString()
        }));

        logger.debug({ userId, deviceId }, 'User online');
    }

    /**
     * Set user offline
     */
    async setOffline(userId, deviceId) {
        const redis = getRedisClient();
        const pub = getRedisPub();

        // Remove from Redis
        await redis.del(`presence:${userId}:${deviceId}`);

        // Check if user has other online devices
        const pattern = `presence:${userId}:*`;
        const keys = await redis.keys(pattern);

        // If no other devices, mark user offline
        if (keys.length === 0) {
            await User.findByIdAndUpdate(userId, {
                isOnline: false,
                lastSeen: new Date()
            });

            // Publish presence event
            await pub.publish('presence', JSON.stringify({
                userId,
                deviceId,
                status: 'offline',
                timestamp: new Date().toISOString()
            }));
        }

        logger.debug({ userId, deviceId }, 'User offline');
    }

    /**
     * Get user presence
     */
    async getPresence(userId) {
        const redis = getRedisClient();
        const pattern = `presence:${userId}:*`;
        const keys = await redis.keys(pattern);

        if (keys.length > 0) {
            return {
                userId,
                status: 'online',
                devices: keys.length
            };
        }

        const user = await User.findById(userId).select('isOnline lastSeen');
        return {
            userId,
            status: 'offline',
            lastSeen: user?.lastSeen
        };
    }

    /**
     * Get presence for multiple users
     */
    async getMultiplePresence(userIds) {
        const presencePromises = userIds.map(userId => this.getPresence(userId));
        return Promise.all(presencePromises);
    }

    /**
     * Heartbeat to keep connection alive
     */
    async heartbeat(userId, deviceId) {
        const redis = getRedisClient();
        const key = `presence:${userId}:${deviceId}`;

        // Refresh TTL
        const exists = await redis.exists(key);
        if (exists) {
            await redis.expire(key, this.PRESENCE_TIMEOUT);
            return { success: true };
        }

        // If not exists, set online
        await this.setOnline(userId, deviceId);
        return { success: true, reconnected: true };
    }

    /**
     * Set typing indicator
     */
    async setTyping(userId, conversationId, conversationType = 'direct') {
        const redis = getRedisClient();
        const pub = getRedisPub();

        const key = `typing:${conversationType}:${conversationId}:${userId}`;
        await redis.setEx(key, this.TYPING_TIMEOUT, '1');

        // Publish typing event
        await pub.publish(`typing:${conversationType}:${conversationId}`, JSON.stringify({
            userId,
            conversationId,
            conversationType,
            isTyping: true,
            timestamp: new Date().toISOString()
        }));

        logger.debug({ userId, conversationId }, 'User typing');
    }

    /**
     * Stop typing indicator
     */
    async stopTyping(userId, conversationId, conversationType = 'direct') {
        const redis = getRedisClient();
        const pub = getRedisPub();

        const key = `typing:${conversationType}:${conversationId}:${userId}`;
        await redis.del(key);

        // Publish typing stopped event
        await pub.publish(`typing:${conversationType}:${conversationId}`, JSON.stringify({
            userId,
            conversationId,
            conversationType,
            isTyping: false,
            timestamp: new Date().toISOString()
        }));

        logger.debug({ userId, conversationId }, 'User stopped typing');
    }

    /**
     * Get who is typing in a conversation
     */
    async getTyping(conversationId, conversationType = 'direct') {
        const redis = getRedisClient();
        const pattern = `typing:${conversationType}:${conversationId}:*`;
        const keys = await redis.keys(pattern);

        const typingUsers = keys.map(key => {
            const parts = key.split(':');
            return parts[parts.length - 1]; // userId
        });

        return typingUsers;
    }

    /**
     * Clean up stale presence data
     */
    async cleanup() {
        // This would be called periodically
        // Redis TTL handles most cleanup automatically
        logger.info('Presence cleanup completed');
    }
}

module.exports = new PresenceService();