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

import { Transaction, Keypair, Connection } from '@solana/web3.js';

/**
 * Interface for Execution Service
 * Defines methods for handling Solana transaction execution
 *
 * Implementation note: The constructor should accept:
 * - config: IExecutionConfig - Configuration for the service
 * - logger: LoggerService - Logger instance for the service
 */
export interface IExecutionService {
  readonly connection: Connection; // Connection to the Solana cluster
  config: IExecutionConfig; // Configuration for the service

  /**
   * Executes a transaction on Solana
   * @param transaction - Transaction to execute
   * @param signer - Optional keypair to sign the transaction (if not already signed)
   * @param additionalSigners - Additional keypairs that need to sign the transaction
   * @returns Execution result with signature and status
   */
  executeTx(
    transaction: Transaction,
    signer?: Keypair,
    additionalSigners?: Keypair[]
  ): Promise<IExecutionResult>;

  /**
   * Add compute budget instructions to the beginning of a transaction
   * MUST be called before signing the transaction
   * @param transaction - Transaction to add compute budget to
   * @returns Promise that resolves when instructions are added
   */
  addComputeBudgetInstructions(transaction: Transaction): Promise<void>;
}

/**
 * Priority fee mode for transaction execution
 */
export enum PriorityFeeMode {
  None = 'none',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Dynamic = 'dynamic'
}

/**
 * Status of transaction execution
 */
export enum ExecutionStatus {
  Success = 'success',
  Failed = 'failed',
  Pending = 'pending'
}

/**
 * Commitment level for transaction execution
 */
export enum Commitment {
  Processed = 'processed',
  Confirmed = 'confirmed',
  Finalized = 'finalized'
}

/**
 * Result of a transaction execution attempt
 */
export interface IExecutionResult {
  signature: string;          // Transaction signature on chain
  status: ExecutionStatus;    // Execution status
  timestamp: number;          // Execution timestamp (ms)
  proposalId?: number;        // Optional proposal ID for context
  error?: string;             // Error message if failed
}

/**
 * Configuration for transaction execution
 */
export interface IExecutionConfig {
  rpcEndpoint: string;        // Solana RPC endpoint URL
  commitment?: Commitment;  // Commitment level
  maxRetries?: number;        // Max retry attempts on failure
  skipPreflight?: boolean;    // Skip preflight simulation
  priorityFeeMode?: PriorityFeeMode;  // Priority fee strategy
  maxPriorityFeeLamports?: number;  // Max priority fee in microlamports per CU (default 25000)
  computeUnitLimit?: number;  // Override compute unit limit (default auto-calculated)
}

/**
 * Structured log output for execution events
 */
export interface IExecutionLog {
  signature: string;
  status: ExecutionStatus;
  timestamp: number;
  error?: string;
}