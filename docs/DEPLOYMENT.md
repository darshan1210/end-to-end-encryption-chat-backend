# Migration to Signal Protocol (Double Ratchet)

This guide explains how to upgrade from the current simplified E2EE implementation to the full Signal Protocol with Double Ratchet.

## Current vs Signal Protocol

### Current Implementation

**What we have**:
- X25519 key exchange
- XChaCha20-Poly1305 encryption
- Ephemeral keys per message
- One-time prekeys
- Forward secrecy

**What we're missing**:
- Double Ratchet algorithm
- Symmetric-key ratcheting
- Out-of-order message handling
- Header encryption
- Future secrecy (healing from key compromise)

### Signal Protocol Additions

The Signal Protocol (Extended Triple Diffie-Hellman + Double Ratchet) provides:

1. **Symmetric-Key Ratchet**: Continuous key derivation
2. **DH Ratchet**: Regular key agreement updates
3. **Future Secrecy**: Recovery from key compromise
4. **Out-of-Order Messages**: Handle network delays
5. **Deniability**: Plausible deniability of authorship

## Architecture Changes

### 1. Session State Management

Add session state per conversation:

```javascript
// New model: Session.js
const sessionSchema = new mongoose.Schema({
  userId: ObjectId,
  deviceId: String,
  conversationId: String, // userId or roomId
  conversationType: String, // 'direct' or 'group'
  
  // Double Ratchet State
  rootKey: Buffer,
  sendingChainKey: Buffer,
  receivingChainKey: Buffer,
  dhRatchetKeyPair: {
    publicKey: Buffer,
    privateKey: Buffer
  },
  remoteRatchetPublicKey: Buffer,
  
  // Message numbers
  sendingMessageNumber: Number,
  receivingMessageNumber: Number,
  previousSendingChainLength: Number,
  
  // Skipped message keys (for out-of-order)
  skippedMessageKeys: Map,
  
  // Metadata
  createdAt: Date,
  lastRatchetAt: Date
});
```

### 2. Key Derivation Function (KDF)

Implement KDF for deriving keys:

```javascript
// utils/kdf.js
const crypto = require('crypto');

class KDF {
  /**
   * HKDF (HMAC-based Key Derivation Function)
   */
  static hkdf(inputKeyMaterial, salt, info, outputLength = 32) {
    // Extract
    const prk = crypto.createHmac('sha256', salt)
      .update(inputKeyMaterial)
      .digest();
    
    // Expand
    let okm = Buffer.alloc(0);
    let t = Buffer.alloc(0);
    const iterations = Math.ceil(outputLength / 32);
    
    for (let i = 1; i <= iterations; i++) {
      t = crypto.createHmac('sha256', prk)
        .update(Buffer.concat([t, info, Buffer.from([i])]))
        .digest();
      okm = Buffer.concat([okm, t]);
    }
    
    return okm.slice(0, outputLength);
  }

  /**
   * Derive root key and chain key
   */
  static deriveRootKey(rootKey, dhOutput) {
    const derived = this.hkdf(
      dhOutput,
      rootKey,
      Buffer.from('WhisperRatchet'),
      64
    );
    
    return {
      newRootKey: derived.slice(0, 32),
      newChainKey: derived.slice(32, 64)
    };
  }

  /**
   * Derive message key from chain key
   */
  static deriveMessageKey(chainKey) {
    const messageKey = crypto.createHmac('sha256', chainKey)
      .update(Buffer.from([0x01]))
      .digest();
    
    const newChainKey = crypto.createHmac('sha256', chainKey)
      .update(Buffer.from([0x02]))
      .digest();
    
    return { messageKey, newChainKey };
  }

  /**
   * Derive encryption keys from message key
   */
  static deriveMessageKeys(messageKey) {
    const keys = this.hkdf(
      messageKey,
      Buffer.alloc(32),
      Buffer.from('WhisperMessageKeys'),
      80
    );
    
    return {
      encryptionKey: keys.slice(0, 32),
      authenticationKey: keys.slice(32, 64),
      iv: keys.slice(64, 80)
    };
  }
}

module.exports = KDF;
```

### 3. Double Ratchet Implementation

