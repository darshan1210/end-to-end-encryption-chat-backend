const mongoose = require('mongoose');

/**
 * Device model for multi-device support
 * Each device has its own key pair for E2EE
 */
const deviceSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    deviceId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    deviceName: {
        type: String,
        default: 'Unknown Device'
    },
    deviceType: {
        type: String,
        enum: ['web', 'mobile', 'desktop'],
        default: 'web'
    },
    // Device-specific public key (X25519/Curve25519)
    publicKey: {
        type: String, // Base64 encoded
        required: true
    },
    // Signed prekey for this device
    signedPreKey: {
        keyId: Number,
        publicKey: String,
        signature: String,
        timestamp: Date
    },
    // Refresh token for this device
    refreshTokenHash: {
        type: String
    },
    // Connection info
    isActive: {
        type: Boolean,
        default: true
    },
    lastSeen: {
        type: Date,
        default: Date.now
    },
    lastIpAddress: {
        type: String
    },
    userAgent: {
        type: String
    },
    // Security
    revokedAt: {
        type: Date
    },
    isRevoked: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Compound indexes
deviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });
deviceSchema.index({ userId: 1, isActive: 1 });
deviceSchema.index({ userId: 1, isRevoked: 1 });

// Method to revoke device
deviceSchema.methods.revoke = function () {
    this.isRevoked = true;
    this.revokedAt = new Date();
    this.isActive = false;
    return this.save();
};

module.exports = mongoose.model('Device', deviceSchema);