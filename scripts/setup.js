#!/usr/bin/env node
/**
 * Setup script for E2EE Chat Backend
 * Initializes database, creates indexes, and validates configuration
 */

require('dotenv').config();
const mongoose = require('mongoose');
const redis = require('redis');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Color output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function success(message) {
    log(`✅ ${message}`, 'green');
}

function error(message) {
    log(`❌ ${message}`, 'red');
}

function warning(message) {
    log(`⚠️  ${message}`, 'yellow');
}

function info(message) {
    log(`ℹ️  ${message}`, 'cyan');
}

async function checkEnvironment() {
    info('Checking environment configuration...');

    const required = [
        'MONGODB_URI',
        'REDIS_HOST',
        'JWT_SECRET',
        'JWT_REFRESH_SECRET'
    ];

    const missing = required.filter(key => !process.env[key]);

    if (missing.length > 0) {
        error(`Missing required environment variables: ${missing.join(', ')}`);
        error('Please copy .env.example to .env and configure all variables');
        process.exit(1);
    }

    // Check JWT secrets strength
    if (process.env.JWT_SECRET.length < 32) {
        warning('JWT_SECRET is too short. Generate a strong secret:');
        console.log(`  openssl rand -base64 64`);
    }

    if (process.env.JWT_REFRESH_SECRET.length < 32) {
        warning('JWT_REFRESH_SECRET is too short. Generate a strong secret:');
        console.log(`  openssl rand -base64 64`);
    }

    success('Environment configuration checked');
}

async function connectMongoDB() {
    info('Connecting to MongoDB...');

    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 5000
        });
        success(`Connected to MongoDB: ${mongoose.connection.host}`);
        return true;
    } catch (err) {
        error(`Failed to connect to MongoDB: ${err.message}`);
        error('Make sure MongoDB is running and the URI is correct');
        return false;
    }
}

async function connectRedis() {
    info('Connecting to Redis...');

    try {
        const client = redis.createClient({
            socket: {
                host: process.env.REDIS_HOST || 'redis://127.0.0.1:6379',
                port: parseInt(process.env.REDIS_PORT) || 6379
            },
            password: process.env.REDIS_PASSWORD || 'admin'
        });

        await client.connect();
        await client.ping();
        success('Connected to Redis');
        await client.quit();
        return true;
    } catch (err) {
        error(`Failed to connect to Redis: ${err.message}`);
        error('Make sure Redis is running and the configuration is correct');
        return false;
    }
}

async function createIndexes() {
    info('Creating database indexes...');

    try {
        // Import models to trigger index creation
        require('../src/models/User');
        require('../src/models/Device');
        require('../src/models/PreKey');
        require('../src/models/Message');
        require('../src/models/Room');

        // Ensure indexes are created
        await mongoose.connection.db.admin().command({ getLog: 'global' });

        success('Database indexes created');
        return true;
    } catch (err) {
        error(`Failed to create indexes: ${err.message}`);
        return false;
    }
}

async function checkTLSConfiguration() {
    info('Checking TLS configuration...');

    if (process.env.USE_TLS === 'true') {
        const certPath = process.env.TLS_CERT_PATH;
        const keyPath = process.env.TLS_KEY_PATH;

        if (!certPath || !keyPath) {
            error('USE_TLS is true but certificate paths not configured');
            return false;
        }

        if (!fs.existsSync(certPath)) {
            error(`TLS certificate not found: ${certPath}`);
            return false;
        }

        if (!fs.existsSync(keyPath)) {
            error(`TLS key not found: ${keyPath}`);
            return false;
        }

        success('TLS configuration valid');
    } else {
        warning('TLS is disabled. Enable for production!');
        info('Generate self-signed cert for testing:');
        console.log('  openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes');
    }

    return true;
}

