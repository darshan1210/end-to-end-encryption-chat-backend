# API Documentation

Complete reference for all API endpoints.

## Base URL

```
http://localhost:3000/api
```

Production: `https://api.yourdomain.com/api`

## Authentication

Most endpoints require JWT authentication.

**Header**:
```
Authorization: Bearer <access_token>
```

## Response Format

### Success Response
```json
{
  "success": true,
  "data": { /* response data */ },
  "message": "Optional success message"
}
```

### Error Response
```json
{
  "error": "Error message",
  "details": ["Optional error details"]
}
```

## Rate Limiting

- **Authentication**: 5 requests / 15 minutes
- **Messages**: 50 requests / minute
- **Key Registration**: 10 requests / hour
- **General**: 100 requests / 15 minutes

Rate limit headers included in response:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642180800
```

---

## Authentication Endpoints

### POST /auth/signup

Register a new user account.

**Request**:
```json
{
  "username": "alice",
  "email": "alice@example.com",
  "password": "SecurePass123!",
  "displayName": "Alice Smith"
}
```

**Validation**:
- `username`: 3-30 characters, alphanumeric
- `email`: Valid email format
- `password`: Minimum 8 characters
- `displayName`: Optional, max 50 characters

**Response** (201):
```json
{
  "success": true,
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "username": "alice",
    "email": "alice@example.com",
    "displayName": "Alice Smith"
  },
  "message": "User registered successfully"
}
```

**Errors**:
- 400: Validation error
- 409: Email or username already exists

---

### POST /auth/login

Login and optionally register a device.

**Request**:
```json
{
  "email": "alice@example.com",
  "password": "SecurePass123!",
  "deviceId": "device-web-001",
  "deviceName": "Chrome Browser",
  "deviceType": "web"
}
```

**Parameters**:
- `deviceType`: Enum: `web`, `mobile`, `desktop`

**Response** (200) - New Device:
```json
{
  "success": true,
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "username": "alice",
    "email": "alice@example.com",
    "displayName": "Alice Smith",
    "requiresKeyRegistration": true,
    "deviceId": "device-web-001"
  }
}
```

**Response** (200) - Existing Device:
```json
{
  "success": true,
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "username": "alice",
    "deviceId": "device-web-001",
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "requiresKeyRegistration": false
  }
}
```

**Errors**:
- 401: Invalid credentials
- 403: Account locked (too many attempts)

---

### POST /auth/refresh

Refresh access token using refresh token.

**Request**:
```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
  }
}
```

**Errors**:
- 401: Invalid or expired refresh token

---

### POST /auth/logout

Logout from current device.

**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### GET /auth/me

Get current user information.

**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "success": true,
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "username": "alice",
    "email": "alice@example.com",
    "displayName": "Alice Smith",
    "avatar": "https://...",
    "isOnline": true,
    "privacySettings": {
      "showOnlineStatus": true,
      "showTypingIndicator": true,
      "showReadReceipts": true
    }
  }
}
```

---

### GET /auth/devices

Get all devices for current user.

**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "deviceId": "device-web-001",
      "deviceName": "Chrome Browser",
      "deviceType": "web",
      "isActive": true,
      "lastSeen": "2025-01-15T10:30:00.000Z",
      "createdAt": "2025-01-10T08:00:00.000Z"
    }
  ]
}
```

---

### DELETE /auth/devices/:deviceId

Revoke a device.

**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Device revoked successfully"
  }
}
```

---

## Key Management Endpoints

### POST /keys/register

Register device cryptographic keys.

**Headers**: `Authorization: Bearer <token>` (optional for first-time registration)

**Request**:
```json
{
  "deviceId": "device-web-001",
  "publicKey": "base64EncodedX25519PublicKey...",
  "identityPublicKey": "base64EncodedIdentityPublicKey...",
  "signedPreKey": {
    "keyId": 1,
    "publicKey": "base64EncodedPreKeyPublic...",
    "signature": "base64EncodedSignature..."
  },
  "preKeys": [
    {
      "keyId": 0,
      "publicKey": "base64EncodedOneTimePreKey..."
    },
    {
      "keyId": 1,
      "publicKey": "base64EncodedOneTimePreKey..."
    }
  ],
  "deviceName": "Chrome Browser",
  "deviceType": "web"
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "success": true,
    "deviceId": "device-web-001",
    "publicKey": "base64EncodedX25519PublicKey...",
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
  },
  "message": "Device keys registered successfully"
}
```

**Validation**:
- All keys must be valid base64
- PreKeys array: 1-100 items
- KeyIds must be unique

