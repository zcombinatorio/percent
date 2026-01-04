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

import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { VaultClient } from '@zcomb/vault-sdk';
import * as futarchy from '@zcomb/programs-sdk';

export type SignTransaction = (tx: Transaction) => Promise<Transaction>;

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com';

/**
 * Create a Solana connection
 */
export function getConnection(): Connection {
  return new Connection(RPC_URL, 'confirmed');
}

/**
 * Adapter to wrap a Privy/wallet signTransaction function into an Anchor-compatible Wallet
 * This creates a wallet that can sign transactions but doesn't have a keypair
 */
export function createWalletAdapter(
  publicKey: PublicKey,
  signTransactionFn: SignTransaction
): Wallet {
  return {
    publicKey,
    signTransaction: signTransactionFn as Wallet['signTransaction'],
    signAllTransactions: ((txs: Transaction[]) => Promise.all(txs.map(tx => signTransactionFn(tx)))) as Wallet['signAllTransactions'],
    payer: undefined as any, // Not available in browser wallets
  };
}

/**
 * Create an Anchor provider from a user's wallet
 */
export function createProvider(
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): AnchorProvider {
  const connection = getConnection();
  const wallet = createWalletAdapter(userPublicKey, signTransaction);

  return new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
}

/**
 * Create a VaultClient instance for interacting with the vault program
 */
export function createVaultClient(
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): VaultClient {
  const provider = createProvider(userPublicKey, signTransaction);
  return new VaultClient(provider);
}

/**
 * Create a read-only VaultClient (for queries only, no signing)
 * Uses a dummy public key since we won't be signing
 */
export function createReadOnlyVaultClient(): VaultClient {
  const connection = getConnection();

  // Create a dummy wallet for read-only operations
  const dummyPublicKey = PublicKey.default;
  const dummyWallet: Wallet = {
    publicKey: dummyPublicKey,
    signTransaction: async () => { throw new Error('Read-only client cannot sign'); },
    signAllTransactions: async () => { throw new Error('Read-only client cannot sign'); },
    payer: undefined as any,
  };

  const provider = new AnchorProvider(connection, dummyWallet, {
    commitment: 'confirmed',
  });

  return new VaultClient(provider);
}

// ============================================================================
// Futarchy SDK Client Creation (for @zcomb/programs-sdk)
// ============================================================================

/**
 * Create a FutarchyClient instance for interacting with futarchy programs
 * (vault, AMM, moderator, proposal)
 */
export function createFutarchyClient(
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): futarchy.FutarchyClient {
  const provider = createProvider(userPublicKey, signTransaction);
  return new futarchy.FutarchyClient(provider);
}

/**
 * Create a read-only FutarchyClient (for queries only, no signing)
 */
export function createReadOnlyFutarchyClient(): futarchy.FutarchyClient {
  const connection = getConnection();

  // Create a dummy wallet for read-only operations
  const dummyPublicKey = PublicKey.default;
  const dummyWallet: Wallet = {
    publicKey: dummyPublicKey,
    signTransaction: async () => { throw new Error('Read-only client cannot sign'); },
    signAllTransactions: async () => { throw new Error('Read-only client cannot sign'); },
    payer: undefined as any,
  };

  const provider = new AnchorProvider(connection, dummyWallet, {
    commitment: 'confirmed',
  });

  return new futarchy.FutarchyClient(provider);
}
