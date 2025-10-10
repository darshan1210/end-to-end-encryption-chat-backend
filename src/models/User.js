const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        minlength: 3,
        maxlength: 30,
        index: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        index: true
    },
    passwordHash: {
        type: String,
        required: true
    },
    // Long-term identity public key (Curve25519/X25519)
    identityPublicKey: {
        type: String, // Base64 encoded
        required: false
    },
    // Signed prekey (rotated periodically)
    signedPreKey: {
        keyId: Number,
        publicKey: String, // Base64
        signature: String, // Signature using identity key
        timestamp: Date
    },
    // User profile
    displayName: {
        type: String,
        default: ''
    },
    avatar: {
        type: String,
        default: ''
    },
    // Security
    loginAttempts: {
        type: Number,
        default: 0
    },
    lockUntil: {
        type: Date
    },
    lastLogin: {
        type: Date
    },
    // Privacy settings
    privacySettings: {
        showOnlineStatus: {
            type: Boolean,
            default: true
        },
        showTypingIndicator: {
            type: Boolean,
            default: true
        },
        showReadReceipts: {
            type: Boolean,
            default: true
        }
    },
    // Status
    isActive: {
        type: Boolean,
        default: true
    },
    isOnline: {
        type: Boolean,
        default: false
    },
    lastSeen: {
        type: Date
    }
}, {
    timestamps: true
});

// Virtual for checking if account is locked
userSchema.virtual('isLocked').get(function () {
    return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('passwordHash')) return next();

    try {
        const rounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
        this.passwordHash = await bcrypt.hash(this.passwordHash, rounds);
        next();
    } catch (error) {
        next(error);
    }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Increment login attempts
userSchema.methods.incLoginAttempts = async function () {
    const MAX_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS) || 5;
    const LOCK_TIME = parseInt(process.env.LOCKOUT_TIME) || 900000; // 15 minutes

    // Reset attempts if lock has expired
    if (this.lockUntil && this.lockUntil < Date.now()) {
        return this.updateOne({
            $set: { loginAttempts: 1 },
            $unset: { lockUntil: 1 }
        });
    }

    // Increment attempts
    const updates = { $inc: { loginAttempts: 1 } };

    // Lock account after max attempts
    if (this.loginAttempts + 1 >= MAX_ATTEMPTS && !this.isLocked) {
        updates.$set = { lockUntil: Date.now() + LOCK_TIME };
    }

    return this.updateOne(updates);
};

// Reset login attempts
userSchema.methods.resetLoginAttempts = function () {
    return this.updateOne({
        $set: { loginAttempts: 0, lastLogin: Date.now() },
        $unset: { lockUntil: 1 }
    });
};

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ username: 1 });
userSchema.index({ isOnline: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema);