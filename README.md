# Enterprise E2EE Chat Backend

A production-ready, scalable backend for an enterprise-level chat application with **end-to-end encryption (E2EE)**. The server never has access to plaintext message content.

## 🔐 Security Features

- **End-to-End Encryption**: All messages encrypted client-side using XChaCha20-Poly1305
- **X25519 Key Exchange**: Elliptic curve Diffie-Hellman for perfect forward secrecy
- **Multi-Device Support**: Each device has its own key pair
- **Prekey Distribution**: Asynchronous message initialization for offline users
- **Key Rotation**: Support for rotating device keys and prekeys
- **Device Revocation**: Ability to revoke compromised devices
- **JWT Authentication**: Secure token-based auth with refresh tokens
- **Rate Limiting**: Protection against brute-force and DoS attacks

## 🏗️ Architecture

- **Node.js + Express**: REST API endpoints
- **WebSocket (ws)**: Real-time message delivery
- **MongoDB**: Encrypted message storage (ciphertext only)
- **Redis**: Pub/sub for scaling across multiple instances
- **TweetNaCl**: Cryptographic primitives (libsodium port)

## 📋 Prerequisites

- Node.js 18+
- MongoDB 5.0+
- Redis 6.0+
- (Production) Valid TLS certificates

## 🚀 Quick Start

### 1. Installation

```bash
# Clone repository
git clone <repository-url>
cd e2ee-chat-backend

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration
```

### 2. Configuration

Edit `.env` file:

```bash
# Database
MONGODB_URI=mongodb://localhost:27017/e2ee-chat
REDIS_HOST=localhost
REDIS_PORT=6379

# JWT Secrets (CHANGE THESE!)
JWT_SECRET=your-super-secret-jwt-key
JWT_REFRESH_SECRET=your-refresh-token-secret

# Security
BCRYPT_ROUNDS=12
USE_TLS=false  # Set to true in production

# For production with TLS:
# USE_TLS=true
# TLS_CERT_PATH=/path/to/cert.pem
# TLS_KEY_PATH=/path/to/key.pem
```

### 3. Start Services

```bash
# Start MongoDB
mongod --dbpath /path/to/data

# Start Redis
redis-server

# Start application
npm start

# Or for development with auto-reload
npm run dev
```

### 4. Test E2EE Flow

```bash
# Run the test client
npm test
```

This will:
1. Create two test users (Alice and Bob)
2. Generate cryptographic keys on the client
3. Register keys with the server
4. Alice sends an encrypted message to Bob
5. Bob receives and decrypts the message
6. Demonstrates that the server cannot read the content

## 📡 API Endpoints

### Authentication

```http
POST /api/auth/signup
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
GET  /api/auth/devices
DELETE /api/auth/devices/:deviceId
```

### Key Management

```http
POST /api/keys/register          # Register device keys
GET  /api/keys/user/:userId      # Get user's public keys
POST /api/keys/rotate            # Rotate device keys
POST /api/keys/prekeys           # Upload prekeys
GET  /api/keys/prekeys/stats     # Get prekey statistics
DELETE /api/keys/prekeys/cleanup # Clean up expired prekeys
```

### Messages

```http
POST /api/messages/send                    # Send encrypted message
GET  /api/messages/direct/:userId          # Get direct messages
GET  /api/messages/room/:roomId            # Get room messages
GET  /api/messages/offline                 # Get offline messages
GET  /api/messages/conversations           # Get conversation list
PUT  /api/messages/:messageId/status       # Update delivery status
POST /api/messages/status/bulk             # Bulk status update
POST /api/messages/search                  # Search messages
DELETE /api/messages/:messageId            # Delete message
```

### Rooms (Group Chats)

```http
POST /api/rooms                            # Create room
GET  /api/rooms                            # Get user's rooms
GET  /api/rooms/:roomId                    # Get room details
PUT  /api/rooms/:roomId                    # Update room
DELETE /api/rooms/:roomId                  # Delete room
POST /api/rooms/:roomId/participants       # Add participant
DELETE /api/rooms/:roomId/participants/:userId # Remove participant
```

### WebSocket

```
ws://localhost:3000/ws?token=<JWT_TOKEN>
```

WebSocket message types:
- `message`: Send encrypted message
- `typing`: Typing indicator
- `stop_typing`: Stop typing
- `delivery_receipt`: Mark delivered
- `read_receipt`: Mark read
- `heartbeat`: Keep-alive ping

## 🔒 E2EE Flow

### 1. Key Generation (Client-Side)

```javascript
// Identity key pair (long-term)
const identityKeyPair = nacl.box.keyPair();

// Device key pair
const deviceKeyPair = nacl.box.keyPair();

// Signed prekey
const signedPreKeyPair = nacl.box.keyPair();

// One-time prekeys
const preKeys = Array.from({ length: 100 }, () => nacl.box.keyPair());
```

### 2. Key Registration

```javascript
// Register public keys with server
await registerKeys({
  deviceId: 'device-123',
  publicKey: base64(deviceKeyPair.publicKey),
  identityPublicKey: base64(identityKeyPair.publicKey),
  signedPreKey: {
    keyId: 1,
    publicKey: base64(signedPreKeyPair.publicKey),
    signature: sign(signedPreKeyPair.publicKey, identityKeyPair.secretKey)
  },
  preKeys: preKeys.map(pk => ({
    keyId: index,
    publicKey: base64(pk.publicKey)
  }))
});
```

### 3. Message Encryption

```javascript
// Fetch recipient's public keys
const recipientKeys = await getRecipientKeys(recipientUserId);

// Generate ephemeral key pair
const ephemeralKeyPair = nacl.box.keyPair();

// Perform X25519 key agreement
const sharedSecret = nacl.box.before(
  recipientKeys.publicKey,
  ephemeralKeyPair.secretKey
);

// Encrypt message
const nonce = nacl.randomBytes(24);
const ciphertext = nacl.box.after(messageBytes, nonce, sharedSecret);

// Send to server
await sendMessage({
  encryptedContent: base64(ciphertext),
  encryptionMetadata: {
    nonce: base64(nonce),
    ephemeralPublicKey: base64(ephemeralKeyPair.publicKey)
  }
});
```

### 4. Message Decryption

```javascript
// Receive encrypted message from server
const message = await receiveMessage();

// Perform key agreement with sender's ephemeral key
const sharedSecret = nacl.box.before(
  message.ephemeralPublicKey,
  myDeviceKeyPair.secretKey
);

// Decrypt
const plaintext = nacl.box.open.after(
  message.ciphertext,
  message.nonce,
  sharedSecret
);
```

## 🎯 Request/Response Examples

### 1. Signup

```bash
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "email": "alice@example.com",
    "password": "SecurePass123!",
    "displayName": "Alice"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "username": "alice",
    "email": "alice@example.com",
    "displayName": "Alice"
  },
  "message": "User registered successfully. Please login to register device keys."
}
```

### 2. Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "alice@example.com",
    "password": "SecurePass123!",
    "deviceId": "device-web-001",
    "deviceName": "Chrome Browser",
    "deviceType": "web"
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "username": "alice",
    "requiresKeyRegistration": true,
    "deviceId": "device-web-001"
  },
  "message": "Login successful. Please register device keys to complete setup."
}
```

### 3. Register Keys

```bash
curl -X POST http://localhost:3000/api/keys/register \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "device-web-001",
    "publicKey": "base64EncodedPublicKey...",
    "identityPublicKey": "base64EncodedIdentityKey...",
    "signedPreKey": {
      "keyId": 1,
      "publicKey": "base64EncodedPreKey...",
      "signature": "base64EncodedSignature..."
    },
    "preKeys": [
      {
        "keyId": 0,
        "publicKey": "base64EncodedOneTimeKey..."
      }
    ]
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "success": true,
    "deviceId": "device-web-001",
    "publicKey": "base64EncodedPublicKey...",
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
  },
  "message": "Device keys registered successfully"
}
```

### 4. Fetch Recipient Keys

```bash
curl -X GET http://localhost:3000/api/keys/user/507f1f77bcf86cd799439011 \
  -H "Authorization: Bearer <access_token>"
```

Response:
```json
{
  "success": true,
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "identityPublicKey": "base64EncodedIdentityKey...",
    "devices": [
      {
        "deviceId": "device-web-001",
        "publicKey": "base64EncodedPublicKey...",
        "signedPreKey": {
          "keyId": 1,
          "publicKey": "base64EncodedPreKey...",
          "signature": "base64EncodedSignature...",
          "timestamp": "2025-01-15T10:30:00.000Z"
        },
        "oneTimePreKey": {
          "keyId": 5,
          "publicKey": "base64EncodedOneTimeKey..."
        }
      }
    ]
  }
}
```

### 5. Send Encrypted Message

```bash
curl -X POST http://localhost:3000/api/messages/send \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "messageId": "msg-1234567890",
    "recipientId": "507f1f77bcf86cd799439011",
    "messageType": "direct",
    "encryptedContent": "base64EncodedCiphertext...",
    "encryptionMetadata": {
      "algorithm": "XChaCha20-Poly1305",
      "nonce": "base64EncodedNonce...",
      "keyVersion": 1,
      "encryptedKeys": [
        {
          "recipientId": "507f1f77bcf86cd799439011",
          "recipientDeviceId": "device-web-001",
          "encryptedKey": "base64EncodedKey...",
          "ephemeralPublicKey": "base64EncodedEphemeralKey..."
        }
      ]
    }
  }'
