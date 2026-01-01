#!/usr/bin/env tsx
/**
 * Get SOL balance of a wallet 24 hours ago
 *
 * Calculates by summing gas fees paid in the last 24h
 * and adding them back to current balance.
 *
 * Usage: pnpm tsx scripts/get-historical-balance.ts <wallet_address>
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as dotenv from 'dotenv';

dotenv.config();

const WALLET = process.argv[2];

if (!WALLET) {
  console.error('Usage: pnpm tsx scripts/get-historical-balance.ts <wallet_address>');
  process.exit(1);
}

async function main() {
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const pubkey = new PublicKey(WALLET);

  const now = Date.now() / 1000;
  const oneDayAgo = now - (24 * 60 * 60);

  console.log('Wallet:', WALLET);
  console.log('Target time:', new Date(oneDayAgo * 1000).toISOString());

  // Get current balance
  const currentBalance = await connection.getBalance(pubkey);
  console.log('\nCurrent balance:', currentBalance / LAMPORTS_PER_SOL, 'SOL');

  // Fetch signatures and sum gas fees where this wallet was fee payer
  let totalGasFees = 0;
  let txCount = 0;
  let before: string | undefined;
  let done = false;

  console.log('\nFetching transactions...');

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  while (!done) {
    const sigs = await connection.getSignaturesForAddress(pubkey, { before, limit: 50 });

    if (sigs.length === 0) break;

    for (const sig of sigs) {
      if (sig.blockTime && sig.blockTime < oneDayAgo) {
        done = true;
        break;
      }

      await sleep(100); // Rate limit
      const tx = await connection.getTransaction(sig.signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (tx?.meta && tx.meta.fee) {
        // Check if this wallet was the fee payer (first account)
        const feePayer = tx.transaction.message.staticAccountKeys[0];
        if (feePayer.equals(pubkey)) {
          totalGasFees += tx.meta.fee;
          txCount++;
        }
      }
    }

    before = sigs[sigs.length - 1]?.signature;
    console.log(`  Processed ${txCount} transactions...`);
    await sleep(200);
  }

  console.log('\nTotal gas fees (24h):', totalGasFees / LAMPORTS_PER_SOL, 'SOL');
  console.log('Transactions as fee payer:', txCount);
  console.log('\nBalance 24h ago:', (currentBalance + totalGasFees) / LAMPORTS_PER_SOL, 'SOL');
}

main().catch(console.error);
