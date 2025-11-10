const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');
const { authenticateToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { messageLimiter, generalLimiter } = require('../middleware/rateLimiter');

// All message routes are protected
router.use(authenticateToken);

router.post('/send', messageLimiter, validate(schemas.sendMessage), messageController.sendMessage);
router.get('/direct/:userId', generalLimiter, messageController.getDirectMessages);
router.get('/room/:roomId', generalLimiter, messageController.getRoomMessages);
router.get('/offline', generalLimiter, messageController.getOfflineMessages);
router.get('/conversations', generalLimiter, messageController.getConversations);
router.put('/:messageId/status', messageController.updateStatus);
router.post('/status/bulk', validate(schemas.updateDeliveryStatus), messageController.bulkUpdateStatus);
router.post('/search', generalLimiter, messageController.searchMessages);
router.delete('/:messageId', messageController.deleteMessage);

module.exports = router;