```javascript
// services/doubleRatchetService.js
const nacl = require('tweetnacl');
const KDF = require('../utils/kdf');
const Session = require('../models/Session');

class DoubleRatchetService {
  /**
   * Initialize session (sender side)
   */
  async initializeSession(userId, deviceId, conversationId, bobPublicKey) {
    // Generate initial DH key pair
    const dhKeyPair = nacl.box.keyPair();
    
    // Perform DH
    const dhOutput = nacl.scalarMult(dhKeyPair.secretKey, bobPublicKey);
    
    // Derive initial root key
    const initialRootKey = Buffer.alloc(32); // From initial handshake
    const { newRootKey, newChainKey } = KDF.deriveRootKey(initialRootKey, dhOutput);
    
    // Create session
    const session = await Session.create({
      userId,
      deviceId,
      conversationId,
      conversationType: 'direct',
      rootKey: newRootKey,
      sendingChainKey: newChainKey,
      receivingChainKey: null,
      dhRatchetKeyPair: {
        publicKey: dhKeyPair.publicKey,
        privateKey: dhKeyPair.secretKey
      },
      remoteRatchetPublicKey: bobPublicKey,
      sendingMessageNumber: 0,
      receivingMessageNumber: 0,
      previousSendingChainLength: 0,
      skippedMessageKeys: new Map()
    });
    
    return session;
  }

  /**
   * Encrypt message with Double Ratchet
   */
  async encryptMessage(session, plaintext) {
    // Derive message key from sending chain
    const { messageKey, newChainKey } = KDF.deriveMessageKey(session.sendingChainKey);
    
    // Update chain key
    session.sendingChainKey = newChainKey;
    
    // Derive encryption keys
    const { encryptionKey, authenticationKey, iv } = KDF.deriveMessageKeys(messageKey);
    
    // Encrypt message
    const ciphertext = this.encrypt(plaintext, encryptionKey, iv);
    
    // Create header
    const header = {
      dhRatchetPublicKey: session.dhRatchetKeyPair.publicKey,
      previousSendingChainLength: session.previousSendingChainLength,
      messageNumber: session.sendingMessageNumber
    };
    
    // Authenticate header + ciphertext
    const mac = this.computeMAC(authenticationKey, header, ciphertext);
    
    // Increment message number
    session.sendingMessageNumber++;
    await session.save();
    
    return {
      header,
      ciphertext,
      mac
    };
  }

  /**
   * Decrypt message with Double Ratchet
   */
  async decryptMessage(session, header, ciphertext, mac) {
    // Check if we need to perform DH ratchet step
    if (!session.remoteRatchetPublicKey.equals(header.dhRatchetPublicKey)) {
      await this.performDHRatchet(session, header.dhRatchetPublicKey);
    }
    
    // Try to decrypt with receiving chain
    let messageKey;
    
    // Check for skipped messages
    const skippedKey = this.trySkippedMessageKeys(session, header, mac);
    if (skippedKey) {
      messageKey = skippedKey;
    } else {
      // Skip messages if necessary
      await this.skipMessageKeys(session, header.messageNumber);
      
      // Derive message key
      const result = KDF.deriveMessageKey(session.receivingChainKey);
      messageKey = result.messageKey;
      session.receivingChainKey = result.newChainKey;
      session.receivingMessageNumber++;
    }
    
    // Derive decryption keys
    const { encryptionKey, authenticationKey, iv } = KDF.deriveMessageKeys(messageKey);
    
    // Verify MAC
    const computedMAC = this.computeMAC(authenticationKey, header, ciphertext);
    if (!computedMAC.equals(mac)) {
      throw new Error('Authentication failed');
    }
    
    // Decrypt
    const plaintext = this.decrypt(ciphertext, encryptionKey, iv);
    
    await session.save();
    return plaintext;
  }

  /**
   * Perform DH ratchet step
   */
  async performDHRatchet(session, newRemotePublicKey) {
    // Store previous chain length
    session.previousSendingChainLength = session.sendingMessageNumber;
    
    // Reset message numbers
    session.sendingMessageNumber = 0;
    session.receivingMessageNumber = 0;
    
    // Update remote ratchet key
    session.remoteRatchetPublicKey = newRemotePublicKey;
    
    // Perform DH with remote's new key
    const dhOutput = nacl.scalarMult(
      session.dhRatchetKeyPair.privateKey,
      newRemotePublicKey
    );
    
    // Derive new receiving chain
    const result1 = KDF.deriveRootKey(session.rootKey, dhOutput);
    session.rootKey = result1.newRootKey;
    session.receivingChainKey = result1.newChainKey;
    
    // Generate new DH key pair
    const newDHKeyPair = nacl.box.keyPair();
    session.dhRatchetKeyPair = {
      publicKey: newDHKeyPair.publicKey,
      privateKey: newDHKeyPair.secretKey
    };
    
    // Perform DH with our new key
    const dhOutput2 = nacl.scalarMult(
      newDHKeyPair.secretKey,
      newRemotePublicKey
    );
    
    // Derive new sending chain
    const result2 = KDF.deriveRootKey(session.rootKey, dhOutput2);
    session.rootKey = result2.newRootKey;
    session.sendingChainKey = result2.newChainKey;
  }

  /**
   * Skip message keys for out-of-order messages
   */
  async skipMessageKeys(session, untilMessageNumber) {
    if (session.receivingMessageNumber + 1000 < untilMessageNumber) {
      throw new Error('Too many skipped messages');
    }
    
    while (session.receivingMessageNumber < untilMessageNumber) {
      const result = KDF.deriveMessageKey(session.receivingChainKey);
      
      // Store skipped key
      const key = `${session.remoteRatchetPublicKey.toString('base64')}:${session.receivingMessageNumber}`;
      session.skippedMessageKeys.set(key, result.messageKey);
      
      session.receivingChainKey = result.newChainKey;
      session.receivingMessageNumber++;
    }
  }

  /**
   * Try to use skipped message key
   */
  trySkippedMessageKeys(session, header, mac) {
    const key = `${header.dhRatchetPublicKey.toString('base64')}:${header.messageNumber}`;
    const messageKey = session.skippedMessageKeys.get(key);
    
    if (messageKey) {
      session.skippedMessageKeys.delete(key);
      return messageKey;
    }
    
    return null;
  }

  /**
   * Encrypt with AES-256-CBC
   */
  encrypt(plaintext, key, iv) {
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([cipher.update(plaintext), cipher.final()]);
  }

  /**
   * Decrypt with AES-256-CBC
   */
  decrypt(ciphertext, key, iv) {
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /**
   * Compute HMAC for authentication
   */
  computeMAC(key, header, ciphertext) {
    const data = Buffer.concat([
      Buffer.from(JSON.stringify(header)),
      ciphertext
    ]);
    return crypto.createHmac('sha256', key).update(data).digest();
  }
}

module.exports = new DoubleRatchetService();
```

