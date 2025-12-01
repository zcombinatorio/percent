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

import { PublicKey, Keypair, Transaction } from '@solana/web3.js';
import { ProposalStatus } from './moderator.interface';
import { IExecutionService } from './execution.interface';
import { LoggerService } from '@app/services/logger.service';

/**
 * Vault type indicating whether this vault manages base or quote tokens
 */
export enum VaultType {
  Base = 'base',
  Quote = 'quote'
}

/**
 * Vault state indicating the operational status
 */
export enum VaultState {
  Uninitialized = 'Uninitialized', // Vault not yet initialized
  Active = 'Active',                // Vault is active and can perform splits/merges
  Finalized = 'Finalized'           // Vault is finalized, only redemptions allowed
}

/**
 * Token type for distinguishing between base and quote tokens
 */
export enum TokenType {
  Base = 'base',   // Primary token (e.g., USDC)
  Quote = 'quote'  // Secondary token (e.g., SOL)
}

/**
 * Complete token balance snapshot for a user
 */
export interface ITokenBalance {
  regular: bigint;        // Regular token balance (base or quote)
  conditional: {
    [mint: string]: bigint;
  };
}

/**
 * Configuration for creating a new vault
 */
export interface IVaultConfig {
  proposalId: number;        // Associated proposal ID
  vaultType: VaultType;      // Base or Quote vault
  markets: number;           // Number of markets
  regularMint: PublicKey;    // SPL token mint for regular token (base or quote)
  decimals: number;          // Number of decimals for conditional tokens
  authority: Keypair;        // Vault authority keypair (payer and mint authority)
  executionService: IExecutionService; // Execution service (required)
  logger: LoggerService;
}

/**
 * Interface for vault managing 1:1 token exchange in prediction markets
 * Each vault manages multiple conditional tokens (N markets) for a single regular token type
 */
export interface IVault {
  // Immutable properties
  readonly proposalId: number;              // Associated proposal ID
  readonly vaultType: VaultType;            // Base or Quote vault type
  readonly regularMint: PublicKey;          // Regular token mint (base or quote)
  readonly decimals: number;                // Number of decimals for conditional tokens
  readonly markets: number;                 // Number of markets (2-5 inclusive)
  readonly conditionalMints: PublicKey[];   // Array of conditional token mints (created on init)
  readonly escrow: PublicKey;               // Escrow holding regular tokens
  readonly state: VaultState;               // Current operational state of the vault

  /**
   * Builds a transaction for initializing the vault
   * Creates N conditional token mints and escrow account
   * Transaction is always pre-signed with authority and mint keypairs
   * @returns Pre-signed transaction ready for execution
   * @throws Error if vault is already initialized
   */
  buildInitializeTx(): Promise<Transaction>;

  /**
   * Initializes vault by creating conditional token mints and escrow accounts
   * Must be called before any other operations
   */
  initialize(): Promise<void>;

  /**
   * Builds transaction for splitting regular tokens into N conditional tokens
   * User receives equal amounts of each conditional token for each regular token
   * Automatically handles SOL wrapping if needed (mainnet + quote vault)
   * @param user - User's public key who is splitting tokens
   * @param amount - Amount to split in smallest units
   * @returns Transaction with blockhash and fee payer set, ready for user signature
   * @throws Error if insufficient balance or vault is finalized
   */
  buildSplitTx(
    user: PublicKey,
    amount: bigint
  ): Promise<Transaction>;

  /**
   * Builds transaction for merging ALL conditional tokens back to regular tokens
   * Requires equal amounts of all conditional tokens to receive regular tokens
   * Automatically handles SOL unwrapping if needed (mainnet + quote vault)
   * @param user - User's public key who is merging tokens
   * @param amount - Amount to merge in smallest units (of each conditional token)
   * @returns Transaction with blockhash and fee payer set, ready for user signature
   * @throws Error if insufficient balance of any conditional token or vault is finalized
   */
  buildMergeTx(
    user: PublicKey,
    amount: bigint
  ): Promise<Transaction>;

  /**
   * Executes a split transaction
   * @param transaction - Transaction signed by user
   * @returns Transaction signature
   * @throws Error if transaction execution fails
   */
  executeSplitTx(transaction: Transaction): Promise<string>;

  /**
   * Executes a merge transaction
   * @param transaction - Transaction signed by user
   * @returns Transaction signature
   * @throws Error if transaction execution fails
   */
  executeMergeTx(transaction: Transaction): Promise<string>;
  
  /**
   * Gets regular token balance for a user
   * @param user - User's public key
   * @returns Balance in smallest units
   */
  getRegularBalance(user: PublicKey): Promise<bigint>;

  /**
   * Gets conditional token balance for a user for a specific mint
   * @param user - User's public key
   * @param mint - Conditional token mint
   * @returns Balance in smallest units
   */
  getConditionalBalance(user: PublicKey, mint: PublicKey): Promise<bigint>;

  /**
   * Gets all token balances for a user
   * @param user - User's public key
   * @returns Complete balance snapshot
   */
  getUserBalances(user: PublicKey): Promise<ITokenBalance>;

  /**
   * Finalizes vault when proposal ends, storing the winning conditional mint
   * After finalization, split/merge are blocked and only redemption is allowed
   * @param winningConditionalMint - The winning conditional mint
   * @throws Error if vault not active or mint is invalid
   */
  finalize(winningConditionalMint: PublicKey): Promise<void>;

  /**
   * Builds a transaction to redeem winning conditional tokens for regular tokens
   * Only the winning conditional tokens can be redeemed
   * Automatically handles SOL unwrapping if needed (mainnet + quote vault)
   * @param user - User's public key
   * @returns Transaction with blockhash and fee payer set, ready for user signature
   * @throws Error if vault not finalized or no winning tokens to redeem
   */
  buildRedeemWinningTokensTx(user: PublicKey): Promise<Transaction>;

  /**
   * Executes a redeem winning tokens transaction
   * @param transaction - Transaction signed by user
   * @returns Transaction signature
   * @throws Error if transaction execution fails
   */
  executeRedeemWinningTokensTx(transaction: Transaction): Promise<string>;

  /**
   * Serializes the vault state for persistence
   * @returns Serialized vault data that can be saved to database
   */
  serialize(): IVaultSerializedData;
}

/**
 * Serialized vault data structure for persistence
 */
export interface IVaultSerializedData {
  // Core identifiers
  proposalId: number;
  vaultType: VaultType;
  markets: number;

  // Token mints (stored as base58 strings)
  regularMint: string;
  conditionalMints: string[];
  winningConditionalMint: string;

  // State - escrow is deterministic and doesn't need to be stored
  state: VaultState;
  proposalStatus: ProposalStatus;

  // Token configuration
  decimals: number;
}

/**
 * Configuration for deserializing a vault
 */
export interface IVaultDeserializeConfig {
  authority: Keypair;
  executionService: IExecutionService;
  logger: LoggerService;
}