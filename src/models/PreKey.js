const mongoose = require('mongoose');

/**
 * PreKey model for storing one-time prekeys
 * Used for asynchronous message initialization (offline messaging)
 * Once used, a prekey should be deleted
 */
const preKeySchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    deviceId: {
        type: String,
        required: true,
        index: true
    },
    keyId: {
        type: Number,
        required: true
    },
    publicKey: {
        type: String, // Base64 encoded X25519 public key
        required: true
    },
    // Status tracking
    isUsed: {
        type: Boolean,
        default: false
    },
    usedAt: {
        type: Date
    },
    usedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    // Expiration
    expiresAt: {
        type: Date,
        required: true,
        index: true
    }
}, {
    timestamps: true
});

// Compound indexes for efficient queries
preKeySchema.index({ userId: 1, deviceId: 1, keyId: 1 }, { unique: true });
preKeySchema.index({ userId: 1, deviceId: 1, isUsed: 1 });
preKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

// Mark prekey as used
preKeySchema.methods.markAsUsed = function (usedByUserId) {
    this.isUsed = true;
    this.usedAt = new Date();
    this.usedBy = usedByUserId;
    return this.save();
};

// Static method to get available prekey
preKeySchema.statics.getAvailablePreKey = async function (userId, deviceId) {
    return this.findOne({
        userId,
        deviceId,
        isUsed: false,
        expiresAt: { $gt: new Date() }
    }).sort({ createdAt: 1 }); // Oldest first
};

module.exports = mongoose.model('PreKey', preKeySchema);