const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Device = require('../models/Device');
const logger = require('../config/logger');
const { v4: uuidv4 } = require('uuid');

class AuthService {
    /**
     * Generate JWT tokens
     */
    generateTokens(userId, deviceId) {
        const accessToken = jwt.sign(
            { userId, deviceId },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
        );

        const refreshToken = jwt.sign(
            { userId, deviceId, tokenId: uuidv4() },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
        );

        return { accessToken, refreshToken };
    }

    /**
     * Register new user
     */
    async signup(userData) {
        const { username, email, password, displayName } = userData;

        // Check if user already exists
        const existingUser = await User.findOne({
            $or: [{ email }, { username }]
        });

        if (existingUser) {
            if (existingUser.email === email) {
                throw new Error('Email already registered');
            }
            throw new Error('Username already taken');
        }

        // Create user
        const user = new User({
            username,
            email,
            passwordHash: password, // Will be hashed by pre-save hook
            displayName: displayName || username
        });

        await user.save();

        logger.info({ userId: user._id }, 'User registered');

        return {
            userId: user._id,
            username: user.username,
            email: user.email,
            displayName: user.displayName
        };
    }

    /**
     * Login user and register device
     */
    async login(credentials) {
        const { email, password, deviceId, deviceName, deviceType, userAgent, ipAddress } = credentials;

        // Find user
        const user = await User.findOne({ email });
        if (!user) {
            throw new Error('Invalid credentials');
        }

        // Check if account is locked
        if (user.isLocked) {
            throw new Error('Account is locked. Please try again later.');
        }

        // Verify password
        const isValidPassword = await user.comparePassword(password);
        if (!isValidPassword) {
            await user.incLoginAttempts();
            throw new Error('Invalid credentials');
        }

        // Reset login attempts on successful login
        await user.resetLoginAttempts();

        // Check if device exists
        let device = await Device.findOne({ userId: user._id, deviceId });

        if (!device) {
            // Device doesn't exist yet - will be created when keys are registered
            logger.info({ userId: user._id, deviceId }, 'New device login - keys required');

            return {
                userId: user._id,
                username: user.username,
                email: user.email,
                displayName: user.displayName,
                requiresKeyRegistration: true,
                deviceId
            };
        }

        // Check if device is revoked
        if (device.isRevoked) {
            throw new Error('Device has been revoked');
        }

        // Update device info
        device.lastSeen = new Date();
        device.lastIpAddress = ipAddress;
        device.userAgent = userAgent;
        device.isActive = true;
        await device.save();

        // Generate tokens
        const { accessToken, refreshToken } = this.generateTokens(user._id, deviceId);

        // Hash and store refresh token
        const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
        device.refreshTokenHash = refreshTokenHash;
        await device.save();

        // Update user online status
        user.isOnline = true;
        user.lastSeen = new Date();
        await user.save();

        logger.info({ userId: user._id, deviceId }, 'User logged in');

        return {
            userId: user._id,
            username: user.username,
            email: user.email,
            displayName: user.displayName,
            deviceId,
            accessToken,
            refreshToken,
            requiresKeyRegistration: false
        };
    }

    /**
     * Refresh access token
     */
    async refreshToken(user, device, oldRefreshToken) {
        // Verify refresh token hash matches
        const isValid = await bcrypt.compare(oldRefreshToken, device.refreshTokenHash || '');
        if (!isValid) {
            throw new Error('Invalid refresh token');
        }

        // Generate new tokens
        const { accessToken, refreshToken } = this.generateTokens(user._id, device.deviceId);

        // Update refresh token hash
        const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
        device.refreshTokenHash = refreshTokenHash;
        device.lastSeen = new Date();
        await device.save();

        logger.info({ userId: user._id, deviceId: device.deviceId }, 'Token refreshed');

        return {
            accessToken,
            refreshToken
        };
    }

    /**
     * Logout
     */
    async logout(userId, deviceId) {
        const device = await Device.findOne({ userId, deviceId });

        if (device) {
            device.refreshTokenHash = null;
            device.isActive = false;
            await device.save();
        }

        // Update user online status if no active devices
        const activeDevices = await Device.countDocuments({ userId, isActive: true, isRevoked: false });
        if (activeDevices === 0) {
            await User.findByIdAndUpdate(userId, {
                isOnline: false,
                lastSeen: new Date()
            });
        }

        logger.info({ userId, deviceId }, 'User logged out');
    }

    /**
     * Revoke device
     */
    async revokeDevice(userId, deviceId) {
        const device = await Device.findOne({ userId, deviceId });

        if (!device) {
            throw new Error('Device not found');
        }

        await device.revoke();

        logger.info({ userId, deviceId }, 'Device revoked');

        return { success: true, message: 'Device revoked successfully' };
    }

    /**
     * Get user's devices
     */
    async getUserDevices(userId) {
        const devices = await Device.find({ userId, isRevoked: false })
            .select('deviceId deviceName deviceType isActive lastSeen createdAt')
            .sort({ lastSeen: -1 });

        return devices;
    }
}

module.exports = new AuthService();