---

### GET /keys/user/:userId

Get public keys for a user (for key exchange).

**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "success": true,
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "identityPublicKey": "base64EncodedIdentityKey...",
    "signedPreKey": {
      "keyId": 1,
      "publicKey": "base64EncodedPreKey...",
      "signature": "base64EncodedSignature...",
      "timestamp": "2025-01-15T10:30:00.000Z"
    },
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

**Note**: One-time prekey is consumed and will not be returned again.

---

### POST /keys/rotate

Rotate device keys.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "publicKey": "newBase64PublicKey...",
  "signedPreKey": {
    "keyId": 2,
    "publicKey": "base64EncodedNewPreKey...",
    "signature": "base64EncodedSignature..."
  },
  "preKeys": [
    /* New one-time prekeys */
  ]
}
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "success": true,
    "message": "Keys rotated successfully"
  }
}
```

---

### POST /keys/prekeys

Upload additional one-time prekeys.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "preKeys": [
    {
      "keyId": 100,
      "publicKey": "base64EncodedKey..."
    }
  ]
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "count": 50
  },
  "message": "PreKeys uploaded successfully"
}
```

---

### GET /keys/prekeys/stats

Get prekey statistics for monitoring.

**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "success": true,
  "data": {
    "total": 100,
    "available": 87,
    "used": 10,
    "expired": 3
  }
}
```

---

### DELETE /keys/prekeys/cleanup

Clean up expired and used prekeys.

**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "success": true,
  "data": {
    "deletedCount": 13
  }
}
```

---

## Message Endpoints

### POST /messages/send

Send an encrypted message.

**Headers**: `Authorization: Bearer <token>`

**Request** (Direct Message):
```json
{
  "messageId": "msg-1234567890-abcdef",
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
        "encryptedKey": "base64EncodedSymmetricKey...",
        "ephemeralPublicKey": "base64EncodedEphemeralPubKey..."
      }
    ]
  },
  "expiresIn": 86400
}
```

**Request** (Group Message):
```json
{
  "messageId": "msg-1234567890-abcdef",
  "roomId": "507f1f77bcf86cd799439012",
  "messageType": "group",
  "encryptedContent": "base64EncodedCiphertext...",
  "encryptionMetadata": {
    "algorithm": "XChaCha20-Poly1305",
    "nonce": "base64EncodedNonce...",
    "keyVersion": 1,
    "encryptedKeys": [
      {
        "recipientId": "user1",
        "recipientDeviceId": "device-1",
        "encryptedKey": "base64...",
        "ephemeralPublicKey": "base64..."
      },
      {
        "recipientId": "user2",
        "recipientDeviceId": "device-2",
        "encryptedKey": "base64...",
        "ephemeralPublicKey": "base64..."
      }
    ]
  }
}
```

**Parameters**:
- `expiresIn`: Optional, seconds until message expires

**Response** (201):
```json
{
  "success": true,
  "data": {
    "messageId": "msg-1234567890-abcdef",
    "senderId": "507f1f77bcf86cd799439012",
    "recipientId": "507f1f77bcf86cd799439011",
    "messageType": "direct",
    "deliveryStatus": "sent",
    "createdAt": "2025-01-15T10:35:00.000Z"
  },
  "message": "Message sent successfully"
}
```

---

### GET /messages/direct/:userId

Get direct messages with a specific user.

**Headers**: `Authorization: Bearer <token>`

**Query Parameters**:
- `limit`: Number of messages (default: 50, max: 100)
- `before`: ISO timestamp (pagination)
- `after`: ISO timestamp (pagination)

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "messageId": "msg-123",
      "senderId": "507f1f77bcf86cd799439011",
      "recipientId": "507f1f77bcf86cd799439012",
      "messageType": "direct",
      "encryptedContent": "base64...",
      "encryptionMetadata": { /* ... */ },
      "deliveryStatus": "read",
      "createdAt": "2025-01-15T10:30:00.000Z"
    }
  ],
  "count": 25
}
```

---

### GET /messages/room/:roomId

Get messages in a room.

**Headers**: `Authorization: Bearer <token>`

**Query Parameters**: Same as direct messages

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "messageId": "msg-456",
      "senderId": "507f1f77bcf86cd799439011",
      "roomId": "507f1f77bcf86cd799439013",
      "messageType": "group",
      "encryptedContent": "base64...",
      "encryptionMetadata": { /* ... */ },
      "recipientStatuses": [
        {
          "recipientId": "user1",
          "status": "read",
          "readAt": "2025-01-15T10:32:00.000Z"
        }
      ],
      "createdAt": "2025-01-15T10:30:00.000Z"
    }
  ],
  "count": 50
}
```

