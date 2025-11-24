// src/config/redis.js
const redis = require("redis");
const logger = require('./logger');

let redisClient = null;
let redisPub = null;
let redisSub = null;

// Build Redis URL exactly like you want
const redisUrl = process.env.REDIS_URL ||
    `redis://${process.env.REDIS_PASSWORD ? `:${process.env.REDIS_PASSWORD}@` : ''}${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;

const connectRedis = async () => {
    // THIS IS THE KEY FIX: Prevent double connection on nodemon restart
    if (redisClient && redisClient.isOpen) {
        logger.info('Redis clients already connected — reusing existing ones');
        return { redisClient, redisPub, redisSub };
    }

    try {
        // Create 3 SEPARATE clients — this was your main bug before
        redisClient = redis.createClient({
            url: redisUrl,
            socket: {
                reconnectStrategy: (retries) => {
                    if (retries > 10) {
                        logger.error('Redis reconnection attempts exhausted');
                        return new Error('Redis reconnection attempts exhausted');
                    }
                    return Math.min(retries * 100, 3000);
                },
            },
        });

        redisPub = redis.createClient({
            url: redisUrl,
            socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 3000) }
        });

        redisSub = redis.createClient({
            url: redisUrl,
            socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 3000) }
        });

        // Connect all three
        await Promise.all([
            redisClient.connect(),
            redisPub.connect(),
            redisSub.connect()
        ]);

        logger.info('Redis client connected');
        logger.info('Redis publisher connected');
        logger.info('Redis subscriber connected');

        // Error handlers
        redisClient.on('error', (err) => logger.error({ err }, 'Redis client error'));
        redisPub.on('error', (err) => logger.error({ err }, 'Redis pub error'));
        redisSub.on('error', (err) => logger.error({ err }, 'Redis sub error'));

        // Graceful shutdown
        process.removeAllListeners('SIGINT'); // prevent duplicate handlers
        process.on('SIGINT', async () => {
            await Promise.allSettled([
                redisClient?.quit(),
                redisPub?.quit(),
                redisSub?.quit(),
            ]);
            logger.info('Redis connections closed gracefully');
            process.exit(0);
        });

        return { redisClient, redisPub, redisSub };

    } catch (error) {
        logger.error({ err: error }, "Error connecting to Redis");
        throw error;
    }
};

const getRedisClient = () => redisClient;
const getRedisPub = () => redisPub;
const getRedisSub = () => redisSub;

module.exports = {
    connectRedis,
    getRedisClient,
    getRedisPub,
    getRedisSub
};