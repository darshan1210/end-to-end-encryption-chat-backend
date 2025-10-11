const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Device = require('../models/Device');
const logger = require('../config/logger');

/**
 * Verify JWT token and attach user to request
 */
const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

        if (!token) {
            return res.status(401).json({ error: 'Access token required' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Fetch user
        const user = await User.findById(decoded.userId).select('-passwordHash');
        if (!user || !user.isActive) {
            return res.status(401).json({ error: 'Invalid or inactive user' });
        }

        // Verify device if deviceId present
        if (decoded.deviceId) {
            const device = await Device.findOne({
                userId: user._id,
                deviceId: decoded.deviceId,
                isRevoked: false
            });

            if (!device) {
                return res.status(401).json({ error: 'Invalid or revoked device' });
            }

            req.device = device;
        }

        req.user = user;
        req.userId = user._id;
        req.deviceId = decoded.deviceId;

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expired' });
        }
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({ error: 'Invalid token' });
        }

        logger.error({ err: error }, 'Authentication error');
        res.status(500).json({ error: 'Authentication failed' });
    }
};

/**
 * Verify refresh token
 */
const authenticateRefreshToken = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token required' });
        }

        const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

        const user = await User.findById(decoded.userId);
        if (!user || !user.isActive) {
            return res.status(401).json({ error: 'Invalid user' });
        }

        // Verify device and refresh token hash
        const device = await Device.findOne({
            userId: user._id,
            deviceId: decoded.deviceId,
            isRevoked: false
        });

        if (!device) {
            return res.status(401).json({ error: 'Invalid or revoked device' });
        }

        req.user = user;
        req.device = device;
        req.refreshToken = refreshToken;

        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Refresh token expired' });
        }

        logger.error({ err: error }, 'Refresh token authentication error');
        res.status(401).json({ error: 'Invalid refresh token' });
    }
};

/**
 * Optional authentication - doesn't fail if no token
 */
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader && authHeader.split(' ')[1];

        if (token) {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.userId).select('-passwordHash');

            if (user && user.isActive) {
                req.user = user;
                req.userId = user._id;
                req.deviceId = decoded.deviceId;
            }
        }

        next();
    } catch (error) {
        // Silently fail for optional auth
        next();
    }
};

module.exports = {
    authenticateToken,
    authenticateRefreshToken,
    optionalAuth
};