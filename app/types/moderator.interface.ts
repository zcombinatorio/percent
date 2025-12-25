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

import { PublicKey, Keypair } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { Commitment } from './execution.interface';
import { IProposal } from './proposal.interface';
import { ITWAPConfig } from './twap-oracle.interface';
import { PersistenceService } from '@app/services/persistence.service';
import { PoolType } from '../../src/config/pools';

/**
 * Enum representing the possible states of a proposal
 */
export enum ProposalStatus {
  Uninitialized = 'Uninitialized',  // Proposal created but not yet initialized on-chain
  Pending = 'Pending',              // Proposal is active and voting is ongoing
  Finalized = 'Finalized',          // Proposal has been finalized
}

/**
 * Moderator information structure
 */
export interface IModeratorInfo {
  id: number;
  protocolName?: string;
  proposalIdCounter: number;
  baseToken: {
    mint: string;
    decimals: number;
  };
  quoteToken: {
    mint: string;
    decimals: number;
  };
  poolAuthorities: Record<string, string>;  // Map of pool address -> authority public key (from env vars)
  dammWithdrawalPercentage?: number;
}

/**
 * Withdrawal build data passed from route to proposal initialization
 * Contains the unsigned transaction and metadata needed to confirm the withdrawal
 * Supports both DAMM (CP-AMM) and DLMM pool types
 *
 * DAMM uses single transaction, DLMM may use multiple transactions for wide bin ranges
 *
 * For DLMM: The API fetches Jupiter market price and adjusts amounts so that
 * transferred amounts match the market price ratio. Excess tokens are redeposited
 * back to the DLMM pool.
 */
export interface IWithdrawalBuildData {
  requestId: string;                            // API request ID for confirmation
  signedTransaction?: string;                   // Base58-encoded signed transaction (DAMM, single tx)
  signedTransactions?: string[];                // Base58-encoded signed transactions (DLMM, multi-tx)
  transactionCount?: number;                    // Number of transactions (1 for DAMM, 1+ for DLMM)
  withdrawalPercentage: number;                 // Percentage withdrawn from pool
  withdrawn: {
    tokenA: string;                             // Total base token amount withdrawn from pool (raw)
    tokenB: string;                             // Total quote token amount withdrawn from pool (raw)
  };
  transferred: {
    tokenA: string;                             // Base token amount transferred to manager (raw)
    tokenB: string;                             // Quote token amount transferred to manager (raw)
  };
  redeposited: {
    tokenA: string;                             // Base token amount redeposited to pool (raw)
    tokenB: string;                             // Quote token amount redeposited to pool (raw)
  };
  poolAddress: string;                          // Pool address (DAMM or DLMM)
  poolType: PoolType;                           // Pool type for routing to correct confirm endpoint
}

/**
 * @deprecated Use IWithdrawalBuildData instead
 */
export type IDammWithdrawalBuildData = IWithdrawalBuildData;

/**
 * Parameters for creating a new proposal
 */
export interface ICreateProposalParams {
  title: string;                                // Title of the proposal (required)
  description?: string;                         // Human-readable description of the proposal (optional)
  market_labels?: string[];                      // Labels for each market
  markets: number;                              // Number of markets
  proposalLength: number;                       // Duration of voting period in seconds
  spotPoolAddress?: string;                     // Optional Meteora pool address for spot market charts
  totalSupply: number;                          // Total supply of conditional tokens for market cap calculation
  twap: ITWAPConfig;                            // TWAP oracle configuration
  amm: {
    initialBaseAmount: BN;                      // Initial base token liquidity (same for all AMMs)
    initialQuoteAmount: BN;                     // Initial quote token liquidity (same for all AMMs)
  };
  dammWithdrawal?: IWithdrawalBuildData;        // Optional withdrawal data to confirm during initialize (DAMM or DLMM)
}

/**
 * Configuration for the Moderator contract
 */
export interface IModeratorConfig {
  baseMint: PublicKey;                         // Public key of the base token mint
  quoteMint: PublicKey;                        // Public key of the quote token mint
  baseDecimals: number;                        // Number of decimals for base token conditional mints
  quoteDecimals: number;                       // Number of decimals for quote token conditional mints
  defaultAuthority: Keypair;                   // Default authority keypair (payer and mint authority)
  poolAuthorities?: Map<string, Keypair>;      // Optional per-pool authority overrides (poolAddress -> authority)
  rpcEndpoint: string;                         // Solana RPC endpoint URL
  commitment?: Commitment;                     // Optional commitment level (defaults to 'confirmed')
  jitoUuid?: string;                           // Optional Jito UUID for bundle submissions (mainnet only)
  dammWithdrawalPercentage?: number;           // DAMM liquidity withdrawal percentage (0-50, defaults to 12)
}

/**
 * Interface for the Moderator contract that manages proposals
 */
export interface IModerator {
  id: number;                                   // Moderator ID
  protocolName?: string;                       // Protocol name (optional)
  config: IModeratorConfig;                    // Configuration parameters
  scheduler: any;                               // Scheduler for automatic tasks (SchedulerService)
  persistenceService: PersistenceService;       // Database persistence service

  /**
   * Returns a JSON object with all moderator configuration and state information
   * @returns Object containing moderator info
   */
  info(): Promise<IModeratorInfo>;

  /**
   * Getter for the current proposal ID counter
   * @returns The current proposal ID counter
   */
  getProposalIdCounter(): Promise<number>;

  /**
   * Creates a new proposal
   * @param params - Parameters for creating the proposal including AMM configuration
   * @returns The created proposal
   */
  createProposal(params: ICreateProposalParams): Promise<IProposal>;

  /**
   * Finalizes a proposal after voting period ends
   * @param id - The ID of the proposal to finalize
   * @returns Tuple of [status, winningMarketIndex | null]
   */
  finalizeProposal(id: number): Promise<[ProposalStatus, number | null]>;

  /**
   * Gets a proposal by ID from database (always fresh data)
   * @param id - Proposal ID
   * @returns Promise resolving to proposal or null if not found
   */
  getProposal(id: number): Promise<IProposal | null>;

  /**
   * Save a proposal to the database
   * @param proposal - The proposal to save
   */
  saveProposal(proposal: IProposal): Promise<void>;
}