const User = require('../models/User');
const Device = require('../models/Device');
const PreKey = require('../models/PreKey');
const logger = require('../config/logger');

class KeyService {
    /**
     * Register device keys (called after signup/login)
     */
    async registerDeviceKeys(userId, keyData) {
        const {
            deviceId,
            publicKey,
            signedPreKey,
            identityPublicKey,
            preKeys,
            deviceName,
            deviceType
        } = keyData;

        // Validate key formats (base64)
        if (!this.isValidBase64(publicKey)) {
            throw new Error('Invalid public key format');
        }

        // Check if device already exists
        let device = await Device.findOne({ userId, deviceId });

        if (!device) {
            // Create new device
            device = new Device({
                userId,
                deviceId,
                deviceName: deviceName || 'Unknown Device',
                deviceType: deviceType || 'web',
                publicKey,
                signedPreKey: {
                    keyId: signedPreKey.keyId,
                    publicKey: signedPreKey.publicKey,
                    signature: signedPreKey.signature,
                    timestamp: new Date()
                },
                isActive: true
            });
        } else {
            // Update existing device keys
            device.publicKey = publicKey;
            device.signedPreKey = {
                keyId: signedPreKey.keyId,
                publicKey: signedPreKey.publicKey,
                signature: signedPreKey.signature,
                timestamp: new Date()
            };
            device.isActive = true;
        }

        await device.save();

        // Update user's identity key if provided
        if (identityPublicKey) {
            const user = await User.findById(userId);
            if (!user.identityPublicKey) {
                user.identityPublicKey = identityPublicKey;
                await user.save();
            }
        }

        // Register one-time prekeys if provided
        if (preKeys && preKeys.length > 0) {
            await this.registerPreKeys(userId, deviceId, preKeys);
        }

        logger.info({ userId, deviceId }, 'Device keys registered');

        return {
            success: true,
            deviceId,
            publicKey: device.publicKey
        };
    }

    /**
     * Register one-time prekeys
     */
    async registerPreKeys(userId, deviceId, preKeys) {
        const expirationDays = parseInt(process.env.PREKEY_EXPIRATION_DAYS) || 30;
        const expiresAt = new Date(Date.now() + expirationDays * 24 * 60 * 60 * 1000);

        const preKeyDocs = preKeys.map(pk => ({
            userId,
            deviceId,
            keyId: pk.keyId,
            publicKey: pk.publicKey,
            isUsed: false,
            expiresAt
        }));

        // Use insertMany with ordered: false to continue on duplicates
        try {
            await PreKey.insertMany(preKeyDocs, { ordered: false });
        } catch (error) {
            // Ignore duplicate key errors (E11000)
            if (error.code !== 11000) {
                throw error;
            }
        }

        logger.info({ userId, deviceId, count: preKeys.length }, 'PreKeys registered');

        return { count: preKeys.length };
    }

    /**
     * Get user's public keys for E2EE key exchange
     */
    async getUserKeys(targetUserId, requestingUserId) {
        const user = await User.findById(targetUserId).select('identityPublicKey signedPreKey');
        if (!user) {
            throw new Error('User not found');
        }

        // Get all active devices for the user
        const devices = await Device.find({
            userId: targetUserId,
            isRevoked: false,
            isActive: true
        }).select('deviceId publicKey signedPreKey');

        // For each device, get one available prekey
        const deviceKeys = await Promise.all(
            devices.map(async (device) => {
                const preKey = await PreKey.getAvailablePreKey(targetUserId, device.deviceId);

                // Mark prekey as used if found
                if (preKey) {
                    await preKey.markAsUsed(requestingUserId);
                }

                return {
                    deviceId: device.deviceId,
                    publicKey: device.publicKey,
                    signedPreKey: device.signedPreKey,
                    oneTimePreKey: preKey ? {
                        keyId: preKey.keyId,
                        publicKey: preKey.publicKey
                    } : null
                };
            })
        );

        logger.info({ targetUserId, requestingUserId }, 'User keys retrieved');

        return {
            userId: targetUserId,
            identityPublicKey: user.identityPublicKey,
            signedPreKey: user.signedPreKey,
            devices: deviceKeys
        };
    }

    /**
     * Rotate device keys
     */
    async rotateDeviceKeys(userId, deviceId, newKeyData) {
        const device = await Device.findOne({ userId, deviceId, isRevoked: false });
        if (!device) {
            throw new Error('Device not found or revoked');
        }

        const { publicKey, signedPreKey, preKeys } = newKeyData;

        // Update device keys
        if (publicKey) {
            device.publicKey = publicKey;
        }

        if (signedPreKey) {
            device.signedPreKey = {
                keyId: signedPreKey.keyId,
                publicKey: signedPreKey.publicKey,
                signature: signedPreKey.signature,
                timestamp: new Date()
            };
        }

        await device.save();

        // Replace prekeys
        if (preKeys && preKeys.length > 0) {
            // Delete old unused prekeys
            await PreKey.deleteMany({ userId, deviceId, isUsed: false });

            // Register new prekeys
            await this.registerPreKeys(userId, deviceId, preKeys);
        }

        logger.info({ userId, deviceId }, 'Device keys rotated');

        return {
            success: true,
            message: 'Keys rotated successfully'
        };
    }

    /**
     * Get prekey statistics (for monitoring)
     */
    async getPreKeyStats(userId, deviceId) {
        const total = await PreKey.countDocuments({ userId, deviceId });
        const available = await PreKey.countDocuments({
            userId,
            deviceId,
            isUsed: false,
            expiresAt: { $gt: new Date() }
        });
        const used = await PreKey.countDocuments({ userId, deviceId, isUsed: true });
        const expired = await PreKey.countDocuments({
            userId,
            deviceId,
            expiresAt: { $lte: new Date() }
        });

        return { total, available, used, expired };
    }

    /**
     * Clean up expired prekeys
     */
    async cleanupExpiredPreKeys(userId, deviceId) {
        const result = await PreKey.deleteMany({
            userId,
            deviceId,
            $or: [
                { expiresAt: { $lte: new Date() } },
                { isUsed: true }
            ]
        });

        logger.info({ userId, deviceId, count: result.deletedCount }, 'Expired prekeys cleaned up');

        return { deletedCount: result.deletedCount };
    }

    /**
     * Validate base64 string
     */
    isValidBase64(str) {
        if (!str || typeof str !== 'string') return false;
        try {
            return Buffer.from(str, 'base64').toString('base64') === str;
        } catch {
            return false;
        }
    }
}

module.exports = new KeyService();