```

Response:
```json
{
  "success": true,
  "data": {
    "messageId": "msg-1234567890",
    "senderId": "507f1f77bcf86cd799439012",
    "recipientId": "507f1f77bcf86cd799439011",
    "messageType": "direct",
    "encryptedContent": "base64EncodedCiphertext...",
    "deliveryStatus": "sent",
    "createdAt": "2025-01-15T10:35:00.000Z"
  },
  "message": "Message sent successfully"
}
```

### 6. WebSocket Connection

```javascript
const ws = new WebSocket('ws://localhost:3000/ws?token=<access_token>');

ws.on('open', () => {
  console.log('Connected');
});

ws.on('message', (data) => {
  const message = JSON.parse(data);
  
  if (message.type === 'new_message') {
    // Decrypt and display message
    decryptMessage(message.message);
  }
});

// Send encrypted message via WebSocket
ws.send(JSON.stringify({
  type: 'message',
  payload: {
    messageId: 'msg-123',
    recipientId: 'user-456',
    messageType: 'direct',
    encryptedContent: 'base64...',
    encryptionMetadata: { /* ... */ }
  }
}));
```

## 🏭 Production Deployment

### 1. Enable TLS

```bash
# Generate certificates (or use Let's Encrypt)
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365

# Update .env
USE_TLS=true
TLS_CERT_PATH=/path/to/cert.pem
TLS_KEY_PATH=/path/to/key.pem
```

### 2. Environment Variables

Set strong secrets:
```bash
JWT_SECRET=$(openssl rand -base64 64)
JWT_REFRESH_SECRET=$(openssl rand -base64 64)
```

### 3. Scaling

Run multiple instances behind a load balancer:

```bash
# Instance 1
PORT=3001 npm start

# Instance 2
PORT=3002 npm start

# Instance 3
PORT=3003 npm start
```

Redis pub/sub ensures messages are delivered across all instances.

### 4. Monitoring

- Check `/health` endpoint for health checks
- Monitor logs in `./logs/app.log`
- Set up alerts for errors and performance

## 🔧 Maintenance

### Clean Up Expired PreKeys

```bash
curl -X DELETE http://localhost:3000/api/keys/prekeys/cleanup \
  -H "Authorization: Bearer <access_token>"
```

### Revoke Compromised Device

```bash
curl -X DELETE http://localhost:3000/api/auth/devices/device-web-001 \
  -H "Authorization: Bearer <access_token>"
```

### Rotate Keys

```bash
curl -X POST http://localhost:3000/api/keys/rotate \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "publicKey": "newBase64PublicKey...",
    "signedPreKey": { /* ... */ },
    "preKeys": [ /* ... */ ]
  }'
```

## 🔐 Security Considerations

### What the Server Knows (Metadata)

The server has access to:
- User IDs and device IDs
- Message timestamps
- Sender and recipient information
- Message delivery status
- Room membership
- Online/offline status

### What the Server CANNOT Know

The server cannot access:
- Message plaintext content
- User's private keys
- Decryption keys

### Threat Model

**Protected Against:**
- Server compromise (messages remain encrypted)
- Network eavesdropping (TLS + E2EE)
- Passive surveillance
- Unauthorized access

**NOT Protected Against:**
- Client-side malware/keyloggers
- Compromised client devices
- Metadata analysis
- Coerced key disclosure

### Recommendations

1. **Always use TLS** (WSS for WebSocket)
2. **Rotate keys regularly**
3. **Implement rate limiting** (already included)
4. **Monitor for suspicious activity**
5. **Regular security audits**
6. **Educate users** about device security

## 🚀 Upgrading to Signal Protocol

This implementation provides a foundation that can be upgraded to the full Signal Protocol:

1. **Current**: Basic X25519 + XChaCha20-Poly1305
2. **Upgrade Path**:
   - Implement Double Ratchet algorithm
   - Add chain key derivation (KDF chains)
   - Implement out-of-order message handling
   - Add session state management

See `docs/MIGRATION.md` for detailed upgrade instructions.

## 📚 Additional Documentation

- [API Documentation](docs/API.md) - Complete API reference
- [Security Design](docs/SECURITY.md) - Detailed security architecture
- [Deployment Guide](docs/DEPLOYMENT.md) - Production deployment guide

## 🤝 Contributing

Contributions welcome! Please read security guidelines before submitting cryptography-related changes.

## 📄 License

MIT License - See LICENSE file for details

## ⚠️ Disclaimer

This is a reference implementation for educational and development purposes. While it implements strong E2EE, a full security audit is recommended before production use.