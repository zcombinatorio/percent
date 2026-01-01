#!/usr/bin/env ts-node
/**
 * Derive Vault PDA
 *
 * Simple script to derive and log the vault PDA for a given proposal.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { VaultClient, VaultType } from '@zcomb/vault-sdk';
import { ExecutionService } from '@app/services/execution.service';
import * as dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================
const MODERATOR_ID = 6;
const PROPOSAL_ID = 1; // <-- UPDATE THIS

async function main() {
  // Load authority keypair (SURF manager)
  const surfManagerPath = process.env.MANAGER_PRIVATE_KEY_SURF;
  if (!surfManagerPath) {
    throw new Error('MANAGER_PRIVATE_KEY_SURF not set');
  }
  const authority = ExecutionService.loadKeypair(surfManagerPath);

  // Create provider
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const wallet = new Wallet(authority);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  // Create vault client and derive PDA
  const vaultClient = new VaultClient(provider);
  const [vaultPDA] = vaultClient.deriveVaultPDA(
    authority.publicKey,
    MODERATOR_ID,
    PROPOSAL_ID
  );

  console.log('Authority:', authority.publicKey.toBase58());
  console.log('Moderator ID:', MODERATOR_ID);
  console.log('Proposal ID:', PROPOSAL_ID);
  console.log('Vault PDA:', vaultPDA.toBase58());
}

main().catch(console.error);
