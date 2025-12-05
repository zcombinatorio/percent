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
 * DAMM Deposit Script
 *
 * Retrieves withdrawal metadata from the database and deposits funds back to the DAMM pool.
 *
 * Usage:
 *   npx ts-node scripts/damm-deposit.ts --moderator-id 1 --proposal-id 5
 *   npx ts-node scripts/damm-deposit.ts -m 1 -p 5
 */

import { Transaction } from '@solana/web3.js';
import { PersistenceService } from '@app/services/persistence.service';
import { DammService } from '@app/services/damm.service';
import { ExecutionService } from '@app/services/execution.service';
import { LoggerService } from '@app/services/logger.service';
import { POOL_METADATA } from '../src/config/whitelist';
import * as dotenv from 'dotenv';

dotenv.config();

interface CliArgs {
  moderatorId: number;
  proposalId: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let moderatorId: number | undefined;
  let proposalId: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    if (arg === '--moderator-id' || arg === '-m') {
      moderatorId = parseInt(nextArg, 10);
      i++;
    } else if (arg === '--proposal-id' || arg === '-p') {
      proposalId = parseInt(nextArg, 10);
      i++;
    }
  }

  if (moderatorId === undefined || isNaN(moderatorId)) {
    console.error('Error: --moderator-id (-m) is required');
    console.error('Usage: npx ts-node scripts/damm-deposit.ts -m <moderator-id> -p <proposal-id>');
    process.exit(1);
  }

  if (proposalId === undefined || isNaN(proposalId)) {
    console.error('Error: --proposal-id (-p) is required');
    console.error('Usage: npx ts-node scripts/damm-deposit.ts -m <moderator-id> -p <proposal-id>');
    process.exit(1);
  }

  return { moderatorId, proposalId };
}

async function dammDeposit() {
  const { moderatorId, proposalId } = parseArgs();
  const logger = new LoggerService('damm-deposit');

  logger.info('Starting DAMM deposit', { moderatorId, proposalId });
  console.log(`\n🔍 Fetching withdrawal metadata for moderator ${moderatorId}, proposal ${proposalId}...`);

  // Initialize persistence service
  const persistenceService = new PersistenceService(moderatorId, logger.createChild('persistence'));

  // Get withdrawal metadata
  const metadata = await persistenceService.getWithdrawalMetadata(proposalId);

  if (!metadata) {
    console.error(`\n❌ No withdrawal metadata found for proposal ${proposalId}`);
    process.exit(1);
  }

  console.log('\n📊 Withdrawal metadata:');
  console.log(`   Pool Address: ${metadata.poolAddress}`);
  console.log(`   Token A (raw): ${metadata.tokenA}`);
  console.log(`   Token B (raw): ${metadata.tokenB}`);
  console.log(`   Spot Price: ${metadata.spotPrice}`);
  console.log(`   Needs Deposit Back: ${metadata.needsDepositBack}`);

  if (!metadata.needsDepositBack) {
    console.log('\n✅ Funds already deposited back. No action needed.');
    console.log(`   Deposit signature: ${metadata.depositSignature}`);
    console.log(`   Deposited at: ${metadata.depositedAt}`);
    process.exit(0);
  }

  // Get pool metadata for decimals
  const poolMetadata = POOL_METADATA[metadata.poolAddress];
  if (!poolMetadata) {
    console.error(`\n❌ Pool metadata not found for ${metadata.poolAddress}`);
    process.exit(1);
  }

  const BASE_DECIMALS = poolMetadata.baseDecimals;
  const QUOTE_DECIMALS = poolMetadata.quoteDecimals;

  // Convert raw amounts to UI amounts
  const tokenAAmountUI = metadata.tokenA / Math.pow(10, BASE_DECIMALS);
  const tokenBAmountUI = metadata.tokenB / Math.pow(10, QUOTE_DECIMALS);

  console.log(`\n💰 Amounts to deposit:`);
  console.log(`   Token A: ${tokenAAmountUI.toLocaleString()} (${poolMetadata.ticker})`);
  console.log(`   Token B: ${tokenBAmountUI.toFixed(6)} SOL`);

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

  console.log('\n🏦 Depositing funds back to DAMM pool...');
  logger.info('Executing DAMM deposit', {
    tokenA: tokenAAmountUI,
    tokenB: tokenBAmountUI,
    poolAddress: metadata.poolAddress
  });

  try {
    const result = await dammService.depositToDammPool(
      tokenAAmountUI,
      tokenBAmountUI,
      signTransaction,
      metadata.poolAddress
    );

    logger.info('DAMM deposit completed', {
      signature: result.signature,
      amounts: result.amounts
    });

    // Mark as deposited in database
    await persistenceService.markWithdrawalDeposited(
      proposalId,
      result.signature,
      result.amounts.tokenA,
      result.amounts.tokenB
    );

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
  dammDeposit();
}

export { dammDeposit };