---

### GET /messages/offline

Get messages received while offline.

**Headers**: `Authorization: Bearer <token>`

**Query Parameters**:
- `lastSyncTime`: ISO timestamp (required)

**Response** (200):
```json
{
  "success": true,
  "data": [
    /* Array of messages */
  ],
  "count": 15
}
```

---

### GET /messages/conversations

Get list of conversations.

**Headers**: `Authorization: Bearer <token>`

**Query Parameters**:
- `limit`: Number of conversations (default: 20)

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "type": "direct",
      "user": {
        "username": "bob",
        "displayName": "Bob Smith",
        "avatar": "https://...",
        "isOnline": true
      },
      "lastMessage": {
        "messageId": "msg-123",
        "encryptedContent": "base64...",
        "createdAt": "2025-01-15T10:30:00.000Z"
      },
      "unreadCount": 3
    },
    {
      "_id": "507f1f77bcf86cd799439013",
      "type": "group",
      "room": {
        "roomId": "room-123",
        "name": "Team Chat",
        "avatar": "https://..."
      },
      "lastMessage": { /* ... */ },
      "unreadCount": 7
    }
  ],
  "count": 15
}
```

---

### PUT /messages/:messageId/status

Update message delivery status.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "status": "delivered"
}
```

**Parameters**:
- `status`: Enum: `delivered`, `read`

**Response** (200):
```json
{
  "success": true,
  "data": {
    "messageId": "msg-123",
    "deliveryStatus": "delivered",
    "deliveredAt": "2025-01-15T10:31:00.000Z"
  }
}
```

---

### POST /messages/status/bulk

Bulk update message statuses.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "messageIds": ["msg-123", "msg-124", "msg-125"],
  "status": "read"
}
```

**Response** (200):
```json
{
  "success": true,
  "data": {
    "updated": 3
  }
}
```

---

### POST /messages/search

Search messages by metadata.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "senderId": "507f1f77bcf86cd799439011",
  "startDate": "2025-01-01T00:00:00.000Z",
  "endDate": "2025-01-15T23:59:59.000Z",
  "limit": 50
}
```

**Note**: Cannot search by content (it's encrypted!)

**Response** (200):
```json
{
  "success": true,
  "data": [
    /* Array of matching messages */
  ],
  "count": 25
}
```

---

### DELETE /messages/:messageId

Soft delete a message.

**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "success": true,
  "data": {
    "messageId": "msg-123",
    "isDeleted": true,
    "deletedAt": "2025-01-15T10:40:00.000Z"
  },
  "message": "Message deleted successfully"
}
```

**Note**: Only sender can delete their own messages.

---

## Room (Group Chat) Endpoints

### POST /rooms

Create a new room.

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "name": "Team Chat",
  "description": "Main team discussion",
  "participants": [
    "507f1f77bcf86cd799439011",
    "507f1f77bcf86cd799439012"
  ],
  "settings": {
    "isPublic": false,
    "maxParticipants": 100,
    "allowInvites": true
  }
}
```

**Response** (201):
```json
{
  "success": true,
  "data": {
    "roomId": "room-1234567890-abcdef",
    "name": "Team Chat",
    "description": "Main team discussion",
    "createdBy": "507f1f77bcf86cd799439010",
    "participants": [
      {
        "userId": "507f1f77bcf86cd799439010",
        "role": "admin",
        "joinedAt": "2025-01-15T10:00:00.000Z"
      }
    ],
    "settings": { /* ... */ },
    "createdAt": "2025-01-15T10:00:00.000Z"
  },
  "message": "Room created successfully"
}
```

---

### GET /rooms

Get all rooms for current user.

**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "success": true,
  "data": [
    {
      "roomId": "room-123",
      "name": "Team Chat",
      "description": "Main team discussion",
      "participants": [ /* ... */ ],
      "lastActivity": "2025-01-15T10:30:00.000Z"
    }
  ],
  "count": 5
}
```

---

### GET /rooms/:roomId

Get room details.

**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "success": true,
  "data": {
    "roomId": "room-123",
    "name": "Team Chat",
    "description": "Main team discussion",
    "createdBy": {
      "username": "alice",
      "displayName": "Alice Smith"
    },
    "participants": [
      {
        "userId": {
          "_id": "507f1f77bcf86cd799439011",
          "username": "bob",
          "displayName": "Bob Smith",
          "avatar": "https://..."
        },
        "role": "member",
        "joinedAt": "2025-01-15T10:00:00.000Z"
      }
    ],
    "settings": { /* ... */ },
    "isActive": true
  }
}
```

