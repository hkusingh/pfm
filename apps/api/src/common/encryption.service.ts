import { Injectable } from '@nestjs/common';
import { encryptField, decryptField, hmacField, deriveHmacKey, masterKeyFromEnv } from '@pfm/core';

/**
 * AES-256-GCM encryption with per-context key derivation via HKDF.
 * Context is typically the householdId — ciphertext from household A
 * cannot be decrypted with household B's derived key.
 * Core crypto lives in @pfm/core so the demo seed can share the same logic.
 */
@Injectable()
export class EncryptionService {
  private readonly masterKey: Buffer;
  private readonly hmacKey: Buffer;

  constructor() {
    this.masterKey = masterKeyFromEnv();
    this.hmacKey = deriveHmacKey(this.masterKey);
  }

  encrypt(plaintext: string, context: string): string {
    return encryptField(plaintext, this.masterKey, context);
  }

  decrypt(ciphertext: string, context: string): string {
    return decryptField(ciphertext, this.masterKey, context);
  }

  hmac(value: string): string {
    return hmacField(value, this.hmacKey);
  }
}
