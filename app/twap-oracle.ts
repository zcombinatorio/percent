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

import { ITWAPOracle, ITWAPConfig, ITWAPOracleSerializedData } from './types/twap-oracle.interface';
import { IAMM } from './types/amm.interface';
import { Decimal } from 'decimal.js';


/**
 * TWAP Oracle implementation for tracking time-weighted average prices
 * Aggregates prices from conditional AMMs to determine proposal outcome
 */
export class TWAPOracle implements ITWAPOracle {
  public readonly proposalId: number;
  public readonly initialTwapValue: number;
  public readonly twapMaxObservationChangePerUpdate: number | null;
  public readonly twapStartDelay: number;
  public readonly passThresholdBps: number;
  public readonly minUpdateInterval: number;
  public readonly createdAt: number;
  public readonly finalizedAt: number;
  public readonly markets: number;

  private _observations: Decimal[];
  private _aggregations: Decimal[];
  private _lastUpdateTime: number;
  private _AMMs: IAMM[] | null = null;

  /**
   * Creates a new TWAP Oracle instance
   * @param proposalId - ID of the associated proposal
   * @param config - TWAP configuration parameters
   * @param markets - Number of markets
   * @param createdAt - Proposal creation timestamp
   * @param finalizedAt - Proposal finalization timestamp
   */
  constructor(
    proposalId: number,
    config: ITWAPConfig,
    markets: number,
    createdAt: number,
    finalizedAt: number
  ) {
    this.proposalId = proposalId;
    this.initialTwapValue = config.initialTwapValue;
    this.twapMaxObservationChangePerUpdate = config.twapMaxObservationChangePerUpdate;
    this.twapStartDelay = config.twapStartDelay;
    this.passThresholdBps = config.passThresholdBps;
    this.minUpdateInterval = config.minUpdateInterval;
    this.createdAt = createdAt;
    this.finalizedAt = finalizedAt;
    this.markets = markets;

    // Initialize observations and aggregations with the initial value
    this._observations = Array(markets).fill(config.initialTwapValue);
    this._aggregations = Array(markets).fill(null).map(() => new Decimal(0));
    this._lastUpdateTime = createdAt;
  }

  /**
   * Sets the AMMs for the oracle to track
   * Should be in-order of the markets
   * @param AMMs - Array of AMM instances
   */
  setAMMs(AMMs: IAMM[]): void {
    if (this._AMMs) {
      throw new Error('AMMs have already been set');
    }
    if (AMMs.length !== this.markets) {
      throw new Error('Number of AMMs must match number of markets');
    }
    this._AMMs = AMMs;
  }

  /**
   * Updates the TWAP aggregations based on current AMM prices
   * Respects start delay and finalization time
   * Limited by twapMaxObservationChangePerUpdate per call
   */
  async crankTWAP(): Promise<void> {
    const currentTime = Date.now();
    
    // Check if we're after finalization
    if (currentTime >= this.finalizedAt) {
      return; // Don't update aggregations after finalization
    }

    if (!this._AMMs) {
      throw new Error('AMMs not set - call setAMMs first');
    }

    // Minimum time between updates
    if (currentTime < this._lastUpdateTime + this.minUpdateInterval) {
      return; // Not enough time has passed since last update
    }

    // Fetch current prices from all AMMs
    const prices = await Promise.all(
      this._AMMs.map(amm => amm.fetchPrice())
    );

    // Update observations with optional clamping to max change
    const maxChange = this.twapMaxObservationChangePerUpdate;
    
    if (maxChange === null) {
      // No max change - set observations directly to prices
      this._observations = prices.map(price => new Decimal(price));
    } else {
      // Update observations with clamping
      for (let i = 0; i < this.markets; i++) {
        if (prices[i] > this._observations[i]) {
          const maxObservation = this._observations[i].add(maxChange);
          this._observations[i] = Decimal.min(prices[i], maxObservation);
        } else {
          const minObservation = Decimal.max(0, this._observations[i].sub(maxChange));
          this._observations[i] = Decimal.max(prices[i], minObservation);
        }
      }
    }

    // Update aggregations if we're past the start delay
    const twapStartTime = this.createdAt + this.twapStartDelay;
    if (currentTime > twapStartTime) {
      // Calculate effective last update time (don't count time before start)
      const effectiveLastUpdateTime = Math.max(this._lastUpdateTime, twapStartTime);
      const effectiveCurrentTime = Math.min(currentTime, this.finalizedAt);
      const timeElapsed = effectiveCurrentTime - effectiveLastUpdateTime;

      if (timeElapsed > 0) {
        // Add weighted observations to aggregations
        this._aggregations = this._observations.map(observation => observation.mul(timeElapsed));
      }
    }

    // Update last update time
    this._lastUpdateTime = currentTime;
  }

