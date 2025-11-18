/*
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This file is part of Z Combinator.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

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