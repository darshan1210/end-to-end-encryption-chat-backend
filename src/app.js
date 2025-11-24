require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const fs = require('fs');
const helmet = require('helmet');
const cors = require('cors');
const connectDB = require('./config/database');
const { connectRedis } = require('./config/redis');
const logger = require('./config/logger');
const wsServer = require('./websocket/wsServer');
const { errorHandler, notFound } = require('./middleware/errorHandler');


// Import routes
const authRoutes = require('./routes/auth');
const keyRoutes = require('./routes/keys');
const messageRoutes = require('./routes/messages');
const roomRoutes = require('./routes/rooms');

const app = express();

//trust proxy (for rate limiting, IP detection)
app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000', 'http://localhost:8000'];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

//body parsing middleware 
app.use(express.json({ limit: '10mb' }));

app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    logger.info({
        method: req.method,
        path: req.path,
        ip: req.ip,
        userId: req.userId
    }, 'Incoming request');
    next();
});

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        update: process.uptime()
    });
});

//api routes

app.use('/api/auth', authRoutes);
app.use('/api/keys', keyRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/rooms', roomRoutes);

app.get('/', (req, res) => {
    res.json({
        name: 'E2EE Chat backend',
        version: '1.0.0',
        status: 'running'
    });
});

app.use(notFound);
app.use(errorHandler);

async function startServer() {
    try {
        await connectDB();
        await connectRedis();

        let server;
        const PORT = process.env.PORT || 3000;
        const WS_PORT = process.env.WS_PORT || 3001;
        if (process.env.USE_TLS === 'true' && process.env.TLS_CERT_PATH && process.env.TLS_KEY_PATH) {
            // HTTPS server for production
            const options = {
                cert: fs.readFileSync(process.env.TLS_CERT_PATH),
                key: fs.readFileSync(process.env.TLS_KEY_PATH)
            };
            server = https.createServer(options, app);
            logger.info('Using HTTPS (TLS enabled)');
        } else {
            // HTTP server for development
            server = http.createServer(app);
            logger.warn('Using HTTP (TLS disabled). Enable TLS for production!');
        }

        await wsServer.initialize(server);
        // Start listening
        server.listen(PORT, () => {
            logger.info(`Server running on port ${PORT}`);
            logger.info(`WebSocket available at ${process.env.USE_TLS === 'true' ? 'wss' : 'ws'}://localhost:${PORT}/ws`);
            logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        });
        // Graceful shutdown
        const gracefulShutdown = async (signal) => {
            logger.info(`${signal} received, shutting down gracefully...`);

            // Close WebSocket server
            await wsServer.shutdown();

            // Close HTTP server
            server.close(() => {
                logger.info('HTTP server closed');
                process.exit(0);
            });

            // Force close after 10 seconds
            setTimeout(() => {
                logger.error('Could not close connections in time, forcefully shutting down');
                process.exit(1);
            }, 10000);
        };

        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));

        // Handle uncaught errors
        process.on('uncaughtException', (error) => {
            logger.error({ err: error }, 'Uncaught exception');
            gracefulShutdown('uncaughtException');
        });

        process.on('unhandledRejection', (reason, promise) => {
            logger.error({ reason, promise }, 'Unhandled rejection');
            gracefulShutdown('unhandledRejection');
        });

    } catch (error) {
        logger.error({ err: error }, 'Failed to start server');
        process.exit(1);
    }
}

// Start the server
if (require.main === module) {
    startServer();
}

module.exports = app;