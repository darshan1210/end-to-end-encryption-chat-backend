const rateLimit = require('express-rate-limit');
const { getRedisClient } = require('../config/redis');

/**
 * Create rate limiter with Redis store
 */
const createRateLimiter = (options = {}) => {
    const redisClient = getRedisClient();

    const limiter = rateLimit({
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
        max: options.max || parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
        message: options.message || 'Too many requests, please try again later',
        standardHeaders: true,
        legacyHeaders: false,
        // Use Redis for distributed rate limiting
        store: redisClient ? {
            async increment(key) {
                const count = await redisClient.incr(key);
                if (count === 1) {
                    await redisClient.expire(key, Math.ceil(this.windowMs / 1000));
                }
                return { totalHits: count, resetTime: new Date(Date.now() + this.windowMs) };
            },
            async decrement(key) {
                await redisClient.decr(key);
            },
            async resetKey(key) {
                await redisClient.del(key);
            }
        } : undefined,
        skip: (req) => {
            // Skip rate limiting for health checks
            return req.path === '/health';
        },
        keyGenerator: (req) => {
            // Rate limit by user ID if authenticated, otherwise by IP
            return req.userId ? `user:${req.userId}` : `ip:${req.ip}`;
        }
    });

    return limiter;
};

// Specific rate limiters for different endpoints
const authLimiter = createRateLimiter({
    max: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    message: 'Too many authentication attempts, please try again later'
});

const messageLimiter = createRateLimiter({
    max: parseInt(process.env.MESSAGE_RATE_LIMIT) || 50,
    windowMs: 60 * 1000, // 1 minute
    message: 'Message rate limit exceeded'
});

const keyRegistrationLimiter = createRateLimiter({
    max: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
    message: 'Too many key registration attempts'
});

const generalLimiter = createRateLimiter({
    max: 100,
    windowMs: 15 * 60 * 1000
});

module.exports = {
    authLimiter,
    messageLimiter,
    keyRegistrationLimiter,
    generalLimiter,
    createRateLimiter
};