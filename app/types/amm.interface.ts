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

import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { Decimal } from "decimal.js";
import { IExecutionService } from './execution.interface';
import { LoggerService } from '@app/services/logger.service';

/**
 * Enum representing the operational state of the AMM
 */
export enum AMMState {
  Uninitialized = 'Uninitialized', // AMM not yet initialized
  Trading = 'Trading',              // AMM is active and can perform swaps
  Finalized = 'Finalized'           // AMM has removed liquidity and is closed
}

/**
 * Interface for Automated Market Maker (AMM) in the protocol
 * Manages liquidity pools for conditional token trading
 */
export interface IAMM {
  readonly baseMint: PublicKey;       // Base token mint address (immutable)
  readonly quoteMint: PublicKey;      // Quote token mint address (immutable)
  readonly baseDecimals: number;      // Decimals for base token (immutable)
  readonly quoteDecimals: number;     // Decimals for quote token (immutable)
  state: AMMState;                    // Current operational state
  readonly isFinalized: boolean;      // Whether the AMM has been finalized
  pool?: PublicKey;                   // Pool address (set after initialization)
  position?: PublicKey;               // Position account address
  positionNft?: PublicKey;            // Position NFT mint address

  /**
   * Builds a transaction for initializing the AMM pool with initial liquidity
   * Transaction is always pre-signed with authority and position NFT keypair
   * @param initialBaseTokenAmount - Initial base token amount to deposit
   * @param initialQuoteAmount - Initial quote token amount to deposit
   * @returns Pre-signed transaction ready for execution
   */
  buildInitializeTx(
    initialBaseTokenAmount: BN,
    initialQuoteAmount: BN
  ): Promise<Transaction>;

  /**
   * Initializes the AMM pool with initial liquidity
   * Creates pool, position, and deposits initial tokens
   * @param initialBaseTokenAmount - Initial base token amount to deposit
   * @param initialQuoteAmount - Initial quote token amount to deposit
   */
  initialize(
    initialBaseTokenAmount: BN,
    initialQuoteAmount: BN
  ): Promise<void>;

  /**
   * Fetches the current price from the pool
   * @returns Current price as base/quote ratio
   * @throws Error if pool is uninitialized or finalized
   */
  fetchPrice(): Promise<Decimal>;

  /**
   * Fetches the current liquidity from the pool
   * @returns Current liquidity as BN
   * @throws Error if pool is uninitialized or finalized
   */
  fetchLiquidity(): Promise<BN>;

  /**
   * Builds a transaction for removing all liquidity from the pool
   * Transaction is always pre-signed with authority
   * @returns Pre-signed transaction ready for execution
   * @throws Error if AMM is not initialized, already finalized, or pool uninitialized
   */
  buildRemoveLiquidityTx(): Promise<Transaction>;

  /**
   * Removes all liquidity and closes the position
   * Sets AMM state to finalized, preventing further operations
   * @returns Transaction signature
   * @throws Error if already finalized or pool uninitialized
   */
  removeLiquidity(): Promise<string>;
  
  /**
   * Gets a quote for swapping tokens on the AMM
   * @param isBaseToQuote - Direction of swap (true: base->quote, false: quote->base)
   * @param amountIn - Amount of input tokens to swap
   * @param slippageBps - Slippage tolerance in basis points (default: 50 = 0.5%)
   * @returns Quote with expected output, fees, and price impact
   * @throws Error if pool is finalized or uninitialized
   */
  getQuote(
    isBaseToQuote: boolean,
    amountIn: BN,
    slippageBps?: number
  ): Promise<{
    swapInAmount: BN;
    consumedInAmount: BN;
    swapOutAmount: BN;
    minSwapOutAmount: BN;
    totalFee: BN;
    priceImpact: number;
  }>;
  
  /**
   * Builds a transaction for swapping tokens on the AMM
   * @param user - User's public key who is swapping tokens
   * @param isBaseToQuote - Direction of swap (true: base->quote, false: quote->base)
   * @param amountIn - Amount of input tokens to swap
   * @param slippageBps - Slippage tolerance in basis points (default: 50 = 0.5%)
   * @returns Transaction with blockhash and fee payer set, ready for user signature
   * @throws Error if pool is finalized or uninitialized
   */
  buildSwapTx(
    user: PublicKey,
    isBaseToQuote: boolean,
    amountIn: BN,
    slippageBps?: number
  ): Promise<Transaction>;
  
  /**
   * Executes a pre-signed swap transaction
   * @param tx - Transaction already signed by user
   * @returns Transaction signature
   * @throws Error if transaction execution fails
   */
  executeSwapTx(tx: Transaction): Promise<string>;

  /**
   * Serializes the AMM state for persistence
   * @returns Serialized AMM data that can be saved to database
   */
  serialize(): IAMMSerializedData;
}

/**
 * Serialized AMM data structure for persistence
 */
export interface IAMMSerializedData {
  // Token configuration
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;

  // Pool state
  state: AMMState;
  pool?: string;
  position?: string;
  positionNft?: string;
}

/**
 * Configuration for deserializing an AMM
 */
export interface IAMMDeserializeConfig {
  authority: Keypair;
  executionService: IExecutionService;
  logger: LoggerService;
}