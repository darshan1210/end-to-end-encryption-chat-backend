const mongoose = require('mongoose');

/**
 * Room model for group chats
 * Manages participants and group metadata
 */
const roomSchema = new mongoose.Schema({
    roomId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    description: {
        type: String,
        maxlength: 500
    },
    // Creator of the room
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // Room type
    roomType: {
        type: String,
        enum: ['group', 'channel'],
        default: 'group'
    },
    // Participants
    participants: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        role: {
            type: String,
            enum: ['admin', 'member'],
            default: 'member'
        },
        joinedAt: {
            type: Date,
            default: Date.now
        },
        // For E2EE: each participant needs the group's symmetric key
        // encrypted with their public key
        hasReceivedGroupKey: {
            type: Boolean,
            default: false
        }
    }],
    // Room settings
    settings: {
        isPublic: {
            type: Boolean,
            default: false
        },
        maxParticipants: {
            type: Number,
            default: 256
        },
        allowInvites: {
            type: Boolean,
            default: true
        }
    },
    // Avatar
    avatar: {
        type: String
    },
    // Status
    isActive: {
        type: Boolean,
        default: true
    },
    lastActivity: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes
roomSchema.index({ roomId: 1 });
roomSchema.index({ 'participants.userId': 1 });
roomSchema.index({ createdBy: 1 });
roomSchema.index({ isActive: 1, lastActivity: -1 });

// Add participant
roomSchema.methods.addParticipant = function (userId, role = 'member') {
    const exists = this.participants.some(p => p.userId.toString() === userId.toString());
    if (exists) {
        throw new Error('User already in room');
    }

    if (this.participants.length >= this.settings.maxParticipants) {
        throw new Error('Room is full');
    }

    this.participants.push({
        userId,
        role,
        joinedAt: new Date(),
        hasReceivedGroupKey: false
    });

    this.lastActivity = new Date();
    return this.save();
};

// Remove participant
roomSchema.methods.removeParticipant = function (userId) {
    this.participants = this.participants.filter(
        p => p.userId.toString() !== userId.toString()
    );
    this.lastActivity = new Date();
    return this.save();
};

// Check if user is participant
roomSchema.methods.isParticipant = function (userId) {
    return this.participants.some(p => p.userId.toString() === userId.toString());
};

// Check if user is admin
roomSchema.methods.isAdmin = function (userId) {
    const participant = this.participants.find(
        p => p.userId.toString() === userId.toString()
    );
    return participant && participant.role === 'admin';
};

module.exports = mongoose.model('Room', roomSchema);