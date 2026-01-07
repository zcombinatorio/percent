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
import { Monitor, MonitoredProposal } from '../monitor';
import { SSEManager } from '../lib/sse';
import { logError } from '../lib/logger';
import { callApi } from '../lib/api';
import { HistoryService } from '@app/services/history.service';
import { Decimal } from 'decimal.js';

const CRANK_INTERVAL_MS = 65_000; // 5 second buffer

interface CrankResult {
  pool: string;
  signature?: string;
  skipped?: boolean;
  reason?: string;
}

interface CrankResponse {
  message: string;
  proposal_pda: string;
  dao_pda: string;
  num_options: number;
  pools_cranked: number;
  results: CrankResult[];
}

interface PoolTWAP {
  pool: string;
  twap: number;
}

/**
 * Cranks TWAP oracles every ~60 seconds for all pools of monitored proposals.
 * Uses the DAO API to execute cranks (API handles warmup and rate limiting).
 * Broadcasts TWAP_UPDATE events via SSE after each crank.
 */
export class TWAPService {
  private monitor: Monitor | null = null;
  private proposalTimers = new Map<string, NodeJS.Timeout>();

  constructor(private sse: SSEManager) {}

  /**
   * Subscribe to monitor events and schedule TWAP cranking for all proposals
   */
  start(monitor: Monitor) {
    this.monitor = monitor;

    // Schedule cranking for existing proposals
    for (const proposal of monitor.getMonitored()) {
      this.scheduleCranking(proposal);
    }

    // Listen for new proposals
    monitor.on('proposal:added', (proposal) => {
      this.scheduleCranking(proposal);
    });

    // Stop cranking when proposal is removed
    monitor.on('proposal:removed', (proposal) => {
      this.stopCranking(proposal.proposalPda);
    });

    console.log('[TWAP] Started');
  }

  /**
   * Stop all TWAP cranking
   */
  stop() {
    for (const timer of this.proposalTimers.values()) {
      clearInterval(timer);
    }
    this.proposalTimers.clear();
    this.monitor = null;
    console.log('[TWAP] Stopped');
  }

  private scheduleCranking(proposal: MonitoredProposal) {
    if (this.proposalTimers.has(proposal.proposalPda)) return; // Already scheduled

    // Crank and broadcast immediately, then every interval
    void this.crankProposal(proposal);
    void this.fetchAndBroadcastTWAPs(proposal);

    const timer = setInterval(() => {
      void this.crankProposal(proposal);
      void this.fetchAndBroadcastTWAPs(proposal);
    }, CRANK_INTERVAL_MS);

    this.proposalTimers.set(proposal.proposalPda, timer);
    console.log(`[TWAP] Started cranking for ${proposal.proposalPda} (every ${CRANK_INTERVAL_MS / 1000}s)`);
  }

  private async crankProposal(proposal: MonitoredProposal) {
    if (!this.monitor) return;

    try {
      const data = await callApi('/dao/crank-twap', { proposal_pda: proposal.proposalPda });
      const response = data as CrankResponse;

      // Log results
      const cranked = response.results.filter((r) => r.signature).length;
      const skipped = response.results.filter((r) => r.skipped).length;
      const failed = response.results.filter((r) => !r.signature && !r.skipped).length;

      console.log(
        `[TWAP] Cranked ${proposal.proposalPda}: ${cranked} cranked, ${skipped} skipped, ${failed} failed`
      );

      // Log individual failures
      for (const result of response.results) {
        if (!result.signature && !result.skipped) {
          console.error(`[TWAP] Pool ${result.pool} failed: ${result.reason}`);
        }
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[TWAP] Crank failed for ${proposal.proposalPda}:`, errMsg);
      logError('twap', {
        action: 'crank',
        name: proposal.name,
        proposal: proposal.proposalPda,
        error: errMsg,
      });

      // If proposal not found or finalized, stop cranking
      if (errMsg.includes('not found') || errMsg.includes('finalized')) {
        console.log(`[TWAP] Proposal ${proposal.proposalPda} not found or finalized, stopping`);
        this.stopCranking(proposal.proposalPda);
      }
    }
  }

  private async fetchAndBroadcastTWAPs(proposal: MonitoredProposal) {
    if (!this.monitor) return;

    const poolTWAPs: PoolTWAP[] = [];

    for (const poolPdaStr of proposal.pools) {
      try {
        const poolPda = new PublicKey(poolPdaStr);
        const twapBN = await this.monitor.client.amm.fetchTwap(poolPda);

        // Convert BN to number (null means still in warmup)
        const twap = twapBN ? Number(twapBN.toString()) / 1e12 : 0;

        poolTWAPs.push({
          pool: poolPdaStr,
          twap
        });
      } catch (error) {
        // Skip pools that fail to fetch
        console.error(`[TWAP] Failed to fetch for pool ${poolPdaStr}:`, error);
      }
    }

    // Broadcast TWAP update if we have data
    if (poolTWAPs.length > 0) {
      this.sse.broadcast('TWAP_UPDATE', {
        proposalPda: proposal.proposalPda,
        pools: poolTWAPs,
        timestamp: Date.now(),
      });

      // Record to DB
      try {
        await HistoryService.recordCmbTWAP({
          proposalPda: proposal.proposalPda,
          twaps: poolTWAPs.map((p) => new Decimal(p.twap)),
        });
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[TWAP] Error recording to DB:`, errMsg);
        logError('twap', { action: 'record_twap', proposalPda: proposal.proposalPda, error: errMsg });
      }
    }
  }

  private stopCranking(proposalPda: string) {
    const timer = this.proposalTimers.get(proposalPda);
    if (timer) {
      clearInterval(timer);
      this.proposalTimers.delete(proposalPda);
      console.log(`[TWAP] Stopped cranking for ${proposalPda}`);
    }
  }
}
