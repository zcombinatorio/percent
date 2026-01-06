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

import { PublicKey } from '@solana/web3.js';
import { PoolState, TwapOracle, parsePoolState } from '@zcomb/programs-sdk';
import { Monitor, MonitoredProposal } from '../monitor';
import { logError } from '../logger';

const CRANK_INTERVAL_MS = 60_000; // 60 seconds

interface PoolTimers {
  warmupTimeout?: NodeJS.Timeout;
  crankInterval?: NodeJS.Timeout;
}

/**
 * Cranks TWAP oracles every ~60 seconds for all pools of monitored proposals.
 * Waits for warmup period to end before starting to crank.
 */
export class TWAPService {
  private monitor: Monitor | null = null;
  private poolTimers = new Map<string, PoolTimers>();

  /**
   * Subscribe to monitor events and schedule TWAP cranking for all pools
   */
  start(monitor: Monitor) {
    this.monitor = monitor;

    // Schedule cranking for existing proposals
    for (const proposal of monitor.getMonitored()) {
      this.scheduleProposalPools(proposal);
    }

    // Listen for new proposals
    monitor.on('proposal:added', (proposal) => {
      this.scheduleProposalPools(proposal);
    });

    // Stop cranking when proposal is removed
    monitor.on('proposal:removed', (proposal) => {
      this.stopProposalPools(proposal);
    });

    console.log('TWAP service started');
  }

  /**
   * Stop all TWAP cranking
   */
  stop() {
    for (const [poolPda, timers] of this.poolTimers.entries()) {
      if (timers.warmupTimeout) clearTimeout(timers.warmupTimeout);
      if (timers.crankInterval) clearInterval(timers.crankInterval);
    }
    this.poolTimers.clear();
    this.monitor = null;
    console.log('TWAP service stopped');
  }

  private scheduleProposalPools(proposal: MonitoredProposal) {
    for (const poolPdaStr of proposal.pools) {
      this.schedulePoolCranking(poolPdaStr, proposal.proposalPda);
    }
  }

  private stopProposalPools(proposal: MonitoredProposal) {
    for (const poolPdaStr of proposal.pools) {
      this.stopPoolCranking(poolPdaStr);
    }
  }

  private async schedulePoolCranking(poolPdaStr: string, proposalPdaStr: string) {
    if (!this.monitor) return;
    if (this.poolTimers.has(poolPdaStr)) return; // Already scheduled

    try {
      const poolPda = new PublicKey(poolPdaStr);
      const pool = await this.monitor.client.amm.fetchPool(poolPda);

      // Check if pool is already finalized
      if (parsePoolState(pool.state) === PoolState.Finalized) {
        console.log(`Pool ${poolPdaStr} already finalized, skipping TWAP cranking`);
        return;
      }

      const delayMs = this.getWarmupDelayMs(pool.oracle);

      if (delayMs > 0) {
        // Still in warmup - schedule timeout then start interval
        console.log(`Pool ${poolPdaStr} in warmup, cranking starts in ${Math.round(delayMs / 1000)}s`);

        const timers: PoolTimers = {};
        timers.warmupTimeout = setTimeout(() => {
          this.startCrankInterval(poolPdaStr, proposalPdaStr);
        }, delayMs);

        this.poolTimers.set(poolPdaStr, timers);
      } else {
        // Warmup ended - start cranking immediately
        this.startCrankInterval(poolPdaStr, proposalPdaStr);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to schedule TWAP cranking for pool ${poolPdaStr}:`, errMsg);
      logError('twap', {
        action: 'schedule',
        pool: poolPdaStr,
        proposal: proposalPdaStr,
        error: errMsg,
      });
    }
  }

  private getWarmupDelayMs(oracle: TwapOracle): number {
    const warmupEndSec = oracle.createdAtUnixTime.toNumber() + oracle.warmupDuration;
    const warmupEndMs = warmupEndSec * 1000;
    return Math.max(0, warmupEndMs - Date.now());
  }

  private startCrankInterval(poolPdaStr: string, proposalPdaStr: string) {
    if (!this.monitor) return;

    // Get or create timers entry
    let timers = this.poolTimers.get(poolPdaStr);
    if (!timers) {
      timers = {};
      this.poolTimers.set(poolPdaStr, timers);
    }

    // Clear warmup timeout if it exists
    if (timers.warmupTimeout) {
      clearTimeout(timers.warmupTimeout);
      timers.warmupTimeout = undefined;
    }

    // Crank immediately, then every interval
    this.crankPool(poolPdaStr, proposalPdaStr);

    timers.crankInterval = setInterval(() => {
      this.crankPool(poolPdaStr, proposalPdaStr);
    }, CRANK_INTERVAL_MS);

    console.log(`Started TWAP cranking for pool ${poolPdaStr} (every ${CRANK_INTERVAL_MS / 1000}s)`);
  }

  private async crankPool(poolPdaStr: string, proposalPdaStr: string) {
    if (!this.monitor) return;

    try {
      const poolPda = new PublicKey(poolPdaStr);
      // ! TODO: USE ACTUAL FUNDED WALLET OR CREATE COMBINATOR API
      const builder = await this.monitor.client.amm.crankTwap(poolPda);
      await builder.rpc();
      console.log(`Cranked TWAP for pool ${poolPdaStr} (proposal: ${proposalPdaStr})`);
    } catch (error) {
      // Log but don't crash - TWAP crank can fail if pool is finalized or other transient issues
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`Failed to crank TWAP for pool ${poolPdaStr}:`, errMsg);
      logError('twap', {
        action: 'crank',
        pool: poolPdaStr,
        proposal: proposalPdaStr,
        error: errMsg,
      });

      // If pool is finalized, stop cranking
      if (errMsg.includes('InvalidState') || errMsg.includes('finalized')) {
        console.log(`Pool ${poolPdaStr} appears finalized, stopping TWAP cranking`);
        this.stopPoolCranking(poolPdaStr);
      }
    }
  }

  private stopPoolCranking(poolPdaStr: string) {
    const timers = this.poolTimers.get(poolPdaStr);
    if (timers) {
      if (timers.warmupTimeout) clearTimeout(timers.warmupTimeout);
      if (timers.crankInterval) clearInterval(timers.crankInterval);
      this.poolTimers.delete(poolPdaStr);
      console.log(`Stopped TWAP cranking for pool ${poolPdaStr}`);
    }
  }
}
