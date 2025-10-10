const mongoose = require('mongoose');

/**
 * Message model - stores ONLY encrypted message data
 * Server never has access to plaintext content
 */
const messageSchema = new mongoose.Schema({
    messageId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    // Sender information
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    senderDeviceId: {
        type: String,
        required: true
    },
    // Recipient information (for 1:1 messages)
    recipientId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true
    },
    recipientDeviceId: {
        type: String
    },
    // Room information (for group messages)
    roomId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Room',
        index: true
    },
    // Message type
    messageType: {
        type: String,
        enum: ['direct', 'group'],
        required: true,
        index: true
    },
    // ENCRYPTED CONTENT - Server cannot decrypt this
    encryptedContent: {
        type: String, // Base64 encoded ciphertext
        required: true
    },
    // Encryption metadata (NOT the actual keys)
    encryptionMetadata: {
        algorithm: {
            type: String,
            default: 'XChaCha20-Poly1305'
        },
        // Nonce/IV for the symmetric encryption
        nonce: String, // Base64 encoded
        // Key version identifier (for key rotation tracking)
        keyVersion: Number,
        // For group messages: array of encrypted symmetric keys
        // Each entry encrypts the same symmetric key for different recipients
        encryptedKeys: [{
            recipientId: mongoose.Schema.Types.ObjectId,
            recipientDeviceId: String,
            encryptedKey: String, // Symmetric key encrypted with recipient's public key
            ephemeralPublicKey: String // Ephemeral public key used for ECDH
        }]
    },
    // Delivery tracking
    deliveryStatus: {
        type: String,
        enum: ['sent', 'delivered', 'read', 'failed'],
        default: 'sent',
        index: true
    },
    deliveredAt: {
        type: Date
    },
    readAt: {
        type: Date
    },
    // For group messages: track per-recipient delivery
    recipientStatuses: [{
        recipientId: mongoose.Schema.Types.ObjectId,
        deviceId: String,
        status: {
            type: String,
            enum: ['sent', 'delivered', 'read', 'failed'],
            default: 'sent'
        },
        deliveredAt: Date,
        readAt: Date
    }],
    // Metadata (minimal, privacy-conscious)
    isEdited: {
        type: Boolean,
        default: false
    },
    isDeleted: {
        type: Boolean,
        default: false
    },
    deletedAt: {
        type: Date
    },
    // Expiration for ephemeral messages
    expiresAt: {
        type: Date,
        index: true
    }
}, {
    timestamps: true
});

// Indexes for efficient queries
messageSchema.index({ senderId: 1, recipientId: 1, createdAt: -1 });
messageSchema.index({ roomId: 1, createdAt: -1 });
messageSchema.index({ recipientId: 1, deliveryStatus: 1 });
messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
messageSchema.index({ createdAt: -1 });

// Mark message as delivered
messageSchema.methods.markDelivered = function (recipientId, deviceId) {
    if (this.messageType === 'direct') {
        this.deliveryStatus = 'delivered';
        this.deliveredAt = new Date();
    } else {
        // Group message: update specific recipient status
        const recipientStatus = this.recipientStatuses.find(
            rs => rs.recipientId.toString() === recipientId.toString() && rs.deviceId === deviceId
        );
        if (recipientStatus) {
            recipientStatus.status = 'delivered';
            recipientStatus.deliveredAt = new Date();
        }
    }
    return this.save();
};

// Mark message as read
messageSchema.methods.markRead = function (recipientId, deviceId) {
    if (this.messageType === 'direct') {
        this.deliveryStatus = 'read';
        this.readAt = new Date();
    } else {
        // Group message: update specific recipient status
        const recipientStatus = this.recipientStatuses.find(
            rs => rs.recipientId.toString() === recipientId.toString() && rs.deviceId === deviceId
        );
        if (recipientStatus) {
            recipientStatus.status = 'read';
            recipientStatus.readAt = new Date();
        }
    }
    return this.save();
};

// Soft delete message
messageSchema.methods.softDelete = function () {
    this.isDeleted = true;
    this.deletedAt = new Date();
    // Keep encrypted content for forensics, or set to null for privacy
    // this.encryptedContent = null; // Uncomment to permanently remove content
    return this.save();
};

module.exports = mongoose.model('Message', messageSchema);