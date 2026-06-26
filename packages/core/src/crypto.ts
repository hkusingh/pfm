import { createCipheriv, createDecipheriv, createHmac, randomBytes, hkdfSync } from 'crypto';

// Wire format: base64( iv[12] | authTag[16] | ciphertext )

function deriveKey(masterKey: Buffer, context: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), context, 32));
}

export function deriveHmacKey(masterKey: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), 'hmac', 32));
}

export function encryptField(plaintext: string, masterKey: Buffer, context: string): string {
  const key = deriveKey(masterKey, context);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export function decryptField(ciphertext: string, masterKey: Buffer, context: string): string {
  const key = deriveKey(masterKey, context);
  const buf = Buffer.from(ciphertext, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final('utf8');
}

export function hmacField(value: string, hmacKey: Buffer): string {
  return createHmac('sha256', hmacKey).update(value).digest('hex');
}

/** Parse ENCRYPTION_KEY env var into a master key Buffer. */
export function masterKeyFromEnv(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? '';
  if (hex.length !== 64) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return Buffer.from(hex, 'hex');
}
