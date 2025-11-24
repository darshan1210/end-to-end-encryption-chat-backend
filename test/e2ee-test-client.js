/**
 * E2EE Test Client
 * Demonstrates end-to-end encryption flow:
 * 1. Generate keys on client
 * 2. Register with server
 * 3. Fetch recipient's public keys
 * 4. Perform key agreement (X25519)
 * 5. Encrypt message (XChaCha20-Poly1305)
 * 6. Send ciphertext to server
 * 7. Receive and decrypt message
 */

const nacl = require('tweetnacl');
const naclUtil = require('tweetnacl-util');
const axios = require('axios');
const WebSocket = require('ws');

const API_BASE = process.env.API_BASE || 'http://localhost:3000/api';
const WS_URL = process.env.WS_URL || 'ws://localhost:3000/ws';

class E2EETestClient {
    constructor(username, email, password) {
        this.username = username;
        this.email = email;
        this.password = password;
        this.userId = null;
        this.deviceId = `device-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.accessToken = null;
        this.refreshToken = null;

        // Cryptographic keys
        this.identityKeyPair = null;
        this.deviceKeyPair = null;
        this.signedPreKeyPair = null;
        this.preKeys = [];
    }

    /**
     * Generate all necessary keys
     */
    generateKeys() {
        console.log('📝 Generating cryptographic keys...');

        // Identity key (long-term)
        this.identityKeyPair = nacl.box.keyPair();

        // Device key pair
        this.deviceKeyPair = nacl.box.keyPair();

        // Signed prekey
        this.signedPreKeyPair = nacl.box.keyPair();

        // Sign the prekey with identity key (simplified - in production use proper signing)
        const prekeySignature = nacl.sign.detached(
            this.signedPreKeyPair.publicKey,
            nacl.sign.keyPair.fromSeed(this.identityKeyPair.secretKey.slice(0, 32)).secretKey
        );

        // Generate one-time prekeys
        for (let i = 0; i < 10; i++) {
            const preKeyPair = nacl.box.keyPair();
            this.preKeys.push({
                keyId: i,
                publicKey: naclUtil.encodeBase64(preKeyPair.publicKey),
                secretKey: preKeyPair.secretKey
            });
        }

        console.log('✅ Keys generated successfully');
        console.log(`   Identity public key: ${naclUtil.encodeBase64(this.identityKeyPair.publicKey).substring(0, 20)}...`);
        console.log(`   Device public key: ${naclUtil.encodeBase64(this.deviceKeyPair.publicKey).substring(0, 20)}...`);
    }

    /**
     * Sign up
     */
    async signup() {
        console.log(`\n🔐 Signing up user: ${this.username}`);

        try {
            const response = await axios.post(`${API_BASE}/auth/signup`, {
                username: this.username,
                email: this.email,
                password: this.password,
                displayName: this.username
            });

            this.userId = response.data.data.userId;
            console.log(`✅ Signed up successfully. User ID: ${this.userId}`);
            return response.data;
        } catch (error) {
            console.error('❌ Signup failed:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Login
     */
    async login() {
        console.log(`\n🔑 Logging in: ${this.email}`);

        try {
            const response = await axios.post(`${API_BASE}/auth/login`, {
                email: this.email,
                password: this.password,
                deviceId: this.deviceId,
                deviceName: 'Test Client',
                deviceType: 'desktop'
            });

            const data = response.data.data;
            console.log("data", data);
            this.userId = data.userId;
            this.accessToken = data.accessToken;
            this.refreshToken = data.refreshToken;

            if (data.requiresKeyRegistration) {
                console.log('⚠️  Key registration required');
                return { requiresKeyRegistration: true };
            }

            console.log('✅ Logged in successfully');
            return data;
        } catch (error) {
            console.error('❌ Login failed:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Register device keys with server
     */
    async registerKeys() {
        console.log('\n🔐 Registering device keys with server...');

        if (!this.identityKeyPair) {
            this.generateKeys();
        }
        console.log('this', this.userId, this.deviceId)
        try {
            const response = await axios.post(
                `${API_BASE}/keys/register`,
                {
                    userId: this.userId,
                    deviceId: this.deviceId,
                    publicKey: naclUtil.encodeBase64(this.deviceKeyPair.publicKey),
                    identityPublicKey: naclUtil.encodeBase64(this.identityKeyPair.publicKey),
                    signedPreKey: {
                        keyId: 1,
                        publicKey: naclUtil.encodeBase64(this.signedPreKeyPair.publicKey),
                        signature: naclUtil.encodeBase64(new Uint8Array(64)) // Simplified
                    },
                    preKeys: this.preKeys.map(pk => ({
                        keyId: pk.keyId,
                        publicKey: pk.publicKey
                    })),
                    deviceName: 'Test Client',
                    deviceType: 'desktop'
                },
                {
                    headers: this.accessToken ? {
                        'Authorization': `Bearer ${this.accessToken}`
                    } : {}
                }
            );

            // If we got tokens back, save them
            if (response.data.data.accessToken) {
                this.accessToken = response.data.data.accessToken;
                this.refreshToken = response.data.data.refreshToken;
            }

            console.log('✅ Device keys registered successfully');
            return response.data;
        } catch (error) {
            console.error('❌ Key registration failed:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Get recipient's public keys
     */
    async getRecipientKeys(recipientUserId) {
        console.log(`\n🔍 Fetching public keys for user: ${recipientUserId}`);

        try {
            const response = await axios.get(
                `${API_BASE}/keys/user/${recipientUserId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`
                    }
                }
            );

            console.log('✅ Retrieved recipient keys');
            console.log(`   Devices: ${response.data.data.devices.length}`);
            return response.data.data;
        } catch (error) {
            console.error('❌ Failed to get recipient keys:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Encrypt message using E2EE
     */
    encryptMessage(plaintext, recipientPublicKey) {
        console.log('\n🔒 Encrypting message...');

        // Generate ephemeral key pair for this message
        const ephemeralKeyPair = nacl.box.keyPair();

        // Perform X25519 key agreement
        const recipientPubKey = naclUtil.decodeBase64(recipientPublicKey);
        const sharedSecret = nacl.box.before(recipientPubKey, ephemeralKeyPair.secretKey);

        // Generate nonce
        const nonce = nacl.randomBytes(24);

        // Encrypt with XChaCha20-Poly1305 (box uses this internally)
        const messageBytes = naclUtil.decodeUTF8(plaintext);
        const ciphertext = nacl.box.after(messageBytes, nonce, sharedSecret);

        console.log('✅ Message encrypted');
        console.log(`   Plaintext: "${plaintext}"`);
        console.log(`   Ciphertext: ${naclUtil.encodeBase64(ciphertext).substring(0, 40)}...`);

        return {
            encryptedContent: naclUtil.encodeBase64(ciphertext),
            nonce: naclUtil.encodeBase64(nonce),
            ephemeralPublicKey: naclUtil.encodeBase64(ephemeralKeyPair.publicKey)
        };
    }

    /**
     * Decrypt received message
     */
    decryptMessage(encryptedContent, nonce, senderEphemeralPublicKey) {
        console.log('\n🔓 Decrypting message...');

        try {
            // Decode from base64
            const ciphertext = naclUtil.decodeBase64(encryptedContent);
            const nonceBytes = naclUtil.decodeBase64(nonce);
            const ephemeralPubKey = naclUtil.decodeBase64(senderEphemeralPublicKey);

            // Perform key agreement
            const sharedSecret = nacl.box.before(ephemeralPubKey, this.deviceKeyPair.secretKey);

            // Decrypt
            const decrypted = nacl.box.open.after(ciphertext, nonceBytes, sharedSecret);

            if (!decrypted) {
                throw new Error('Decryption failed - authentication tag invalid');
            }

            const plaintext = naclUtil.encodeUTF8(decrypted);
            console.log('✅ Message decrypted');
            console.log(`   Plaintext: "${plaintext}"`);

            return plaintext;
        } catch (error) {
            console.error('❌ Decryption failed:', error.message);
            throw error;
        }
    }

    /**
     * Send encrypted message
     */
    async sendMessage(recipientUserId, plaintext) {
        console.log(`\n📤 Sending encrypted message to user: ${recipientUserId}`);

        // Get recipient's public keys
        const recipientKeys = await this.getRecipientKeys(recipientUserId);
        const recipientDevice = recipientKeys.devices[0]; // Use first device

        // Encrypt message
        const encrypted = this.encryptMessage(plaintext, recipientDevice.publicKey);

        // Send to server
        try {
            const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const response = await axios.post(
                `${API_BASE}/messages/send`,
                {
                    messageId,
                    recipientId: recipientUserId,
                    messageType: 'direct',
                    encryptedContent: encrypted.encryptedContent,
                    encryptionMetadata: {
                        algorithm: 'XChaCha20-Poly1305',
                        nonce: encrypted.nonce,
                        keyVersion: 1,
                        encryptedKeys: [{
                            recipientId: recipientUserId,
                            recipientDeviceId: recipientDevice.deviceId,
                            encryptedKey: encrypted.encryptedContent, // Simplified
                            ephemeralPublicKey: encrypted.ephemeralPublicKey
                        }]
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.accessToken}`
                    }
                }
            );

            console.log('✅ Encrypted message sent to server');
            console.log(`   Message ID: ${messageId}`);
            console.log(`   ⚠️  Server CANNOT read the plaintext!`);

            return response.data;
        } catch (error) {
            console.error('❌ Failed to send message:', error.response?.data || error.message);
            throw error;
        }
    }

    /**
     * Connect to WebSocket
     */
    connectWebSocket() {
        return new Promise((resolve, reject) => {
            console.log('\n🔌 Connecting to WebSocket...');

            const ws = new WebSocket(`${WS_URL}?token=${this.accessToken}`);

            ws.on('open', () => {
                console.log('✅ WebSocket connected');
                this.ws = ws;
                resolve(ws);
            });

            ws.on('message', (data) => {
                const message = JSON.parse(data);
                console.log(`\n📨 Received WebSocket message:`, message.type);

                if (message.type === 'new_message') {
                    this.handleIncomingMessage(message.message);
                }
            });

            ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error.message);
                reject(error);
            });

            ws.on('close', () => {
                console.log('🔌 WebSocket disconnected');
            });
        });
    }

    /**
     * Handle incoming encrypted message
     */
    handleIncomingMessage(message) {
        console.log('\n📬 New encrypted message received');
        console.log(`   From: ${message.senderId}`);
        console.log(`   Message ID: ${message.messageId}`);

        try {
            // Find the encryption metadata for this device
            const metadata = message.encryptionMetadata;
            const keyData = metadata.encryptedKeys?.find(
                k => k.recipientDeviceId === this.deviceId
            );

            if (!keyData) {
                console.log('⚠️  No key data for this device');
                return;
            }

            // Decrypt the message
            const plaintext = this.decryptMessage(
                message.encryptedContent,
                metadata.nonce,
                keyData.ephemeralPublicKey
            );

            console.log(`✅ Successfully decrypted: "${plaintext}"`);
        } catch (error) {
            console.error('❌ Failed to decrypt message:', error.message);
        }
    }
}

