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

import { Monitor, MonitoredProposal } from '../monitor';
import { logError } from '../lib/logger';
import { callApi } from '../lib/api';
import { SSEManager } from '../lib/sse';

interface StepResult {
  success: boolean;
  data?: any;
  error?: string;
}

interface FlowResult {
  finalize: StepResult;
  redeem: StepResult;
  depositBack: StepResult;
}

/**
 * Schedules and executes proposal finalization when proposals expire.
 * Calls the DAO API to finalize, redeem liquidity, and deposit back.
 */
export class LifecycleService {
  private monitor: Monitor | null = null;
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private sse: SSEManager,
    private listenOnly = false
  ) {}

  /**
   * Subscribe to monitor events and schedule finalization for existing proposals
   */
  start(monitor: Monitor) {
    this.monitor = monitor;

    // Schedule existing proposals (skip in listen-only mode)
    if (!this.listenOnly) {
      for (const proposal of monitor.getMonitored()) {
        this.scheduleFinalization(proposal);
      }
    }

    // Listen for new proposals
    monitor.on('proposal:added', (proposal) => {
      if (!this.listenOnly) {
        this.scheduleFinalization(proposal);
      }
      this.sse.broadcast('PROPOSAL_TRACKED', {
        proposalPda: proposal.proposalPda,
        proposalId: proposal.proposalId,
        name: proposal.name,
        numOptions: proposal.numOptions,
        pools: proposal.pools,
        endTime: proposal.endTime,
        createdAt: proposal.createdAt,
        moderatorPda: proposal.moderatorPda,
        baseMint: proposal.baseMint,
        quoteMint: proposal.quoteMint,
        daoPda: proposal.daoPda,
        spotPool: proposal.spotPool,
        timestamp: Date.now(),
      });
    });

    // Cancel timer if proposal removed early (e.g., finalized by someone else)
    monitor.on('proposal:removed', (proposal) => {
      this.cancelFinalization(proposal.proposalPda);
      this.sse.broadcast('PROPOSAL_REMOVED', {
        proposalPda: proposal.proposalPda,
        proposalId: proposal.proposalId,
        name: proposal.name,
        timestamp: Date.now(),
      });
    });

    console.log(`[Lifecycle] Started${this.listenOnly ? ' (listen-only)' : ''}`);
  }

  stop() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    this.monitor = null;
    console.log('[Lifecycle] Stopped');
  }

  private scheduleFinalization(proposal: MonitoredProposal) {
    const delay = Math.max(0, proposal.endTime - Date.now() + 20000); // 20 second buffer

    const timer = setTimeout(async () => {
      this.timers.delete(proposal.proposalPda);
      await this.runFinalizationFlow(proposal);
    }, delay);

    this.timers.set(proposal.proposalPda, timer);
    console.log(`[Lifecycle] Scheduled finalization for ${proposal.proposalPda} in ${Math.round(delay / 1000)}s`);
  }

  private cancelFinalization(pda: string) {
    const timer = this.timers.get(pda);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(pda);
      console.log(`[Lifecycle] Cancelled finalization for ${pda}`);
    }
  }

  private async runFinalizationFlow(proposal: MonitoredProposal) {
    const { proposalPda } = proposal;
    console.log(`[Lifecycle] Starting finalization flow for ${proposalPda}`);

    const results: FlowResult = {
      finalize: { success: false },
      redeem: { success: false },
      depositBack: { success: false },
    };

    // Step 1: Finalize proposal (continue regardless of result)
    try {
      const data = (await callApi('/dao/finalize-proposal', { proposal_pda: proposalPda })) as {
        winning_option: string;
      };
      results.finalize = { success: true, data };
      console.log(`[Lifecycle] Finalized ${proposalPda} (winner: ${data.winning_option})`);
    } catch (e) {
      results.finalize = { success: false, error: String(e) };
      console.error(`[Lifecycle] Finalize failed for ${proposalPda}:`, e);
    }

    // Step 2: Redeem liquidity (continue regardless of result)
    try {
      const data = (await callApi('/dao/redeem-liquidity', { proposal_pda: proposalPda })) as {
        transaction: string;
      };
      results.redeem = { success: true, data };
      console.log(`[Lifecycle] Redeemed ${proposalPda} (tx: ${data.transaction})`);
    } catch (e) {
      results.redeem = { success: false, error: String(e) };
      console.error(`[Lifecycle] Redeem failed for ${proposalPda}:`, e);
    }

    // Step 3: Deposit back (continue regardless of result)
    try {
      const data = (await callApi('/dao/deposit-back', { proposal_pda: proposalPda })) as {
        skipped?: boolean;
        reason?: string;
      };
      results.depositBack = { success: true, data };
      if (data.skipped) {
        console.log(`[Lifecycle] Deposit-back skipped for ${proposalPda} (${data.reason})`);
      } else {
        console.log(`[Lifecycle] Deposit-back complete for ${proposalPda}`);
      }
    } catch (e) {
      results.depositBack = { success: false, error: String(e) };
      console.error(`[Lifecycle] Deposit-back failed for ${proposalPda}:`, e);
    }

    // Log errors if any step failed
    const hasErrors = !results.finalize.success || !results.redeem.success || !results.depositBack.success;
    if (hasErrors) {
      logError('lifecycle', {
        name: proposal.name,
        proposalPda: proposal.proposalPda,
        proposalId: proposal.proposalId,
        moderatorPda: proposal.moderatorPda,
        results,
      });

      // Remove proposal from monitor on error (stops TWAP cranking, price tracking, etc.)
      // On success, the on-chain ProposalFinalized event will trigger removal automatically
      this.monitor?.removeMonitored(proposalPda);
    }

    console.log(`[Lifecycle] Flow ${hasErrors ? 'completed with errors' : 'complete'} for ${proposalPda}`);
  }
}
