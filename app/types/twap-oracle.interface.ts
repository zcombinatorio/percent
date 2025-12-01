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

import { Decimal } from 'decimal.js';
import { IAMM } from './amm.interface';

/**
 * Configuration for TWAP oracle
 */
export interface ITWAPConfig {
  initialTwapValue: number;                     // Initial observation value for all AMMs
  twapMaxObservationChangePerUpdate: number | null;  // Maximum change allowed per update (null = no limit)
  twapStartDelay: number;                       // Delay in milliseconds before TWAP starts recording
  passThresholdBps: number;                     // Basis points threshold for proposal to pass
  minUpdateInterval: number;                    // Minimum interval between TWAP updates in milliseconds
}

/**
 * Interface for Time-Weighted Average Price oracle
 * Tracks and aggregates prices from multiple AMMs (2-5 markets)
 */
export interface ITWAPOracle {
  readonly proposalId: number;                          // ID of associated proposal (immutable)
  readonly initialTwapValue: number;                    // Initial observation value (immutable)
  readonly twapMaxObservationChangePerUpdate: number | null;  // Max observation change per update (null = no limit) (immutable)
  readonly twapStartDelay: number;                      // Start delay in milliseconds (immutable)
  readonly passThresholdBps: number;                    // Pass threshold in basis points (immutable)
  readonly minUpdateInterval: number;                   // Minimum interval between updates in milliseconds (immutable)
  readonly createdAt: number;                           // Creation timestamp in milliseconds (immutable)
  readonly finalizedAt: number;                         // Finalization timestamp in milliseconds (immutable)
  readonly markets: number;                             // Number of markets (2-5 inclusive) (immutable)

  /**
   * Sets the AMMs for the oracle to track
   * Must be called before any other oracle operations
   * Should be in-order of the markets
   * @param AMMs - Array of AMM instances
   * @throws Error if AMMs have already been set or count doesn't match markets
   */
  setAMMs(AMMs: IAMM[]): void;

  /**
   * Updates TWAP observations and aggregations based on current AMM prices
   * Respects start delay, finalization time, and minimum update interval
   * Observations are clamped by twapMaxObservationChangePerUpdate
   * @throws Error if AMMs are not set
   */
  crankTWAP(): Promise<void>;

  /**
   * Fetches current TWAP prices and aggregations for all markets
   * @returns Object containing:
   *   - twaps: Array of time-weighted average prices (one per AMM)
   *   - aggregations: Array of cumulative weighted observations (one per AMM)
   * @throws Error if AMMs are not set or no time has passed
   */
  fetchTWAPs(): {
    twaps: Decimal[];
    aggregations: Decimal[];
  };

  /**
   * Determines the index of the highest TWAP
   * @returns Index of the market with the highest TWAP
   * @throws Error if AMMs are not set
   */
  fetchHighestTWAPIndex(): number;

  /**
   * Serializes the TWAP oracle state for persistence
   * @returns Serialized TWAP oracle data that can be saved to database
   */
  serialize(): ITWAPOracleSerializedData;
}

/**
 * Serialized TWAP oracle data structure for persistence
 */
export interface ITWAPOracleSerializedData {
  // Core configuration
  proposalId: number;
  initialTwapValue: number;
  twapMaxObservationChangePerUpdate: number | null;
  twapStartDelay: number;
  passThresholdBps: number;
  minUpdateInterval: number;
  createdAt: number;
  finalizedAt: number;

  // Current state
  observations: Decimal[];
  aggregations: Decimal[];
  lastUpdateTime: number;

  // Markets
  markets: number;

  // Note: AMMs are not serialized as they are set via setAMMs method after deserialization
}