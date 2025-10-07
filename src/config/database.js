const mongoose = require('mongoose');
const logger = require('./logger');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 4500,
        });

        logger.info(`MongoDB Connected :${conn.connection.host}`);

        mongoose.connection.on('error', (err) => {
            logger.error({ err }, 'MongoDB connection error');
        });

        mongoose.connection.on('disconnected', () => {
            logger.warn('mongoDB disconneted');
        });

        process.on('SIGINT', async () => {
            await mongoose.connection.close();;
            logger.info('MongoDB connection closed through app termination');
            process.exit(0);
        });

        return conn;
    } catch (error) {
        logger.error({ err: error }, 'Error connecting to MongoDB');
        process.exit(1);
    }
};

module.exports = connectDB;
