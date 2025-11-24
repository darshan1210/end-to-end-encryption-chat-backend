# Security Design Document

## Overview

This document describes the end-to-end encryption architecture, cryptographic protocols, threat model, and security limitations of the E2EE chat backend.

## Cryptographic Architecture

### Key Types

#### 1. Identity Key Pair (Long-Term)
- **Algorithm**: X25519 (Curve25519)
- **Purpose**: User's long-term identity
- **Lifetime**: Until explicitly rotated by user
- **Storage**: Public key on server, private key NEVER leaves client
- **Usage**: Sign prekeys, verify identity

#### 2. Device Key Pair
- **Algorithm**: X25519
- **Purpose**: Device-specific encryption key
- **Lifetime**: Device lifetime or until rotation
- **Storage**: Public key on server, private key on client only
- **Usage**: Derive shared secrets with ephemeral keys

#### 3. Signed Prekey
- **Algorithm**: X25519 for key, Ed25519 for signature
- **Purpose**: Medium-term key for initiating sessions
- **Lifetime**: 30 days (configurable)
- **Storage**: Public key on server with signature
- **Usage**: Establish initial shared secret
- **Rotation**: Recommended every 30 days

#### 4. One-Time Prekeys
- **Algorithm**: X25519
- **Purpose**: Single-use keys for forward secrecy
- **Lifetime**: Until used or expired (30 days)
- **Storage**: Public key on server
- **Usage**: Used once per session initiation, then deleted
- **Quantity**: 50-100 per device recommended

### Encryption Protocol

#### Message Encryption Flow

```
1. Sender fetches recipient's public keys:
   - Identity public key
   - Device public key(s)
   - Signed prekey
   - One-time prekey (if available)

2. Sender generates ephemeral key pair for this message

3. Sender performs X25519 key agreement:
   SharedSecret = X25519(EphemeralPrivate, RecipientDevicePublic)

4. Sender encrypts message:
   Ciphertext = XChaCha20-Poly1305(Plaintext, SharedSecret, Nonce)

5. Sender sends to server:
   - Ciphertext
   - Nonce
   - Ephemeral public key
   - Recipient ID
   - Metadata

6. Server stores ciphertext (cannot decrypt)

7. Recipient receives message

8. Recipient performs key agreement:
   SharedSecret = X25519(DevicePrivate, SenderEphemeralPublic)

9. Recipient decrypts:
   Plaintext = XChaCha20-Poly1305-Decrypt(Ciphertext, SharedSecret, Nonce)
```

#### Group Message Encryption

For group chats, we use a hybrid approach:

```
1. Sender generates random symmetric key: GroupKey

2. Sender encrypts message with GroupKey:
   Ciphertext = XChaCha20-Poly1305(Plaintext, GroupKey, Nonce)

3. For each participant:
   - Generate ephemeral key pair
   - Perform X25519 with participant's public key
   - Encrypt GroupKey for that participant
   
4. Send to server:
   - Single ciphertext (same for all)
   - Array of encrypted GroupKeys (one per participant)
   - Each with its own ephemeral public key

5. Each recipient:
   - Finds their encrypted GroupKey
   - Decrypts GroupKey using their device private key
   - Decrypts message using GroupKey
```

### Cryptographic Primitives

#### X25519 (Curve25519)
- **Use**: Elliptic Curve Diffie-Hellman key exchange
- **Key Size**: 32 bytes (256 bits)
- **Security**: ~128-bit security level
- **Properties**: 
  - Fast and constant-time
  - Resistant to timing attacks
  - No point validation required

#### XChaCha20-Poly1305
- **Use**: Authenticated encryption
- **Key Size**: 32 bytes (256 bits)
- **Nonce Size**: 24 bytes (192 bits)
- **Tag Size**: 16 bytes (128 bits)
- **Properties**:
  - AEAD (Authenticated Encryption with Associated Data)
  - Large nonce space (no nonce reuse concerns)
  - Fast in software
  - Constant-time implementation

#### Why These Choices?

1. **X25519**: Industry standard, used by Signal, WhatsApp, age encryption
2. **XChaCha20-Poly1305**: Modern, fast, large nonce space prevents reuse issues
3. **TweetNaCl**: Audited, portable, simple API

## Security Properties

### Forward Secrecy

**Guaranteed**: Each message uses a fresh ephemeral key pair. Compromise of long-term keys does not compromise past messages.

**Implementation**:
- New ephemeral key generated per message
- One-time prekeys deleted after use
- Signed prekeys rotated regularly

### Authentication

**Message Authentication**: XChaCha20-Poly1305 provides AEAD, ensuring:
- Message integrity
- Authentication of sender
- Detection of tampering

