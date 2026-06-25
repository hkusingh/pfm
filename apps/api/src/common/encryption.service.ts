import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, hkdfSync } from 'crypto';

/**
 * AES-256-GCM encryption with per-context key derivation via HKDF.
 *
 * Context is typically the householdId — ensures ciphertext from household A
 * cannot be decrypted with household B's derived key.
 *
 * Wire format: base64( iv[12] | authTag[16] | ciphertext )
 */
@Injectable()
export class EncryptionService {
  private readonly masterKey: Buffer;
  private readonly hmacKey: Buffer;

  constructor() {
    const hex = process.env.ENCRYPTION_KEY ?? '';
    if (hex.length !== 64) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
    this.masterKey = Buffer.from(hex, 'hex');
    this.hmacKey = Buffer.from(hkdfSync('sha256', this.masterKey, Buffer.alloc(0), 'hmac', 32));
  }

  encrypt(plaintext: string, context: string): string {
    const key = this.deriveKey(context);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(ciphertext: string, context: string): string {
    const key = this.deriveKey(context);
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data) + decipher.final('utf8');
  }

  /** HMAC-SHA256 of a value using a dedicated HMAC key (not the encryption key).
   * Used for `merchantRuleHash` — enables exact matching without decryption. */
  hmac(value: string): string {
    return createHmac('sha256', this.hmacKey).update(value).digest('hex');
  }

  private deriveKey(context: string): Buffer {
    return Buffer.from(hkdfSync('sha256', this.masterKey, Buffer.alloc(0), context, 32));
  }
}
