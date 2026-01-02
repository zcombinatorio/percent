#!/usr/bin/env ts-node
/**
 * Redeem Winnings from Finalized Vault
 *
 * Redeems winning conditional tokens back to regular tokens.
 */

import { Connection } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { VaultClient, VaultType } from '@zcomb/vault-sdk';
import { ExecutionService } from '@app/services/execution.service';
import * as dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================
const MODERATOR_ID = 4;
const PROPOSAL_ID = 20;

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

  // Redeem base tokens
  console.log('\nRedeeming base tokens...');
  const baseSig = await (await vaultClient.redeemWinnings(
    authority.publicKey,
    vaultPDA,
    VaultType.Base
  )).rpc();
  console.log('Base signature:', baseSig);
  console.log('https://solscan.io/tx/' + baseSig);

  // Redeem quote tokens
  console.log('\nRedeeming quote tokens...');
  const quoteSig = await (await vaultClient.redeemWinnings(
    authority.publicKey,
    vaultPDA,
    VaultType.Quote
  )).rpc();
  console.log('Quote signature:', quoteSig);
  console.log('https://solscan.io/tx/' + quoteSig);

  console.log('\nDone!');
}

main().catch(console.error);
