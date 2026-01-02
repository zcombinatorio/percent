#!/usr/bin/env ts-node
/**
 * Finalize Vault with Winning Option
 *
 * Finalizes a vault by setting the winning option index.
 * After finalization, use redeem-winnings.ts to recover tokens.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { VaultClient } from '@zcomb/vault-sdk';
import { ExecutionService } from '@app/services/execution.service';
import * as dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================
const MODERATOR_ID = 4;
const PROPOSAL_ID = 20; // <-- UPDATE THIS
const WINNING_INDEX = 7; // Option 8 (0-indexed)

async function main() {
  const surfManagerPath = process.env.MANAGER_PRIVATE_KEY_SURFTEST;
  if (!surfManagerPath) {
    throw new Error('MANAGER_PRIVATE_KEY_SURF not set');
  }
  const authority = ExecutionService.loadKeypair(surfManagerPath);

  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = new Wallet(authority);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  const vaultClient = new VaultClient(provider);
  const [vaultPDA] = vaultClient.deriveVaultPDA(
    authority.publicKey,
    MODERATOR_ID,
    PROPOSAL_ID
  );

  console.log('Authority:', authority.publicKey.toBase58());
  console.log('Vault PDA:', vaultPDA.toBase58());
  console.log('Winning Index:', WINNING_INDEX);

  console.log('\nFinalizing vault...');
  const sig = await vaultClient
    .finalize(authority.publicKey, vaultPDA, WINNING_INDEX)
    .rpc();

  console.log('Signature:', sig);
  console.log('https://solscan.io/tx/' + sig);
}

main().catch(console.error);
