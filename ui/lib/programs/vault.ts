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

import { PublicKey, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { createVaultClient, createReadOnlyVaultClient } from './utils';

export type SignTransaction = (tx: Transaction) => Promise<Transaction>;

/**
 * Deposit regular tokens into the vault to receive conditional tokens
 * (Previously called "split" - 1 regular token → 1 of each conditional token)
 *
 * @param vaultPDA - The vault PDA to deposit into
 * @param amount - Amount of regular tokens to deposit (in smallest units)
 * @param userPublicKey - The user's public key
 * @param signTransaction - Function to sign the transaction
 * @returns Transaction signature
 */
export async function deposit(
  vaultPDA: PublicKey,
  amount: BN | number | string,
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): Promise<string> {
  const vaultClient = createVaultClient(userPublicKey, signTransaction);

  const amountBN = BN.isBN(amount) ? amount : new BN(amount.toString());

  const builder = await vaultClient.deposit(userPublicKey, vaultPDA, amountBN);
  const signature = await builder.rpc();

  return signature;
}

/**
 * Withdraw regular tokens from the vault by burning conditional tokens
 * (Previously called "merge" - 1 of each conditional token → 1 regular token)
 *
 * @param vaultPDA - The vault PDA to withdraw from
 * @param amount - Amount of regular tokens to withdraw (in smallest units)
 * @param userPublicKey - The user's public key
 * @param signTransaction - Function to sign the transaction
 * @returns Transaction signature
 */
export async function withdraw(
  vaultPDA: PublicKey,
  amount: BN | number | string,
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): Promise<string> {
  const vaultClient = createVaultClient(userPublicKey, signTransaction);

  const amountBN = BN.isBN(amount) ? amount : new BN(amount.toString());

  const builder = await vaultClient.withdraw(userPublicKey, vaultPDA, amountBN);
  const signature = await builder.rpc();

  return signature;
}

/**
 * Redeem winning conditional tokens for regular tokens after vault finalization
 *
 * @param vaultPDA - The vault PDA to redeem from
 * @param userPublicKey - The user's public key
 * @param signTransaction - Function to sign the transaction
 * @returns Transaction signature
 */
export async function redeemWinnings(
  vaultPDA: PublicKey,
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): Promise<string> {
  const vaultClient = createVaultClient(userPublicKey, signTransaction);

  const builder = await vaultClient.redeemWinnings(userPublicKey, vaultPDA);
  const signature = await builder.rpc();

  return signature;
}

/**
 * User balances response format
 */
export interface UserBalancesResponse {
  proposalId: number;
  user: string;
  base: {
    regular: string;
    conditionalBalances: string[];  // [0]=market0, [1]=market1, etc.
  };
  quote: {
    regular: string;
    conditionalBalances: string[];
  };
}

/**
 * Vault state response format
 */
export interface VaultStateResponse {
  conditionalMints: string[];  // Array of conditional mint addresses
  numOptions: number;
  state: string;
}

/**
 * Fetch vault state including conditional mints
 *
 * @param vaultPDA - The vault PDA to fetch state for
 * @returns Vault state with conditional mint addresses
 */
export async function fetchVaultState(vaultPDA: PublicKey): Promise<VaultStateResponse> {
  const vaultClient = createReadOnlyVaultClient();
  const vault = await vaultClient.fetchVault(vaultPDA);
  return {
    conditionalMints: vault.condMints.slice(0, vault.numOptions).map(m => m.toBase58()),
    numOptions: vault.numOptions,
    state: vault.state,
  };
}

/**
 * Fetch user balances for both base and quote vaults
 *
 * @param baseVaultPDA - The base vault PDA
 * @param quoteVaultPDA - The quote vault PDA
 * @param userPublicKey - The user's public key
 * @param proposalId - The proposal ID (for response metadata)
 * @returns User balances for both vaults
 */
export async function fetchUserBalances(
  baseVaultPDA: PublicKey,
  quoteVaultPDA: PublicKey,
  userPublicKey: PublicKey,
  proposalId: number
): Promise<UserBalancesResponse> {
  const vaultClient = createReadOnlyVaultClient();

  // Fetch balances from both vaults in parallel
  const [baseBalances, quoteBalances] = await Promise.all([
    vaultClient.fetchUserBalances(userPublicKey, baseVaultPDA),
    vaultClient.fetchUserBalances(userPublicKey, quoteVaultPDA),
  ]);

  return {
    proposalId,
    user: userPublicKey.toBase58(),
    base: {
      regular: baseBalances.userBalance.toString(),
      conditionalBalances: baseBalances.condBalances.map((b: number) => b.toString()),
    },
    quote: {
      regular: quoteBalances.userBalance.toString(),
      conditionalBalances: quoteBalances.condBalances.map((b: number) => b.toString()),
    },
  };
}
