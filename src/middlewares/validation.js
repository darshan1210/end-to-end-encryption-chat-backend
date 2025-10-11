const Joi = require('joi');

/**
 * Validation middleware factory
 */
const validate = (schema) => {
    return (req, res, next) => {
        const { error } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const errors = error.details.map(detail => detail.message);
            return res.status(400).json({
                error: 'Validation error',
                details: errors
            });
        }

        next();
    };
};

// Validation schemas
const schemas = {
    signup: Joi.object({
        username: Joi.string().alphanum().min(3).max(30).required(),
        email: Joi.string().email().required(),
        password: Joi.string().min(8).max(128).required(),
        displayName: Joi.string().max(50).optional()
    }),

    login: Joi.object({
        email: Joi.string().email().required(),
        password: Joi.string().required(),
        deviceId: Joi.string().required(),
        deviceName: Joi.string().max(50).optional(),
        deviceType: Joi.string().valid('web', 'mobile', 'desktop').optional()
    }),

    registerKeys: Joi.object({
        deviceId: Joi.string().required(),
        publicKey: Joi.string().base64().required(),
        signedPreKey: Joi.object({
            keyId: Joi.number().integer().min(0).required(),
            publicKey: Joi.string().base64().required(),
            signature: Joi.string().base64().required()
        }).required(),
        identityPublicKey: Joi.string().base64().optional(),
        preKeys: Joi.array().items(
            Joi.object({
                keyId: Joi.number().integer().min(0).required(),
                publicKey: Joi.string().base64().required()
            })
        ).min(1).max(100).optional()
    }),

    sendMessage: Joi.object({
        messageId: Joi.string().required(),
        recipientId: Joi.string().when('messageType', {
            is: 'direct',
            then: Joi.required(),
            otherwise: Joi.forbidden()
        }),
        roomId: Joi.string().when('messageType', {
            is: 'group',
            then: Joi.required(),
            otherwise: Joi.forbidden()
        }),
        messageType: Joi.string().valid('direct', 'group').required(),
        encryptedContent: Joi.string().base64().required(),
        encryptionMetadata: Joi.object({
            algorithm: Joi.string().default('XChaCha20-Poly1305'),
            nonce: Joi.string().base64().required(),
            keyVersion: Joi.number().integer().min(0).optional(),
            encryptedKeys: Joi.array().items(
                Joi.object({
                    recipientId: Joi.string().required(),
                    recipientDeviceId: Joi.string().required(),
                    encryptedKey: Joi.string().base64().required(),
                    ephemeralPublicKey: Joi.string().base64().required()
                })
            ).optional()
        }).required(),
        expiresIn: Joi.number().integer().min(0).optional()
    }),

    createRoom: Joi.object({
        name: Joi.string().min(1).max(100).required(),
        description: Joi.string().max(500).optional(),
        participants: Joi.array().items(Joi.string()).min(1).required(),
        settings: Joi.object({
            isPublic: Joi.boolean().optional(),
            maxParticipants: Joi.number().integer().min(2).max(1000).optional(),
            allowInvites: Joi.boolean().optional()
        }).optional()
    }),

    updateDeliveryStatus: Joi.object({
        messageIds: Joi.array().items(Joi.string()).min(1).required(),
        status: Joi.string().valid('delivered', 'read').required()
    })
};

module.exports = {
    validate,
    schemas
};