### 4. Extended Triple Diffie-Hellman (X3DH)

Implement proper session initialization:

```javascript
// services/x3dhService.js
const nacl = require('tweetnacl');
const KDF = require('../utils/kdf');

class X3DHService {
  /**
   * Initialize session using X3DH
   */
  async initializeSession(
    identityKeyPair,
    ephemeralKeyPair,
    recipientIdentityKey,
    recipientSignedPreKey,
    recipientOneTimePreKey
  ) {
    // Perform 4 DH operations (or 3 if no one-time prekey)
    const dh1 = nacl.scalarMult(identityKeyPair.secretKey, recipientSignedPreKey);
    const dh2 = nacl.scalarMult(ephemeralKeyPair.secretKey, recipientIdentityKey);
    const dh3 = nacl.scalarMult(ephemeralKeyPair.secretKey, recipientSignedPreKey);
    
    let dhCombined;
    if (recipientOneTimePreKey) {
      const dh4 = nacl.scalarMult(ephemeralKeyPair.secretKey, recipientOneTimePreKey);
      dhCombined = Buffer.concat([dh1, dh2, dh3, dh4]);
    } else {
      dhCombined = Buffer.concat([dh1, dh2, dh3]);
    }
    
    // Derive shared secret
    const sharedSecret = KDF.hkdf(
      dhCombined,
      Buffer.alloc(32),
      Buffer.from('WhisperText'),
      32
    );
    
    return sharedSecret;
  }

  /**
   * Accept session (receiver side)
   */
  async acceptSession(
    identityKeyPair,
    signedPreKeyPair,
    oneTimePreKeyPair,
    senderIdentityKey,
    senderEphemeralKey
  ) {
    // Perform DH operations (receiver side)
    const dh1 = nacl.scalarMult(signedPreKeyPair.secretKey, senderIdentityKey);
    const dh2 = nacl.scalarMult(identityKeyPair.secretKey, senderEphemeralKey);
    const dh3 = nacl.scalarMult(signedPreKeyPair.secretKey, senderEphemeralKey);
    
    let dhCombined;
    if (oneTimePreKeyPair) {
      const dh4 = nacl.scalarMult(oneTimePreKeyPair.secretKey, senderEphemeralKey);
      dhCombined = Buffer.concat([dh1, dh2, dh3, dh4]);
    } else {
      dhCombined = Buffer.concat([dh1, dh2, dh3]);
    }
    
    // Derive shared secret
    const sharedSecret = KDF.hkdf(
      dhCombined,
      Buffer.alloc(32),
      Buffer.from('WhisperText'),
      32
    );
    
    return sharedSecret;
  }
}

module.exports = new X3DHService();
```

