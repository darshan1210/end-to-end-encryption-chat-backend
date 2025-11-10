const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticateToken, authenticateRefreshToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { authLimiter } = require('../middleware/rateLimiter');

// Public routes
router.post('/signup', authLimiter, validate(schemas.signup), authController.signup);
router.post('/login', authLimiter, validate(schemas.login), authController.login);
router.post('/refresh', authenticateRefreshToken, authController.refreshToken);

// Protected routes
router.use(authenticateToken);
router.post('/logout', authController.logout);
router.get('/me', authController.getCurrentUser);
router.get('/devices', authController.getDevices);
router.delete('/devices/:deviceId', authController.revokeDevice);

module.exports = router;