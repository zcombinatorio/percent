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

/**
 * Manual DAMM Deposit Script
 *
 * Deposits custom amounts of tokens to a DAMM pool.
 * Configure the values below and run the script.
 */

import { Transaction } from '@solana/web3.js';
import { DammService } from '@app/services/damm.service';
import { ExecutionService } from '@app/services/execution.service';
import { LoggerService } from '@app/services/logger.service';
import { POOL_METADATA } from '../src/config/whitelist';
import * as dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONFIGURATION - Update these values before running
// ============================================================================

// DAMM pool address to deposit to
const POOL_ADDRESS = '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX';

// Token A amount (UI units, e.g., 1000000 for 1M tokens)
const TOKEN_A_AMOUNT = 19757802;

// Token B amount (UI units, e.g., 5 for 5 SOL)
const TOKEN_B_AMOUNT = 4.31;

// ============================================================================

async function dammDepositManual() {
  const poolAddress = POOL_ADDRESS;
  const tokenAAmount = TOKEN_A_AMOUNT;
  const tokenBAmount = TOKEN_B_AMOUNT;
  const logger = new LoggerService('damm-deposit-manual');

  // Get pool metadata if available
  const poolMetadata = POOL_METADATA[poolAddress];
  const poolName = poolMetadata?.ticker || 'Unknown';

  console.log(`\n🏦 DAMM Manual Deposit`);
  console.log(`   Pool: ${poolName} (${poolAddress})`);
  console.log(`   Token A: ${tokenAAmount.toLocaleString()}`);
  console.log(`   Token B: ${tokenBAmount.toLocaleString()} SOL`);

  if (!poolMetadata) {
    console.warn('\n⚠️  Warning: Pool not found in POOL_METADATA. Proceeding anyway...');
  }

  // Load signer keypair
  const keypairPath = process.env.SOLANA_KEYPAIR_PATH || './wallet.json';
  logger.info(`Loading keypair from: ${keypairPath}`);

  const signer = ExecutionService.loadKeypair(keypairPath);
  console.log(`\n🔑 Signer: ${signer.publicKey.toBase58()}`);

  // Create sign transaction function
  const signTransaction = async (transaction: Transaction): Promise<Transaction> => {
    transaction.partialSign(signer);
    return transaction;
  };

  // Create DAMM service and execute deposit
  const dammService = new DammService(logger.createChild('damm'));

  console.log('\n📤 Executing deposit...');
  logger.info('Executing DAMM deposit', {
    tokenA: tokenAAmount,
    tokenB: tokenBAmount,
    poolAddress
  });

  try {
    const result = await dammService.depositToDammPool(
      tokenAAmount,
      tokenBAmount,
      signTransaction,
      poolAddress
    );

    logger.info('DAMM deposit completed', {
      signature: result.signature,
      poolAddress: result.poolAddress,
      tokenAMint: result.tokenAMint,
      tokenBMint: result.tokenBMint,
      amounts: result.amounts
    });

    console.log('\n✅ DAMM deposit successful!');
    console.log(`   Signature: ${result.signature}`);
    console.log(`   Solscan: https://solscan.io/tx/${result.signature}`);
    console.log('\n   Amounts deposited:');
    console.log(`   Token A: ${result.amounts.tokenA}`);
    console.log(`   Token B: ${result.amounts.tokenB}`);
    console.log(`   Liquidity Delta: ${result.amounts.liquidityDelta}`);

  } catch (error) {
    logger.error('DAMM deposit failed', {
      error: error instanceof Error ? error.message : String(error)
    });
    console.error('\n❌ DAMM deposit failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  dammDepositManual();
}

export { dammDepositManual };
