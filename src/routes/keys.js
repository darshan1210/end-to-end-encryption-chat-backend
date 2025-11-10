const express = require('express');
const router = express.Router();
const keyController = require('../controllers/keyController');
const { authenticateToken, optionalAuth } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { keyRegistrationLimiter, generalLimiter } = require('../middleware/rateLimiter');

// Register keys - can be done with or without token (right after signup)
router.post(
    '/register',
    optionalAuth,
    keyRegistrationLimiter,
    validate(schemas.registerKeys),
    keyController.registerKeys
);

// Protected routes
router.use(authenticateToken);
router.get('/user/:userId', generalLimiter, keyController.getUserKeys);
router.post('/rotate', keyRegistrationLimiter, keyController.rotateKeys);
router.post('/prekeys', keyRegistrationLimiter, keyController.uploadPreKeys);
router.get('/prekeys/stats', keyController.getPreKeyStats);
router.delete('/prekeys/cleanup', keyController.cleanupPreKeys);

module.exports = router;