## Migration Steps

### Phase 1: Add New Models

1. Create `Session` model for storing ratchet state
2. Update `Message` model to include Double Ratchet headers
3. Add version field to distinguish old vs new messages

### Phase 2: Implement Core Algorithms

1. Implement KDF utility
2. Implement X3DH session initialization
3. Implement Double Ratchet encryption/decryption
4. Add session management service

### Phase 3: Update API Endpoints

1. Add session initialization endpoint
2. Update message send to use Double Ratchet
3. Update message receive to handle both formats
4. Add session management endpoints (reset, etc.)

### Phase 4: Client Updates

1. Update client crypto library
2. Implement session state management
3. Update message encryption flow
4. Add migration logic for existing users

### Phase 5: Gradual Rollout

1. Deploy server with backward compatibility
2. Update clients gradually
3. Support both old and new formats during transition
4. Monitor and fix issues
5. Eventually deprecate old format

## Backward Compatibility

Support both formats during migration:

```javascript
async sendMessage(session, plaintext) {
  // Check session version
  if (session.version === 'v2') {
    return await doubleRatchetService.encryptMessage(session, plaintext);
  } else {
    // Fall back to old format
    return await legacyEncrypt(plaintext);
  }
}

async receiveMessage(message) {
  // Detect message format
  if (message.header && message.header.dhRatchetPublicKey) {
    // New Double Ratchet format
    return await doubleRatchetService.decryptMessage(session, message);
  } else {
    // Old format
    return await legacyDecrypt(message);
  }
}
```

## Testing Strategy

### 1. Unit Tests

```javascript
describe('Double Ratchet', () => {
  it('should initialize session correctly', async () => {
    const session = await doubleRatchetService.initializeSession(...);
    expect(session.rootKey).toBeDefined();
    expect(session.sendingChainKey).toBeDefined();
  });

  it('should encrypt and decrypt message', async () => {
    const plaintext = 'Hello World';
    const encrypted = await doubleRatchetService.encryptMessage(session, plaintext);
    const decrypted = await doubleRatchetService.decryptMessage(session, encrypted);
    expect(decrypted.toString()).toBe(plaintext);
  });

  it('should handle out-of-order messages', async () => {
    // Send messages 0, 1, 2
    const msg0 = await encrypt(session, 'msg0');
    const msg1 = await encrypt(session, 'msg1');
    const msg2 = await encrypt(session, 'msg2');
    
    // Receive in order: 0, 2, 1
    await decrypt(session, msg0);
    await decrypt(session, msg2); // Should skip msg1
    await decrypt(session, msg1); // Should use skipped key
  });

  it('should perform DH ratchet', async () => {
    const initialRootKey = session.rootKey;
    await doubleRatchetService.performDHRatchet(session, newPublicKey);
    expect(session.rootKey).not.toEqual(initialRootKey);
  });
});
```

