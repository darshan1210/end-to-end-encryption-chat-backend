const redis = require("redis");
const logger = require('./logger');

let redisClient = null;
let redisPub = null;
let redisSub = null;

const createRedisClient = () => {
    return redis.createClient({
        socket: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT) || 6379
        },
        password: process.env.REDIS_PASSWORD || undefined,
        database: parseInt(process.env.REDIS_DB) || 0,
        lazyConnect: true
    });
};

const connectRedis = async () => {
    try {

        redisClient = createRedisClient();
        await redisClient.connect();
        logger.info('Redis client connected');

        redisPub = createRedisClient();
        await redisPub.connect();
        logger.info('Redis publisher connected');

        redisSub = createRedisClient();
        await redisSub.connect();
        logger.info('Redis subscriber connected');


        redisClient.on('error', (err) => logger.error({ err }, 'Redis client error'));
        redisPub.on('error', (err) => logger.error({ err }, 'Redis pub error'));
        redisSub.on('error', (err) => logger.error({ err }, 'Redis sbub error'));

        process.on('SIGINT', async () => {
            await Promise.all([
                redisClient.quit(),
                redisPub.quit(),
                redisSub.quit(),
            ]);
            logger.info('Redis connection closed');

        })
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
}