const keyService = require('../services/keyService');
const authService = require('../services/authService');
const { asyncHandler } = require('../middleware/errorHandler');

class KeyController {
    /**
     * POST /api/keys/register
     * Register device public keys after login
     */
    registerKeys = asyncHandler(async (req, res) => {
        console.log('req ------------------------------------------------', req, req.userId)
        // Agar token nahi hai (first time key registration), toh body se userId le lo
        const currentUserId = req.userId || req.body.userId;

        if (!currentUserId) {
            return res.status(400).json({
                success: false,
                error: 'userId is required'
            });
        }

        const result = await keyService.registerDeviceKeys(currentUserId, req.body);

        // If this is first time key registration after login, generate tokens
        if (!req.headers.authorization || req.headers.authorization === 'Bearer undefined') {
            const { accessToken, refreshToken } = authService.generateTokens(
                currentUserId,
                req.body.deviceId
            );

            return res.status(201).json({
                success: true,
                data: {
                    ...result,
                    accessToken,
                    refreshToken
                },
                message: 'Device keys registered successfully'
            });
        }

        res.status(201).json({
            success: true,
            data: result,
            message: 'Device keys registered successfully'
        });
    });

    /**
     * GET /api/keys/user/:userId
     * Get public keys for a user (for key exchange)
     */
    getUserKeys = asyncHandler(async (req, res) => {
        const { userId } = req.params;

        const keys = await keyService.getUserKeys(userId, req.userId);

        res.status(200).json({
            success: true,
            data: keys
        });
    });

    /**
     * POST /api/keys/rotate
     * Rotate device keys
     */
    rotateKeys = asyncHandler(async (req, res) => {
        const result = await keyService.rotateDeviceKeys(
            req.userId,
            req.deviceId,
            req.body
        );

        res.status(200).json({
            success: true,
            data: result
        });
    });

    /**
     * POST /api/keys/prekeys
     * Upload additional prekeys
     */
    uploadPreKeys = asyncHandler(async (req, res) => {
        const { preKeys } = req.body;

        const result = await keyService.registerPreKeys(
            req.userId,
            req.deviceId,
            preKeys
        );

        res.status(201).json({
            success: true,
            data: result,
            message: 'PreKeys uploaded successfully'
        });
    });

    /**
     * GET /api/keys/prekeys/stats
     * Get prekey statistics
     */
    getPreKeyStats = asyncHandler(async (req, res) => {
        const stats = await keyService.getPreKeyStats(req.userId, req.deviceId);

        res.status(200).json({
            success: true,
            data: stats
        });
    });

    /**
     * DELETE /api/keys/prekeys/cleanup
     * Clean up expired prekeys
     */
    cleanupPreKeys = asyncHandler(async (req, res) => {
        const result = await keyService.cleanupExpiredPreKeys(req.userId, req.deviceId);

        res.status(200).json({
            success: true,
            data: result
        });
    });
}

module.exports = new KeyController();