### 2. Integration Tests

```javascript
describe('E2E Double Ratchet', () => {
  it('should exchange messages between two users', async () => {
    const alice = await createUser('alice');
    const bob = await createUser('bob');
    
    // Initialize session
    const aliceSession = await initSession(alice, bob);
    const bobSession = await initSession(bob, alice);
    
    // Alice sends to Bob
    const encrypted = await alice.encrypt('Hello Bob');
    const decrypted = await bob.decrypt(encrypted);
    
    expect(decrypted).toBe('Hello Bob');
  });

  it('should maintain forward secrecy', async () => {
    // Send multiple messages
    await sendMessages(alice, bob, 10);
    
    // Compromise session
    const compromisedKey = session.rootKey;
    
    // Previous messages should still be secure
    expect(() => decryptOldMessage(compromisedKey)).toThrow();
  });
});
```

## Performance Considerations

### 1. Session Storage

- Store sessions in Redis for fast access
- Cache active sessions in memory
- Implement LRU eviction for inactive sessions

### 2. Key Derivation

- KDF operations are CPU-intensive
- Consider using worker threads for heavy operations
- Batch key derivations where possible

### 3. Skipped Message Keys

- Limit maximum skipped messages (e.g., 1000)
- Implement cleanup for old skipped keys
- Monitor memory usage

## Security Improvements

### 1. Header Encryption

Encrypt message headers to hide metadata:

```javascript
function encryptHeader(header, headerKey) {
  const nonce = nacl.randomBytes(24);
  const encrypted = nacl.secretbox(
    Buffer.from(JSON.stringify(header)),
    nonce,
    headerKey
  );
  return { encrypted, nonce };
}
```

### 2. Deniable Authentication

Signal Protocol provides deniability through:
- No long-term signing keys for messages
- Symmetric authentication (MAC)
- Both parties can forge transcripts

### 3. Post-Quantum Resistance

Add post-quantum KEM for hybrid scheme:

```javascript
// Hybrid key agreement
const classicalDH = x25519(privateKey, publicKey);
const postQuantumKEM = kyber512.encapsulate(publicKey);
const hybridSecret = KDF.hkdf(
  Buffer.concat([classicalDH, postQuantumKEM.sharedSecret]),
  salt,
  info,
  32
);
```

## Monitoring & Metrics

Track during migration:

- Session creation rate
- Message encryption/decryption latency
- DH ratchet frequency
- Skipped message count
- Session storage size
- Key derivation time
- Error rates

## Common Issues & Solutions

### Issue 1: Out-of-Order Messages

**Problem**: Messages arrive out of order due to network delays

**Solution**: Double Ratchet handles this automatically with skipped message keys

### Issue 2: Session Desynchronization

**Problem**: Sessions get out of sync due to errors

**Solution**: Implement session reset protocol

```javascript
async resetSession(userId, conversationId) {
  await Session.deleteOne({ userId, conversationId });
  return await initializeNewSession(userId, conversationId);
}
```

### Issue 3: Memory Usage

**Problem**: Too many skipped keys in memory

**Solution**: Limit and cleanup

```javascript
// Limit skipped messages
const MAX_SKIP = 1000;

// Cleanup old keys
setInterval(() => {
  cleanupOldSkippedKeys(maxAge);
}, 3600000);
```

## Resources

- [Signal Protocol Specification](https://signal.org/docs/)
- [Double Ratchet Algorithm](https://signal.org/docs/specifications/doubleratchet/)
- [X3DH Key Agreement](https://signal.org/docs/specifications/x3dh/)
- [XEdDSA Signatures](https://signal.org/docs/specifications/xeddsa/)

## Conclusion

Upgrading to Signal Protocol provides:
- ✅ Stronger forward secrecy
- ✅ Future secrecy (healing)
- ✅ Out-of-order message handling
- ✅ Better deniability
- ✅ Industry-standard security

The migration can be done gradually with backward compatibility, ensuring minimal disruption to users.

## Next Steps

1. Review this migration guide with security team
2. Implement in staging environment
3. Conduct thorough security audit
4. Test with small user group
5. Gradual rollout to production
6. Monitor and iterate