function generateSecrets() {
    info('Generating secure secrets...');

    const jwtSecret = crypto.randomBytes(64).toString('base64');
    const jwtRefreshSecret = crypto.randomBytes(64).toString('base64');

    console.log('\nAdd these to your .env file:\n');
    console.log(`JWT_SECRET=${jwtSecret}`);
    console.log(`JWT_REFRESH_SECRET=${jwtRefreshSecret}\n`);

    success('Secrets generated');
}

async function createDirectories() {
    info('Creating required directories...');

    const dirs = ['logs', 'backups'];

    for (const dir of dirs) {
        const dirPath = path.join(process.cwd(), dir);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
            success(`Created directory: ${dir}/`);
        }
    }
}

async function validateCryptoLibraries() {
    info('Validating cryptographic libraries...');

    try {
        const nacl = require('tweetnacl');
        const naclUtil = require('tweetnacl-util');

        // Test key generation
        const keyPair = nacl.box.keyPair();
        const message = Buffer.from('test');
        const nonce = nacl.randomBytes(24);
        const encrypted = nacl.box(message, nonce, keyPair.publicKey, keyPair.secretKey);
        const decrypted = nacl.box.open(encrypted, nonce, keyPair.publicKey, keyPair.secretKey);

        if (!decrypted || !Buffer.from(decrypted).equals(message)) {
            throw new Error('Encryption/decryption test failed');
        }

        success('Cryptographic libraries validated');
        return true;
    } catch (err) {
        error(`Crypto validation failed: ${err.message}`);
        return false;
    }
}

async function displaySystemInfo() {
    info('System Information:');
    console.log(`  Node.js: ${process.version}`);
    console.log(`  Platform: ${process.platform}`);
    console.log(`  Architecture: ${process.arch}`);
    console.log(`  MongoDB: ${mongoose.connection.host}`);
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('');
}

async function runSetup() {
    log('\n╔════════════════════════════════════════╗', 'blue');
    log('║  E2EE Chat Backend - Setup Script     ║', 'blue');
    log('╚════════════════════════════════════════╝\n', 'blue');

    try {
        // Step 1: Check environment
        await checkEnvironment();

        // Step 2: Create directories
        await createDirectories();

        // Step 3: Validate crypto libraries
        const cryptoValid = await validateCryptoLibraries();
        if (!cryptoValid) {
            error('Setup failed: Crypto validation error');
            process.exit(1);
        }

        // Step 4: Connect to MongoDB
        const mongoConnected = await connectMongoDB();
        if (!mongoConnected) {
            error('Setup failed: MongoDB connection error');
            process.exit(1);
        }

        // Step 5: Create indexes
        await createIndexes();

        // Step 6: Connect to Redis
        const redisConnected = await connectRedis();
        if (!redisConnected) {
            warning('Redis connection failed. Features requiring Redis will not work.');
        }

        // Step 7: Check TLS configuration
        await checkTLSConfiguration();

        // Step 8: Display system info
        await displaySystemInfo();

        // Success message
        log('\n╔════════════════════════════════════════╗', 'green');
        log('║     Setup completed successfully!     ║', 'green');
        log('╚════════════════════════════════════════╝\n', 'green');

        info('Next steps:');
        console.log('  1. Review your .env configuration');
        console.log('  2. Start the server: npm start');
        console.log('  3. Run the test client: npm test');
        console.log('  4. Check the API documentation at /api-docs\n');

        // Close connections
        await mongoose.connection.close();

        process.exit(0);
    } catch (err) {
        error(`Setup failed: ${err.message}`);
        console.error(err);
        process.exit(1);
    }
}

// Handle command-line arguments
const args = process.argv.slice(2);

if (args.includes('--generate-secrets')) {
    generateSecrets();
    process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
    console.log(`
E2EE Chat Backend Setup Script

Usage:
  node scripts/setup.js              Run full setup
  node scripts/setup.js --generate-secrets    Generate JWT secrets
  node scripts/setup.js --help               Show this help

Options:
  --generate-secrets    Generate secure JWT secrets
  --help, -h           Show help message
  `);
    process.exit(0);
}

// Run setup
runSetup();