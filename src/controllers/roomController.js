const Room = require('../models/Room');
const { asyncHandler } = require('../middleware/errorHandler');
const { v4: uuidv4 } = require('uuid');

class RoomController {
    /**
     * POST /api/rooms
     */
    createRoom = asyncHandler(async (req, res) => {
        const { name, description, participants, settings } = req.body;

        // Create room
        const room = new Room({
            roomId: uuidv4(),
            name,
            description,
            createdBy: req.userId,
            settings: settings || {},
            participants: [
                {
                    userId: req.userId,
                    role: 'admin',
                    joinedAt: new Date(),
                    hasReceivedGroupKey: true // Creator generates the group key
                },
                ...participants.map(userId => ({
                    userId,
                    role: 'member',
                    joinedAt: new Date(),
                    hasReceivedGroupKey: false
                }))
            ]
        });

        await room.save();

        res.status(201).json({
            success: true,
            data: room,
            message: 'Room created successfully'
        });
    });

    /**
     * GET /api/rooms/:roomId
     */
    getRoom = asyncHandler(async (req, res) => {
        const { roomId } = req.params;

        const room = await Room.findById(roomId)
            .populate('participants.userId', 'username displayName avatar')
            .populate('createdBy', 'username displayName avatar');

        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Verify user is participant
        if (!room.isParticipant(req.userId)) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        res.status(200).json({
            success: true,
            data: room
        });
    });

    /**
     * GET /api/rooms
     */
    getUserRooms = asyncHandler(async (req, res) => {
        const rooms = await Room.find({
            'participants.userId': req.userId,
            isActive: true
        })
            .populate('participants.userId', 'username displayName avatar')
            .populate('createdBy', 'username displayName')
            .sort({ lastActivity: -1 });

        res.status(200).json({
            success: true,
            data: rooms,
            count: rooms.length
        });
    });

    /**
     * POST /api/rooms/:roomId/participants
     */
    addParticipant = asyncHandler(async (req, res) => {
        const { roomId } = req.params;
        const { userId } = req.body;

        const room = await Room.findById(roomId);
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if requester is admin
        if (!room.isAdmin(req.userId)) {
            return res.status(403).json({ error: 'Only admins can add participants' });
        }

        await room.addParticipant(userId);

        res.status(200).json({
            success: true,
            data: room,
            message: 'Participant added successfully'
        });
    });

    /**
     * DELETE /api/rooms/:roomId/participants/:userId
     */
    removeParticipant = asyncHandler(async (req, res) => {
        const { roomId, userId } = req.params;

        const room = await Room.findById(roomId);
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check permissions: admin or removing self
        if (!room.isAdmin(req.userId) && req.userId.toString() !== userId) {
            return res.status(403).json({ error: 'Not authorized' });
        }

        await room.removeParticipant(userId);

        res.status(200).json({
            success: true,
            data: room,
            message: 'Participant removed successfully'
        });
    });

    /**
     * PUT /api/rooms/:roomId
     */
    updateRoom = asyncHandler(async (req, res) => {
        const { roomId } = req.params;
        const { name, description, avatar, settings } = req.body;

        const room = await Room.findById(roomId);
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Check if requester is admin
        if (!room.isAdmin(req.userId)) {
            return res.status(403).json({ error: 'Only admins can update room' });
        }

        if (name) room.name = name;
        if (description !== undefined) room.description = description;
        if (avatar !== undefined) room.avatar = avatar;
        if (settings) room.settings = { ...room.settings, ...settings };

        await room.save();

        res.status(200).json({
            success: true,
            data: room,
            message: 'Room updated successfully'
        });
    });

    /**
     * DELETE /api/rooms/:roomId
     */
    deleteRoom = asyncHandler(async (req, res) => {
        const { roomId } = req.params;

        const room = await Room.findById(roomId);
        if (!room) {
            return res.status(404).json({ error: 'Room not found' });
        }

        // Only creator can delete
        if (room.createdBy.toString() !== req.userId.toString()) {
            return res.status(403).json({ error: 'Only creator can delete room' });
        }

        room.isActive = false;
        await room.save();

        res.status(200).json({
            success: true,
            message: 'Room deleted successfully'
        });
    });
}

module.exports = new RoomController();