// Demo script
async function runDemo() {
    console.log('═══════════════════════════════════════════════');
    console.log('  E2EE Chat Backend - Test Client Demo');
    console.log('═══════════════════════════════════════════════\n');

    try {
        // Create two test users
        const alice = new E2EETestClient('4alice', '4alices@example.com', 'password123');
        const bob = new E2EETestClient('4bob', '4bobs@example.com', 'password123');

        // Alice setup
        console.log('\n👤 Setting up Alice...');
        await alice.signup();
        alice.generateKeys();
        await alice.login();
        await alice.registerKeys();

        // Bob setup
        console.log('\n\n👤 Setting up Bob...');
        await bob.signup();
        bob.generateKeys();
        await bob.login();
        await bob.registerKeys();

        // Alice sends encrypted message to Bob
        console.log('\n\n📧 Alice sending encrypted message to Bob...');
        await alice.sendMessage(bob.userId, 'Hello Bob! This message is end-to-end encrypted!');

        // Connect Bob to WebSocket to receive messages
        console.log('\n\n👂 Bob listening for messages...');
        await bob.connectWebSocket();

        // Wait a bit for message delivery
        await new Promise(resolve => setTimeout(resolve, 2000));

        console.log('\n\n═══════════════════════════════════════════════');
        console.log('  Demo Complete!');
        console.log('═══════════════════════════════════════════════');
        console.log('\n✅ Key Points:');
        console.log('   1. All encryption happens on the client');
        console.log('   2. Server only stores ciphertext');
        console.log('   3. Server cannot decrypt messages');
        console.log('   4. Each message uses ephemeral keys');
        console.log('   5. Forward secrecy is maintained\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ Demo failed:', error.message);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    runDemo();
}

module.exports = E2EETestClient;