---

### PUT /rooms/:roomId

Update room details (admin only).

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "name": "Updated Team Chat",
  "description": "New description",
  "avatar": "https://...",
  "settings": {
    "maxParticipants": 200
  }
}
```

**Response** (200):
```json
{
  "success": true,
  "data": { /* Updated room */ },
  "message": "Room updated successfully"
}
```

---

### DELETE /rooms/:roomId

Delete/deactivate a room (creator only).

**Headers**: `Authorization: Bearer <token>`

**Response** (200):
```json
{
  "success": true,
  "message": "Room deleted successfully"
}
```

---

### POST /rooms/:roomId/participants

Add participant to room (admin only).

**Headers**: `Authorization: Bearer <token>`

**Request**:
```json
{
  "userId": "507f1f77bcf86cd799439015"
}
```

**Response** (200):
```json
{
  "success": true,
  "data": { /* Updated room */ },
  "message": "Participant added successfully"
}
```

---

### DELETE /rooms/:roomId/participants/:userId

Remove participant from room.

**Headers**: `Authorization: Bearer <token>`

**Permissions**: Admin or removing self

**Response** (200):
```json
{
  "success": true,
  "data": { /* Updated room */ },
  "message": "Participant removed successfully"
}
```

---

## WebSocket Protocol

### Connection

```javascript
const ws = new WebSocket('ws://localhost:3000/ws?token=<access_token>');
```

### Server → Client Messages

**Connected**:
```json
{
  "type": "connected",
  "userId": "507f1f77bcf86cd799439011",
  "deviceId": "device-web-001",
  "timestamp": "2025-01-15T10:00:00.000Z"
}
```

**New Message**:
```json
{
  "type": "new_message",
  "message": {
    "messageId": "msg-123",
    "senderId": "507f1f77bcf86cd799439012",
    "encryptedContent": "base64...",
    "encryptionMetadata": { /* ... */ },
    "createdAt": "2025-01-15T10:30:00.000Z"
  }
}
```

**Presence Update**:
```json
{
  "type": "presence",
  "userId": "507f1f77bcf86cd799439012",
  "status": "online",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**Typing Indicator**:
```json
{
  "type": "typing",
  "userId": "507f1f77bcf86cd799439012",
  "isTyping": true,
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**Delivery Receipt**:
```json
{
  "type": "delivered_receipt",
  "messageId": "msg-123",
  "userId": "507f1f77bcf86cd799439011",
  "timestamp": "2025-01-15T10:30:00.000Z"
}
```

**Read Receipt**:
```json
{
  "type": "read_receipt",
  "messageId": "msg-123",
  "userId": "507f1f77bcf86cd799439011",
  "timestamp": "2025-01-15T10:31:00.000Z"
}
```

### Client → Server Messages

**Send Message**:
```json
{
  "type": "message",
  "payload": {
    "messageId": "msg-123",
    "recipientId": "507f1f77bcf86cd799439011",
    "messageType": "direct",
    "encryptedContent": "base64...",
    "encryptionMetadata": { /* ... */ }
  }
}
```

**Typing**:
```json
{
  "type": "typing",
  "payload": {
    "conversationId": "507f1f77bcf86cd799439011",
    "conversationType": "direct"
  }
}
```

**Stop Typing**:
```json
{
  "type": "stop_typing",
  "payload": {
    "conversationId": "507f1f77bcf86cd799439011",
    "conversationType": "direct"
  }
}
```

**Delivery Receipt**:
```json
{
  "type": "delivery_receipt",
  "payload": {
    "messageId": "msg-123"
  }
}
```

**Read Receipt**:
```json
{
  "type": "read_receipt",
  "payload": {
    "messageId": "msg-123"
  }
}
```

**Heartbeat**:
```json
{
  "type": "heartbeat"
}
```

---

## Error Codes

| Code | Description                             |
| ---- | --------------------------------------- |
| 400  | Bad Request - Invalid input             |
| 401  | Unauthorized - Invalid/expired token    |
| 403  | Forbidden - Insufficient permissions    |
| 404  | Not Found - Resource doesn't exist      |
| 409  | Conflict - Duplicate resource           |
| 429  | Too Many Requests - Rate limit exceeded |
| 500  | Internal Server Error                   |

---

## OpenAPI/Swagger

Full OpenAPI 3.0 specification available at:
```
GET /api-docs
```

(Note: Implement swagger-ui-express for interactive documentation)