**Key Authentication**:
- Signed prekeys authenticated with identity key
- Identity keys can be verified out-of-band (e.g., QR codes, fingerprints)

### Deniability

**Current Status**: NOT PROVIDED

**Limitation**: Messages are authenticated with long-term identity keys, providing non-repudiation.

**Future**: Could implement deniable authentication (like Signal's extended triple DH) in upgrade to full Double Ratchet.

## Threat Model

### Assumptions

**Trusted**:
- Client device (until compromise)
- Client-side code execution
- User's ability to secure their device

**Adversary Capabilities**:
- Full control of server
- Network eavesdropping (mitigated by TLS)
- Can compromise server database
- Cannot break cryptographic primitives

### Threats Mitigated

#### 1. Server Compromise ✅
**Threat**: Attacker gains full access to server and database

**Mitigation**: All messages stored as ciphertext; server cannot decrypt

**Limitation**: Metadata (who talks to whom, when) is visible

#### 2. Network Eavesdropping ✅
**Threat**: Passive network surveillance

**Mitigation**: 
- TLS for transport security
- E2EE ensures encrypted payloads even if TLS broken

#### 3. Replay Attacks ✅
**Threat**: Attacker replays old messages

**Mitigation**:
- Unique message IDs
- Timestamps
- Poly1305 authentication

#### 4. Man-in-the-Middle (Key Exchange) ⚠️
**Threat**: Attacker intercepts initial key exchange

**Mitigation**: 
- Keys fetched over authenticated channel (JWT + TLS)
- Identity key fingerprints should be verified out-of-band

**Limitation**: No automatic MITM protection; requires user verification

### Threats NOT Mitigated

#### 1. Metadata Leakage ❌
**Exposed Metadata**:
- User IDs of sender and recipient
- Timestamp of messages
- Message count and frequency
- Group membership
- Online/offline status
- Typing indicators

**Impact**: Allows traffic analysis, social graph construction

**Mitigation Options**:
- Use mixnets or onion routing (out of scope)
- Padding messages to hide size
- Dummy traffic to hide patterns
- Disable typing indicators (configurable)

#### 2. Client-Side Compromise ❌
**Threat**: Malware, keylogger, or compromised device

**Impact**: All messages accessible to attacker

**Mitigation**: 
- User education
- Device security best practices
- Multi-factor authentication

#### 3. Coerced Key Disclosure ❌
**Threat**: Legal or physical coercion to reveal keys

**Impact**: Past and future messages may be decrypted

**Partial Mitigation**: 
- Forward secrecy protects past messages (if keys deleted)
- Plausible deniability in some jurisdictions

#### 4. Endpoint Security ❌
**Out of Scope**: This backend assumes client is secure

**Responsibility**: Client application must:
- Secure key storage (keychain, secure enclave)
- Prevent key export
- Implement secure deletion
- Protect against side-channel attacks

#### 5. Quantum Computer Attacks ⚠️
**Threat**: Future quantum computers breaking X25519

**Current Status**: X25519 NOT quantum-resistant

**Future Mitigation**: 
- Hybrid schemes (X25519 + post-quantum KEM)
- Monitor NIST post-quantum standards

## Attack Scenarios

### Scenario 1: Database Breach

**Attack**: Hacker dumps entire MongoDB database

**Result**:
- ✅ Message content remains encrypted
- ❌ User accounts, metadata exposed
- ❌ Public keys visible
- ✅ Private keys not stored on server

**Impact**: LOW (for message confidentiality)

### Scenario 2: Server Compromise

**Attack**: Attacker gains root access to server

**Result**:
- ✅ Cannot decrypt existing messages
- ❌ Could modify server code to log future plaintext (client must verify integrity)
- ❌ Could inject malicious keys
- ❌ Full metadata access

**Impact**: MEDIUM (requires client-side verification)

### Scenario 3: TLS Downgrade

**Attack**: Attacker forces HTTP instead of HTTPS

**Result**:
- ✅ Message content still encrypted (E2EE layer)
- ❌ JWT tokens exposed
- ❌ Metadata visible
- ❌ MITM possible for key exchange

**Impact**: MEDIUM (E2EE protects content, but metadata leaks)

### Scenario 4: Stolen Device

**Attack**: Physical device theft

**Result**:
- ❌ All messages on device accessible
- ✅ Cannot decrypt messages on other devices
- ✅ Device can be revoked

**Impact**: HIGH (for that device's messages)

**Mitigation**: 
- Device PIN/biometric
- Secure key storage
- Remote device revocation

## Metadata Minimization

### Currently Exposed

| Metadata          | Visibility | Can Be Hidden?                  |
| ----------------- | ---------- | ------------------------------- |
| Sender ID         | Server     | No (for delivery)               |
| Recipient ID      | Server     | No (for delivery)               |
| Timestamp         | Server     | Partially (coarsen granularity) |
| Message size      | Server     | Yes (padding)                   |
| Online status     | Server     | Yes (user setting)              |
| Typing indicators | Server     | Yes (user setting)              |
| Read receipts     | Server     | Yes (user setting)              |
| Group membership  | Server     | No (for delivery)               |

### Recommendations

1. **Padding**: Pad all messages to fixed size buckets (e.g., 256B, 1KB, 4KB)
2. **Dummy Traffic**: Send fake messages to hide real communication patterns
3. **Privacy Settings**: Allow users to disable:
   - Online status
   - Typing indicators
   - Read receipts
4. **Coarse Timestamps**: Round timestamps to nearest minute/hour
5. **Onion Routing**: Use Tor or mixnets for transport (separate layer)

## Key Management Best Practices

### Key Generation

```javascript
// Generate cryptographically secure random keys
const keyPair = nacl.box.keyPair(); // Uses crypto.randomBytes

// NEVER use weak RNG
// ❌ Math.random()
// ❌ Predictable seeds
```

### Key Storage

**Client-Side** (recommended):
```javascript
// Browser
- WebCrypto API (non-extractable keys)
- IndexedDB (encrypted with user password)

// Mobile
- iOS: Secure Enclave / Keychain
- Android: Keystore System

// Desktop
- OS keyring (libsecret, Keychain, Windows Credential Manager)
```

**NEVER**:
- Store private keys in localStorage
- Send private keys to server
- Log private keys
- Store keys in plain text files

### Key Rotation

**Recommended Schedule**:
- Identity key: Only on compromise or explicit user action
- Device keys: Every 90 days or on suspicious activity
- Signed prekeys: Every 30 days
- One-time prekeys: Generate new batch when supply low

### Key Revocation

**When to Revoke**:
- Device lost or stolen
- Suspected compromise
- Selling/disposing device
- Security audit requirement

**Process**:
1. User initiates revocation via API
2. Server marks device as revoked
3. Server rejects messages from revoked device
4. Other devices notified
5. Revoked device keys deleted from server

## Compliance Considerations

### GDPR (EU)

**Right to Access**: Users can export their data
- Message ciphertext (user has keys to decrypt)
- Metadata
- Account information

**Right to Erasure**: 
- Soft delete marks messages as deleted
- Hard delete removes ciphertext from database
- **Limitation**: Recipients still have copies

**Data Minimization**: ✅
- Only essential metadata stored
- No plaintext content on server

### HIPAA (Healthcare)

**Encryption**: ✅ E2EE provides encryption at rest and in transit

**Access Controls**: ✅ JWT-based authentication

**Audit Logs**: Implement audit logging for compliance

**Limitations**: Shared responsibility - client must also be compliant

## Security Audit Checklist

Before production deployment:

- [ ] Independent security audit of cryptographic implementation
- [ ] Penetration testing
- [ ] Code review by cryptography experts
- [ ] Threat modeling workshop
- [ ] Verify constant-time operations
- [ ] Test key rotation procedures
- [ ] Validate input sanitization
- [ ] Review rate limiting thresholds
- [ ] Test authentication bypass attempts
- [ ] Verify TLS configuration (A+ on SSL Labs)
- [ ] Review logging (no sensitive data logged)
- [ ] Test device revocation
- [ ] Verify forward secrecy
- [ ] Test cross-device scenarios
- [ ] Review error messages (no information leakage)

## Known Limitations

1. **Not Signal Protocol**: This is a simplified implementation, not the full Double Ratchet
2. **No Automatic MITM Protection**: Identity keys must be verified out-of-band
3. **Metadata Visible**: Server sees communication graph
4. **No Post-Quantum**: X25519 vulnerable to future quantum attacks
5. **No Deniability**: Messages are non-repudiable
6. **Trust in Client**: Assumes client device is secure
7. **No Multi-Device Sync**: Each device has separate keys (by design)

## Upgrading to Signal Protocol

See [MIGRATION.md](MIGRATION.md) for detailed instructions on implementing:
- Double Ratchet algorithm
- Symmetric-key ratchet
- Header encryption
- Out-of-order message handling
- Session state management

## References

- [Signal Protocol Specification](https://signal.org/docs/)
- [NaCl Cryptographic Library](https://nacl.cr.yp.to/)
- [RFC 8439: ChaCha20 and Poly1305](https://tools.ietf.org/html/rfc8439)
- [RFC 7748: Elliptic Curves for Security](https://tools.ietf.org/html/rfc7748)
- [Messaging Layer Security (MLS)](https://messaginglayersecurity.rocks/)

## Contact

For security issues, please contact: security@example.com

**Do not** disclose security vulnerabilities publicly.