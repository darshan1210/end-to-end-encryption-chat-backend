const jwt = require('jsonwebtoken');
const url = require('url');
const User = require('../models/User');
const Device = require('../models/Device');
const logger = require('../config/logger');

/**
 * Authenticate WebSocket connection
 */
async function authenticateWebSocket(req) {
    try {
        const params = url.parse(req.url, true).query;
        const token = params.token;

        if (!token) {
            throw new Error('Token required');
        }

        // Verify JWT
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch user
        const user = await User.findById(decoded.userId).select('-passwordHash');
        if (!user || !user.isActive) {
            throw new Error('Invalid or inactive user');
        }

        // Verify device
        const device = await Device.findOne({
            userId: user._id,
            deviceId: decoded.deviceId,
            isRevoked: false
        });

        if (!device) {
            throw new Error('Invalid or revoked device');
        }

        return {
            userId: user._id.toString(),
            deviceId: decoded.deviceId,
            user,
            device
        };
    } catch (error) {
        logger.error({ err: error }, 'WebSocket authentication failed');
        throw error;
    }
}

module.exports = { authenticateWebSocket };