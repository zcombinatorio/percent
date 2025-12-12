#!/usr/bin/env ts-node
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

import { CreateModeratorRequest } from '@src/routes/router';
import { encryptKeypair } from '@app/utils/crypto';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';

dotenv.config();

async function createModerator() {
  const API_URL = process.env.API_URL || 'http://localhost:3001';
  const API_KEY = process.env.API_KEY;
  const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

  if (!API_KEY) {
    console.error('API_KEY environment variable is required');
    process.exit(1);
  }

  if (!ENCRYPTION_KEY) {
    console.error('ENCRYPTION_KEY environment variable is required');
    process.exit(1);
  }

  // Token configuration - UPDATE THESE FOR EACH NEW TOKEN
  const SOL_MINT = 'So11111111111111111111111111111111111111112'; // Wrapped SOL

  // SURF token
  const TICKER = 'SURF';
  const BASE_MINT = 'E7xktmaFNM6vd4GKa8FrXwX7sA7hrLzToxc64foGq3iW'; // was: SurfwRjQQFV6P7JdhxSptf4CjWU8sb88rUiaLCystar
  const BASE_DECIMALS = 9;
  const DAMM_WITHDRAWAL_PERCENTAGE = 12; // Optional: DAMM withdrawal percentage (0-50, defaults to 12)

  // // ZC token (example)
  // const TICKER = 'ZC';
  // const BASE_MINT = 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC';
  // const BASE_DECIMALS = 6;
  // const DAMM_WITHDRAWAL_PERCENTAGE = 12;

  // // oogway token (example)
  // const TICKER = 'OOGWAY';
  // const BASE_MINT = 'C7MGcMnN8cXUkj8JQuMhkJZh6WqY2r8QnT3AUfKTkrix';
  // const BASE_DECIMALS = 6;
  // const DAMM_WITHDRAWAL_PERCENTAGE = 12;

  // Load manager keypair from MANAGER_PRIVATE_KEY_<TICKER> env var
  const envVarName = `MANAGER_PRIVATE_KEY_${TICKER}`;
  const managerPrivateKey = process.env[envVarName];

  if (!managerPrivateKey) {
    console.error(`${envVarName} environment variable is required`);
    process.exit(1);
  }

  try {
    // Decode base58 private key to keypair
    const secretKey = bs58.decode(managerPrivateKey);
    const authority = Keypair.fromSecretKey(secretKey);
    console.log(`Manager wallet for ${TICKER}: ${authority.publicKey.toBase58()}`);

    // Encrypt the keypair for storage in database
    const encryptedAuthority = encryptKeypair(authority, ENCRYPTION_KEY);

    const request: CreateModeratorRequest = {
      baseMint: BASE_MINT,
      quoteMint: SOL_MINT,
      baseDecimals: BASE_DECIMALS,
      quoteDecimals: 9,       // SOL decimals
      authority: encryptedAuthority,
      protocolName: TICKER,
      dammWithdrawalPercentage: DAMM_WITHDRAWAL_PERCENTAGE
    };

    console.log('\nRequest:');
    console.log(JSON.stringify(request, null, 2));

    const response = await fetch(`${API_URL}/api/router/moderators`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': API_KEY
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('\nError:', (error as { error?: string }).error || 'Failed to create moderator');
      process.exit(1);
    }

    const data = await response.json();
    console.log('\n✅ Moderator created successfully');
    console.log(JSON.stringify(data, null, 2));

  } catch (error) {
    console.error('\nError:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  createModerator();
}

export { createModerator };