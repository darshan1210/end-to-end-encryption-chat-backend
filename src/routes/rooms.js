const express = require('express');
const router = express.Router();
const roomController = require('../controllers/roomController');
const { authenticateToken } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { generalLimiter } = require('../middleware/rateLimiter');

// All room routes are protected
router.use(authenticateToken);

router.post('/', generalLimiter, validate(schemas.createRoom), roomController.createRoom);
router.get('/', roomController.getUserRooms);
router.get('/:roomId', roomController.getRoom);
router.put('/:roomId', generalLimiter, roomController.updateRoom);
router.delete('/:roomId', roomController.deleteRoom);
router.post('/:roomId/participants', generalLimiter, roomController.addParticipant);
router.delete('/:roomId/participants/:userId', roomController.removeParticipant);

module.exports = router;