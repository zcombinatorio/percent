import { Keypair } from '@solana/web3.js';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypt a Solana keypair
 */
export function encryptKeypair(keypair: Keypair, encryptionKey: string): string {
  const key = Buffer.from(encryptionKey, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(keypair.secretKey),
    cipher.final()
  ]);

  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

/**
 * Decrypt an encrypted keypair
 */
export function decryptKeypair(encryptedData: string, encryptionKey: string): Keypair {
  const data = Buffer.from(encryptedData, 'base64');
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(encryptionKey, 'hex'),
    data.slice(0, 16)
  );

  decipher.setAuthTag(data.slice(16, 32));

  return Keypair.fromSecretKey(Buffer.concat([
    decipher.update(data.slice(32)),
    decipher.final()
  ]));
}

/**
 * Generate a new 32-byte encryption key
 */
export function generateEncryptionKey(): string {
  return crypto.randomBytes(32).toString('hex');
}