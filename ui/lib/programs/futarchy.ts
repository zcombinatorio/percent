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
 * Futarchy SDK integration for zcombinator DAO proposals
 * Uses @zcomb/programs-sdk for vault and AMM operations
 */

import { PublicKey, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { FutarchyClient, VaultType } from '@zcomb/programs-sdk';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';
import { createFutarchyClient, createReadOnlyFutarchyClient, getConnection } from './utils';

// Re-export VaultType from programs-sdk
export { VaultType } from '@zcomb/programs-sdk';

export type SignTransaction = (tx: Transaction) => Promise<Transaction>;

// ============================================================================
// Vault Operations (split/merge/redeem)
// ============================================================================

/**
 * Deposit regular tokens into the futarchy vault to receive conditional tokens
 * (split: 1 regular token → 1 of each conditional token)
 */
export async function deposit(
  vaultPDA: PublicKey,
  vaultType: VaultType,
  amount: BN | number | string,
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): Promise<string> {
  const client = createFutarchyClient(userPublicKey, signTransaction);
  const amountBN = BN.isBN(amount) ? amount : new BN(amount.toString());

  const builder = await client.vault.deposit(userPublicKey, vaultPDA, vaultType, amountBN);
  const signature = await builder.rpc();

  return signature;
}

/**
 * Withdraw regular tokens from the futarchy vault by burning conditional tokens
 * (merge: 1 of each conditional token → 1 regular token)
 */
export async function withdraw(
  vaultPDA: PublicKey,
  vaultType: VaultType,
  amount: BN | number | string,
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): Promise<string> {
  const client = createFutarchyClient(userPublicKey, signTransaction);
  const amountBN = BN.isBN(amount) ? amount : new BN(amount.toString());

  const builder = await client.vault.withdraw(userPublicKey, vaultPDA, vaultType, amountBN);
  const signature = await builder.rpc();

  return signature;
}

/**
 * Redeem winning conditional tokens for regular tokens after vault finalization
 */
export async function redeemWinnings(
  vaultPDA: PublicKey,
  vaultType: VaultType,
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): Promise<string> {
  const client = createFutarchyClient(userPublicKey, signTransaction);

  const builder = await client.vault.redeemWinnings(userPublicKey, vaultPDA, vaultType);
  const signature = await builder.rpc();

  return signature;
}

// ============================================================================
// Balance Queries
// ============================================================================

export interface UserBalancesResponse {
  proposalId: number;
  user: string;
  base: {
    regular: string;
    conditionalBalances: string[];
  };
  quote: {
    regular: string;
    conditionalBalances: string[];
  };
}

/**
 * Fetch user balances for both base and quote futarchy vaults
 */
export async function fetchUserBalances(
  vaultPDA: PublicKey,
  userPublicKey: PublicKey,
  proposalId: number
): Promise<UserBalancesResponse> {
  const client = createReadOnlyFutarchyClient();

  const [baseBalances, quoteBalances] = await Promise.all([
    client.vault.fetchUserBalances(vaultPDA, userPublicKey, VaultType.Base),
    client.vault.fetchUserBalances(vaultPDA, userPublicKey, VaultType.Quote),
  ]);

  return {
    proposalId,
    user: userPublicKey.toBase58(),
    base: {
      regular: baseBalances.userBalance.toString(),
      conditionalBalances: baseBalances.condBalances.map((b: BN) => b.toString()),
    },
    quote: {
      regular: quoteBalances.userBalance.toString(),
      conditionalBalances: quoteBalances.condBalances.map((b: BN) => b.toString()),
    },
  };
}

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
 */
export async function fetchUserBalanceForWinningMint(
  vaultPDA: PublicKey,
  userPublicKey: PublicKey,
  winningIndex: number
): Promise<WinningMintBalanceResponse> {
  const client = createReadOnlyFutarchyClient();
  const connection = getConnection();

  // Derive the winning conditional mints
  const [baseCondMint] = client.vault.deriveConditionalMint(vaultPDA, VaultType.Base, winningIndex);
  const [quoteCondMint] = client.vault.deriveConditionalMint(vaultPDA, VaultType.Quote, winningIndex);

  // Get user's token accounts for these mints
  const [baseAtaAddress, quoteAtaAddress] = await Promise.all([
    getAssociatedTokenAddress(baseCondMint, userPublicKey),
    getAssociatedTokenAddress(quoteCondMint, userPublicKey),
  ]);

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

// ============================================================================
// AMM Operations (swap, quote)
// ============================================================================

export interface SwapQuote {
  inputAmount: string;
  outputAmount: string;
  minOutputAmount: string;
  feeAmount: string;
  priceImpact: number;
  spotPriceBefore: string;
  spotPriceAfter: string;
}

/**
 * Get a swap quote from the futarchy AMM
 */
export async function getSwapQuote(
  poolPDA: PublicKey,
  swapAToB: boolean,
  inputAmount: BN | number | string
): Promise<SwapQuote> {
  const client = createReadOnlyFutarchyClient();
  const amountBN = BN.isBN(inputAmount) ? inputAmount : new BN(inputAmount.toString());

  const quote = await client.amm.quote(poolPDA, swapAToB, amountBN);

  return {
    inputAmount: quote.inputAmount.toString(),
    outputAmount: quote.outputAmount.toString(),
    minOutputAmount: quote.minOutputAmount.toString(),
    feeAmount: quote.feeAmount.toString(),
    priceImpact: quote.priceImpact,
    spotPriceBefore: quote.spotPriceBefore.toString(),
    spotPriceAfter: quote.spotPriceAfter.toString(),
  };
}

/**
 * Execute a swap on the futarchy AMM
 */
export async function executeSwap(
  poolPDA: PublicKey,
  swapAToB: boolean,
  inputAmount: BN | number | string,
  minOutputAmount: BN | number | string,
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): Promise<string> {
  const client = createFutarchyClient(userPublicKey, signTransaction);
  const inputBN = BN.isBN(inputAmount) ? inputAmount : new BN(inputAmount.toString());
  const minOutputBN = BN.isBN(minOutputAmount) ? minOutputAmount : new BN(minOutputAmount.toString());

  const builder = await client.amm.swap(
    userPublicKey,
    poolPDA,
    swapAToB,
    inputBN,
    minOutputBN
  );
  const signature = await builder.rpc();

  return signature;
}

/**
 * Execute a swap with automatic slippage calculation
 */
export async function executeSwapWithSlippage(
  poolPDA: PublicKey,
  swapAToB: boolean,
  inputAmount: BN | number | string,
  slippageBps: number,
  userPublicKey: PublicKey,
  signTransaction: SignTransaction
): Promise<string> {
  const client = createFutarchyClient(userPublicKey, signTransaction);
  const inputBN = BN.isBN(inputAmount) ? inputAmount : new BN(inputAmount.toString());

  const { builder } = await client.amm.swapWithSlippage(
    userPublicKey,
    poolPDA,
    swapAToB,
    inputBN,
    slippageBps
  );
  const signature = await builder.rpc();

  return signature;
}

/**
 * Fetch the spot price from a futarchy AMM pool
 */
export async function fetchSpotPrice(poolPDA: PublicKey): Promise<string> {
  const client = createReadOnlyFutarchyClient();
  const price = await client.amm.fetchSpotPrice(poolPDA);
  return price.toString();
}

/**
 * Fetch the TWAP from a futarchy AMM pool
 * Returns null if still in warmup period
 */
export async function fetchTwap(poolPDA: PublicKey): Promise<string | null> {
  const client = createReadOnlyFutarchyClient();
  const twap = await client.amm.fetchTwap(poolPDA);
  return twap ? twap.toString() : null;
}

// ============================================================================
// Proposal Queries
// ============================================================================

export interface FutarchyProposal {
  pda: string;
  id: number;
  moderator: string;
  vault: string;
  pools: string[];
  numOptions: number;
  createdAt: number;
  baseMint: string;
  quoteMint: string;
  config: {
    length: number;
    warmupDuration: number;
    marketBias: number;
    fee: number;
  };
  metadata: string | null;
  status: 'setup' | 'pending' | 'resolved';
  winningIndex?: number;
}

/**
 * Fetch a futarchy proposal by its PDA
 */
export async function fetchProposal(proposalPDA: PublicKey): Promise<FutarchyProposal> {
  const client = createReadOnlyFutarchyClient();
  const proposal = await client.fetchProposal(proposalPDA);

  // Parse the state enum to get status and winning index
  // State is an Anchor decoded enum like { setup: {} }, { pending: {} }, or { resolved: { 0: winningIdx } }
  const stateKey = Object.keys(proposal.state)[0] as 'setup' | 'pending' | 'resolved';
  let winningIndex: number | undefined;

  if (stateKey === 'resolved') {
    // The resolved variant contains the winning index as { 0: winningIdx }
    const stateValue = proposal.state as unknown as { resolved?: { 0?: number } };
    if (stateValue.resolved && typeof stateValue.resolved[0] === 'number') {
      winningIndex = stateValue.resolved[0];
    }
  }

  return {
    pda: proposalPDA.toBase58(),
    id: proposal.id,
    moderator: proposal.moderator.toBase58(),
    vault: proposal.vault.toBase58(),
    pools: proposal.pools.slice(0, proposal.numOptions).map((p: PublicKey) => p.toBase58()),
    numOptions: proposal.numOptions,
    createdAt: proposal.createdAt.toNumber() * 1000,
    baseMint: proposal.baseMint.toBase58(),
    quoteMint: proposal.quoteMint.toBase58(),
    config: {
      length: proposal.config.length,
      warmupDuration: proposal.config.warmupDuration,
      marketBias: proposal.config.marketBias,
      fee: proposal.config.fee,
    },
    metadata: proposal.metadata || null,
    status: stateKey,
    winningIndex,
  };
}