  /**
   * @returns Object containing TWAPs and aggregations
   * @throws Error if AMMs are not set or no time has passed
   */
  fetchTWAPs(): {
    twaps: Decimal[];
    aggregations: Decimal[];
  } {
    if (!this._AMMs) {
      throw new Error('AMMs not set - call setAMMs first');
    }

    const twapStartTime = this.createdAt + this.twapStartDelay;
    const currentTime = Math.min(Date.now(), this.finalizedAt);

    // Calculate time passed since TWAP started
    if (currentTime <= twapStartTime) {
        // TWAP hasn't started yet, return initial values
        return {
          twaps: this._observations,
          aggregations: this._aggregations,
        };
      }

    const timePassed = currentTime - twapStartTime;
    if (timePassed <= 0) {
      throw new Error('No time has passed since TWAP start');
    }

    // Calculate TWAP prices by dividing aggregations by time passed
    const twaps = this._aggregations.map(agg => agg.div(timePassed));

    return {
      twaps,
      aggregations: this._aggregations,
    };
  }

  /**
   * Determines the index of the highest TWAP
   * @returns Index of the highest TWAP
   * @throws Error if AMMs are not set
   */
  fetchHighestTWAPIndex(): number {
    if (!this._AMMs) {
      throw new Error('AMMs not set - call setAMMs first');
    }

    const { twaps } = this.fetchTWAPs();

    // return index of the highest TWAP
    // Use twaps[0] as initial value instead of new Decimal(0) to ensure indexOf can find it
    // (indexOf uses reference equality, so a new Decimal(0) won't match existing Decimal(0) values)
    return twaps.indexOf(twaps.reduce((max, twap) => twap.gt(max) ? twap : max, twaps[0]));
  }

  /**
   * Serializes the TWAP oracle state for persistence
   * @returns Serialized TWAP oracle data that can be saved to database
   */
  serialize(): ITWAPOracleSerializedData {
    return {
      // Core configuration
      proposalId: this.proposalId,
      initialTwapValue: this.initialTwapValue,
      twapMaxObservationChangePerUpdate: this.twapMaxObservationChangePerUpdate,
      twapStartDelay: this.twapStartDelay,
      passThresholdBps: this.passThresholdBps,
      minUpdateInterval: this.minUpdateInterval,
      createdAt: this.createdAt,
      finalizedAt: this.finalizedAt,

      // Current state
      observations: this._observations,
      aggregations: this._aggregations,
      lastUpdateTime: this._lastUpdateTime,

      // Markets
      markets: this.markets,

      // Note: AMMs are not serialized as they need to be set via setAMMs after deserialization
    };
  }

  /**
   * Deserializes TWAP oracle data and restores the oracle state
   * @param data - Serialized TWAP oracle data from database
   * @returns Restored TWAP oracle instance
   * @note AMMs must be set using setAMMs() after deserialization
   */
  static deserialize(data: ITWAPOracleSerializedData): TWAPOracle {
    // Create configuration from serialized data
    const twapConfig: ITWAPConfig = {
      initialTwapValue: data.initialTwapValue,
      twapMaxObservationChangePerUpdate: data.twapMaxObservationChangePerUpdate,
      twapStartDelay: data.twapStartDelay,
      passThresholdBps: data.passThresholdBps,
      minUpdateInterval: data.minUpdateInterval
    };

    // Create a new TWAPOracle instance with the configuration
    const oracle = new TWAPOracle(
      data.proposalId,
      twapConfig,
      data.markets,
      data.createdAt,
      data.finalizedAt
    );

    // Restore the internal state
    // These are private fields that need to be restored for a fully functional oracle
    oracle._observations = data.observations.map((obs: any) => new Decimal(obs));
    oracle._aggregations = data.aggregations.map((agg: any) => new Decimal(agg));
    oracle._lastUpdateTime = data.lastUpdateTime;

    // AMMs will be set via setAMMs() method after deserialization
    // since they are references to external objects

    return oracle;
  }
}