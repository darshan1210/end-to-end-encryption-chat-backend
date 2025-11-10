const authService = require('../services/authService');
const { asyncHandler } = require('../middleware/errorHandler');

class AuthController {
    /**
     * POST /api/auth/signup
     */
    signup = asyncHandler(async (req, res) => {
        const result = await authService.signup(req.body);

        res.status(201).json({
            success: true,
            data: result,
            message: 'User registered successfully. Please login to register device keys.'
        });
    });

    /**
     * POST /api/auth/login
     */
    login = asyncHandler(async (req, res) => {
        const credentials = {
            ...req.body,
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip
        };

        const result = await authService.login(credentials);

        if (result.requiresKeyRegistration) {
            return res.status(200).json({
                success: true,
                data: result,
                message: 'Login successful. Please register device keys to complete setup.'
            });
        }

        res.status(200).json({
            success: true,
            data: result,
            message: 'Login successful'
        });
    });

    /**
     * POST /api/auth/refresh
     */
    refreshToken = asyncHandler(async (req, res) => {
        const result = await authService.refreshToken(
            req.user,
            req.device,
            req.refreshToken
        );

        res.status(200).json({
            success: true,
            data: result
        });
    });

    /**
     * POST /api/auth/logout
     */
    logout = asyncHandler(async (req, res) => {
        await authService.logout(req.userId, req.deviceId);

        res.status(200).json({
            success: true,
            message: 'Logged out successfully'
        });
    });

    /**
     * GET /api/auth/me
     */
    getCurrentUser = asyncHandler(async (req, res) => {
        res.status(200).json({
            success: true,
            data: {
                userId: req.user._id,
                username: req.user.username,
                email: req.user.email,
                displayName: req.user.displayName,
                avatar: req.user.avatar,
                isOnline: req.user.isOnline,
                privacySettings: req.user.privacySettings
            }
        });
    });

    /**
     * GET /api/auth/devices
     */
    getDevices = asyncHandler(async (req, res) => {
        const devices = await authService.getUserDevices(req.userId);

        res.status(200).json({
            success: true,
            data: devices
        });
    });

    /**
     * DELETE /api/auth/devices/:deviceId
     */
    revokeDevice = asyncHandler(async (req, res) => {
        const { deviceId } = req.params;

        const result = await authService.revokeDevice(req.userId, deviceId);

        res.status(200).json({
            success: true,
            data: result
        });
    });
}

module.exports = new AuthController();