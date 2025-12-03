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
import { VaultType } from '@zcomb/vault-sdk';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { createVaultClient, createReadOnlyVaultClient, getConnection } from './utils';

export { VaultType };

export type SignTransaction = (tx: Transaction) => Promise<Transaction>;

/**
 * Deposit regular tokens into the vault to receive conditional tokens
 * (Previously called "split" - 1 regular token → 1 of each conditional token)
 *
 * @param vaultPDA - The vault PDA to deposit into
 * @param vaultType - The vault type (Base or Quote)
 * @param amount - Amount of regular tokens to deposit (in smallest units)
 * @param userPublicKey - The user's public key
 * @param signTransaction - Function to sign the transaction
 * @returns Transaction signature
 */
export async function deposit(
  vaultPDA: PublicKey,
  vaultType: VaultType,
  amount: BN | number | string,
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): Promise<string> {
  const vaultClient = createVaultClient(userPublicKey, signTransaction);

  const amountBN = BN.isBN(amount) ? amount : new BN(amount.toString());

  const builder = await vaultClient.deposit(userPublicKey, vaultPDA, vaultType, amountBN);
  const signature = await builder.rpc();

  return signature;
}

/**
 * Withdraw regular tokens from the vault by burning conditional tokens
 * (Previously called "merge" - 1 of each conditional token → 1 regular token)
 *
 * @param vaultPDA - The vault PDA to withdraw from
 * @param vaultType - The vault type (Base or Quote)
 * @param amount - Amount of regular tokens to withdraw (in smallest units)
 * @param userPublicKey - The user's public key
 * @param signTransaction - Function to sign the transaction
 * @returns Transaction signature
 */
export async function withdraw(
  vaultPDA: PublicKey,
  vaultType: VaultType,
  amount: BN | number | string,
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): Promise<string> {
  const vaultClient = createVaultClient(userPublicKey, signTransaction);

  const amountBN = BN.isBN(amount) ? amount : new BN(amount.toString());

  const builder = await vaultClient.withdraw(userPublicKey, vaultPDA, vaultType, amountBN);
  const signature = await builder.rpc();

  return signature;
}

/**
 * Redeem winning conditional tokens for regular tokens after vault finalization
 *
 * @param vaultPDA - The vault PDA to redeem from
 * @param vaultType - The vault type (Base or Quote)
 * @param userPublicKey - The user's public key
 * @param signTransaction - Function to sign the transaction
 * @returns Transaction signature
 */
export async function redeemWinnings(
  vaultPDA: PublicKey,
  vaultType: VaultType,
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): Promise<string> {
  const vaultClient = createVaultClient(userPublicKey, signTransaction);

  const builder = await vaultClient.redeemWinnings(userPublicKey, vaultPDA, vaultType);
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
 * @param vaultType - The vault type (Base or Quote) - determines which conditional mints to return
 * @returns Vault state with conditional mint addresses
 */
export async function fetchVaultState(vaultPDA: PublicKey, vaultType: VaultType): Promise<VaultStateResponse> {
  const vaultClient = createReadOnlyVaultClient();
  const vault = await vaultClient.fetchVault(vaultPDA);

  // Select the appropriate conditional mints based on vault type
  const condMints = vaultType === VaultType.Base
    ? vault.condBaseMints
    : vault.condQuoteMints;

  return {
    conditionalMints: condMints.slice(0, vault.numOptions).map((m: PublicKey) => m.toBase58()),
    numOptions: vault.numOptions,
    state: vault.state,
  };
}

/**
 * Fetch user balances for both base and quote vaults
 *
 * @param vaultPDA - The vault PDA (same for both base and quote)
 * @param userPublicKey - The user's public key
 * @param proposalId - The proposal ID (for response metadata)
 * @returns User balances for both vaults
 */
export async function fetchUserBalances(
  vaultPDA: PublicKey,
  userPublicKey: PublicKey,
  proposalId: number
): Promise<UserBalancesResponse> {
  const vaultClient = createReadOnlyVaultClient();

  // Fetch balances from both vault types in parallel
  // SDK signature: fetchUserBalances(vaultPda, user, vaultType)
  const [baseBalances, quoteBalances] = await Promise.all([
    vaultClient.fetchUserBalances(vaultPDA, userPublicKey, VaultType.Base),
    vaultClient.fetchUserBalances(vaultPDA, userPublicKey, VaultType.Quote),
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

/**
 * User balance for a specific winning market
 */
export interface WinningMintBalanceResponse {
  user: string;
  winningIndex: number;
  baseConditionalMint: string;
  quoteConditionalMint: string;
  baseConditionalBalance: string;
  quoteConditionalBalance: string;
}

/**
 * Fetch user balance for only the winning conditional mint
 * More efficient than fetching all balances when only the winner matters
 *
 * @param vaultPDA - The vault PDA
 * @param userPublicKey - The user's public key
 * @param winningIndex - The winning market index (0-indexed)
 * @returns User balances for the winning conditional mints only
 */
export async function fetchUserBalanceForWinningMint(
  vaultPDA: PublicKey,
  userPublicKey: PublicKey,
  winningIndex: number
): Promise<WinningMintBalanceResponse> {
  const vaultClient = createReadOnlyVaultClient();
  const connection = getConnection();

  // Derive the winning conditional mints
  const [baseCondMint] = vaultClient.deriveConditionalMint(vaultPDA, VaultType.Base, winningIndex);
  const [quoteCondMint] = vaultClient.deriveConditionalMint(vaultPDA, VaultType.Quote, winningIndex);

  // Get user's token accounts for these mints
  const baseAta = getAssociatedTokenAddress(baseCondMint, userPublicKey);
  const quoteAta = getAssociatedTokenAddress(quoteCondMint, userPublicKey);

  // Resolve ATAs in parallel
  const [baseAtaAddress, quoteAtaAddress] = await Promise.all([baseAta, quoteAta]);

  // Fetch balances in parallel
  let baseBalance = '0';
  let quoteBalance = '0';

  const [baseResult, quoteResult] = await Promise.allSettled([
    getAccount(connection, baseAtaAddress),
    getAccount(connection, quoteAtaAddress),
  ]);

  if (baseResult.status === 'fulfilled') {
    baseBalance = baseResult.value.amount.toString();
  }

  if (quoteResult.status === 'fulfilled') {
    quoteBalance = quoteResult.value.amount.toString();
  }

  return {
    user: userPublicKey.toBase58(),
    winningIndex,
    baseConditionalMint: baseCondMint.toBase58(),
    quoteConditionalMint: quoteCondMint.toBase58(),
    baseConditionalBalance: baseBalance,
    quoteConditionalBalance: quoteBalance,
  };
}
