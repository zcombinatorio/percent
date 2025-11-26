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

import { Transaction } from '@solana/web3.js';
import { DammService } from '@app/services/damm.service';
import { ExecutionService } from '@app/services/execution.service';
import { LoggerService } from '@app/services/logger.service';
import * as dotenv from 'dotenv';

dotenv.config();

// Configuration - OOGway + SOL deposit amounts
const TOKEN_A_AMOUNT = 26_750_000; // 50 million OOGway
const TOKEN_B_AMOUNT = 5;        // 9.5 SOL

// Optional: specify pool address (defaults to ZC-SOL if not provided)
const POOL_ADDRESS = '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX';

async function dammDeposit() {
  const logger = new LoggerService('damm-deposit');

  logger.info('Starting DAMM deposit', {
    tokenAAmount: TOKEN_A_AMOUNT,
    tokenBAmount: TOKEN_B_AMOUNT,
    poolAddress: POOL_ADDRESS || 'default'
  });

  // Load signer keypair
  const keypairPath = process.env.SOLANA_KEYPAIR_PATH || './wallet.json';
  logger.info(`Loading keypair from: ${keypairPath}`);

  try {
    const signer = ExecutionService.loadKeypair(keypairPath);
    logger.info(`Signer: ${signer.publicKey.toBase58()}`);

    // Create sign transaction function
    const signTransaction = async (transaction: Transaction): Promise<Transaction> => {
      transaction.partialSign(signer);
      return transaction;
    };

    // Create DAMM service
    const dammService = new DammService(logger);

    // Execute deposit
    logger.info('Executing DAMM deposit...');
    const result = await dammService.depositToDammPool(
      TOKEN_A_AMOUNT,
      TOKEN_B_AMOUNT,
      signTransaction,
      POOL_ADDRESS
    );

    logger.info('DAMM deposit completed successfully', {
      signature: result.signature,
      poolAddress: result.poolAddress,
      tokenAMint: result.tokenAMint,
      tokenBMint: result.tokenBMint,
      amounts: result.amounts
    });

    console.log('\n✅ DAMM deposit successful!');
    console.log(`Signature: ${result.signature}`);
    console.log(`Solscan: https://solscan.io/tx/${result.signature}`);
    console.log('\nAmounts deposited:');
    console.log(`  Token A: ${result.amounts.tokenA}`);
    console.log(`  Token B: ${result.amounts.tokenB}`);
    console.log(`  Liquidity Delta: ${result.amounts.liquidityDelta}`);

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
  dammDeposit();
}

export { dammDeposit };
