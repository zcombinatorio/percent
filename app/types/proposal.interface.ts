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
import { IAMM, IAMMSerializedData } from './amm.interface';
import { ITWAPOracle, ITWAPConfig, ITWAPOracleSerializedData } from './twap-oracle.interface';
import { ProposalStatus } from './moderator.interface';
import { IExecutionService } from './execution.interface';
import { LoggerService } from '../services/logger.service';
import { VaultClient, VaultType } from '@zcomb/vault-sdk';

/**
 * Comprehensive status information for a proposal
 */
export interface IProposalStatusInfo {
  status: ProposalStatus;
  winningMarketIndex: number | null;
  winningMarketLabel: string | null;
  winningBaseConditionalMint: PublicKey | null;
  winningQuoteConditionalMint: PublicKey | null;
}

/**
 * Configuration for creating a new proposal
 */
export interface IProposalConfig {
  id: number;                                   // Unique proposal identifier
  moderatorId: number;                          // Moderator ID
  title: string;                                // Proposal title (required)
  description?: string;                         // Human-readable description (optional)
  market_labels?: string[];                     // Labels for each market
  markets: number;                              // Number of markets
  createdAt: number;                            // Creation timestamp in milliseconds
  proposalLength: number;                       // Duration of voting period in seconds
  baseMint: PublicKey;                          // Public key of base token mint
  quoteMint: PublicKey;                         // Public key of quote token mint
  baseDecimals: number;                         // Number of decimals for base token conditional mints
  quoteDecimals: number;                        // Number of decimals for quote token conditional mints
  authority: Keypair;                           // Authority keypair (payer and mint authority)
  executionService: IExecutionService;          // Execution service for transactions
  twap: ITWAPConfig;                            // TWAP oracle configuration
  spotPoolAddress?: string;                     // Optional Meteora pool address for spot market price (for charts)
  totalSupply: number;                          // Total supply of conditional tokens for market cap calculation
  ammConfig: {
    initialBaseAmount: BN;                      // Initial base token liquidity (same for both AMMs)
    initialQuoteAmount: BN;                     // Initial quote token liquidity (same for both AMMs)
  };
  logger: LoggerService;
}

/**
 * Interface for governance proposals in the protocol
 * Manages AMMs, vaults, and TWAP oracle for price discovery
 * Supports 2-5 markets per proposal
 */
export interface IProposal {
  readonly config: IProposalConfig;    // Configuration object containing all proposal parameters
  AMMs: IAMM[];                        // Array of AMMs (one per market, initialized during proposal setup)
  readonly twapOracle: ITWAPOracle;    // Time-weighted average price oracle (immutable)
  readonly finalizedAt: number;        // Timestamp when voting ends (ms, immutable)

  /**
   * Gets comprehensive status information including winner details
   * @returns Status info with winning market details (if finalized)
   */
  getStatus(): IProposalStatusInfo;

  /**
   * Initializes the proposal's blockchain components
   * Sets up AMMs, vaults, and begins TWAP recording
   * Uses connection, authority, and decimals from constructor config
   */
  initialize(): Promise<void>;

  /**
   * Gets all AMMs for the proposal
   * @returns Array of AMM instances
   * @throws Error if AMMs are uninitialized
   */
  getAMMs(): IAMM[];

  /**
   * Finalizes the proposal based on TWAP results
   * Determines winner by highest TWAP index
   * @returns Tuple of [status, winningMarketIndex | null]
   */
  finalize(): Promise<[ProposalStatus, number | null]>;

  /**
   * Serializes the proposal state for persistence
   * @returns Serialized proposal data that can be saved to database
   */
  serialize(): IProposalSerializedData;

  /**
   * Derives the vault PDA for a given vault type
   * @param vaultType - The type of vault (Base or Quote)
   * @returns The derived vault PDA public key
   */
  deriveVaultPDA(vaultType: VaultType): PublicKey;
}

/**
 * Serialized proposal data structure for persistence
 */
export interface IProposalSerializedData {
  // Core configuration
  id: number;
  moderatorId: number;
  title: string;
  description?: string;
  market_labels?: string[];
  markets: number;
  createdAt: number;
  proposalLength: number;
  finalizedAt: number;
  status: ProposalStatus;

  // Token configuration
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;

  // AMM configuration
  ammConfig: {
    initialBaseAmount: string;
    initialQuoteAmount: string;
  };

  // Optional fields
  spotPoolAddress?: string;
  totalSupply: number;

  // TWAP configuration
  twapConfig: ITWAPConfig;

  // Serialized components
  AMMData: IAMMSerializedData[];
  twapOracleData: ITWAPOracleSerializedData;
}

/**
 * Configuration for deserializing a proposal
 */
export interface IProposalDeserializeConfig {
  authority: Keypair;
  executionService: IExecutionService;
  logger: LoggerService;
}