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

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { futarchy } from '@zcomb/programs-sdk';
import { LoggerService } from './logger.service';
import { HistoryService } from './history.service';
import { Decimal } from 'decimal.js';

/**
 * Configuration for the ProposalListenerService
 */
export interface ProposalListenerConfig {
  /** RPC endpoint URL */
  rpcUrl: string;
  /** Polling interval in milliseconds (default: 30000 = 30 seconds) */
  pollingIntervalMs?: number;
  /** TWAP crank interval in milliseconds (default: 6000 = 6 seconds) */
  twapCrankIntervalMs?: number;
  /** Price recording interval in milliseconds (default: 5000 = 5 seconds) */
  priceRecordIntervalMs?: number;
  /** Moderator refresh interval in milliseconds (default: 300000 = 5 minutes) */
  moderatorRefreshIntervalMs?: number;
  /** zcombinator API URL for redeem-liquidity calls */
  zcombinatorApiUrl: string;
  /** Service wallet for signing permissionless transactions (finalize) */
  serviceWallet: Keypair;
}

/**
 * Tracked proposal state
 */
interface TrackedProposal {
  proposalPda: PublicKey;
  moderatorPda: PublicKey;
  proposalId: number;
  daoId: number;
  createdAt: number;
  endTime: number;
  status: 'pending' | 'resolved';
  poolPdas: PublicKey[];
  twapCrankTimer?: NodeJS.Timeout;
  priceRecordTimer?: NodeJS.Timeout;
  finalizationTimer?: NodeJS.Timeout;
}

/**
 * ProposalListenerService listens for on-chain proposals from registered moderators
 * and handles TWAP cranking, price tracking, and finalization
 *
 * This service is designed for the new on-chain futarchy system where:
 * - Proposals are created via zcombinator API
 * - TWAP cranking and finalization are permissionless
 * - Liquidity redemption requires admin key (handled by zcombinator API)
 */
export class ProposalListenerService {
  private static instance: ProposalListenerService | null = null;

  private config: ProposalListenerConfig;
  private connection: Connection;
  private provider: AnchorProvider;
  private client: futarchy.FutarchyClient;
  private logger: LoggerService;

  /** DAO info for each moderator PDA (fetched from zcombinator) */
  private moderatorDaoMap: Map<string, { daoId: number; daoPda: string; daoName: string }> = new Map();

  /** Map of proposal PDA -> tracked proposal state */
  private trackedProposals: Map<string, TrackedProposal> = new Map();

  /** Polling timer */
  private pollingTimer?: NodeJS.Timeout;

  /** Moderator refresh timer */
  private moderatorRefreshTimer?: NodeJS.Timeout;

  /** Whether the service is running */
  private isRunning: boolean = false;

  private constructor(config: ProposalListenerConfig) {
    this.config = {
      pollingIntervalMs: 30000,
      twapCrankIntervalMs: 6000,
      priceRecordIntervalMs: 5000,
      moderatorRefreshIntervalMs: 300000, // 5 minutes
      ...config,
    };

    this.logger = new LoggerService('proposal-listener');
    this.connection = new Connection(config.rpcUrl, 'confirmed');

    const wallet = new Wallet(config.serviceWallet);
    this.provider = new AnchorProvider(this.connection, wallet, { commitment: 'confirmed' });
    this.client = new futarchy.FutarchyClient(this.provider);
  }

  /**
   * Get singleton instance of ProposalListenerService
   */
  public static getInstance(config?: ProposalListenerConfig): ProposalListenerService {
    if (!ProposalListenerService.instance) {
      if (!config) {
        throw new Error('ProposalListenerService requires config on first initialization');
      }
      ProposalListenerService.instance = new ProposalListenerService(config);
    }
    return ProposalListenerService.instance;
  }

  /**
   * Start the listener service
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn('ProposalListenerService is already running');
      return;
    }

    this.logger.info('Starting ProposalListenerService');
    this.isRunning = true;

    // Fetch initial list of moderators from zcombinator
    await this.refreshTrackedModerators();

    // Start polling for new proposals
    this.pollingTimer = setInterval(async () => {
      await this.pollForProposals();
    }, this.config.pollingIntervalMs);

    // Start periodic moderator refresh (to pick up newly created DAOs)
    this.moderatorRefreshTimer = setInterval(async () => {
      await this.refreshTrackedModerators();
    }, this.config.moderatorRefreshIntervalMs);

    // Do an initial poll
    await this.pollForProposals();

    this.logger.info('ProposalListenerService started', {
      moderatorCount: this.moderatorDaoMap.size,
      pollingIntervalMs: this.config.pollingIntervalMs,
      moderatorRefreshIntervalMs: this.config.moderatorRefreshIntervalMs,
    });
  }

  /**
   * Stop the listener service
   */
  public stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('Stopping ProposalListenerService');

    // Clear polling timer
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }

    // Clear moderator refresh timer
    if (this.moderatorRefreshTimer) {
      clearInterval(this.moderatorRefreshTimer);
      this.moderatorRefreshTimer = undefined;
    }

    // Clear all proposal timers
    for (const proposal of Array.from(this.trackedProposals.values())) {
      this.clearProposalTimers(proposal);
    }

    this.trackedProposals.clear();
    this.isRunning = false;

    this.logger.info('ProposalListenerService stopped');
  }

  /**
   * Fetch list of tracked moderators from zcombinator API
   */
  private async refreshTrackedModerators(): Promise<void> {
    try {
      const response = await fetch(`${this.config.zcombinatorApiUrl}/dao`);

      if (!response.ok) {
        throw new Error(`Failed to fetch DAOs: ${response.statusText}`);
      }

      interface DaoResponse {
        id: number;
        dao_pda: string;
        dao_name: string;
        moderator_pda: string;
      }

      const data = await response.json() as { daos: DaoResponse[] };

      this.moderatorDaoMap.clear();
      for (const dao of data.daos) {
        if (dao.moderator_pda) {
          this.moderatorDaoMap.set(dao.moderator_pda, {
            daoId: dao.id,
            daoPda: dao.dao_pda,
            daoName: dao.dao_name,
          });
        }
      }

      this.logger.info('Refreshed tracked moderators', {
        count: this.moderatorDaoMap.size,
      });
    } catch (error) {
      this.logger.error('Failed to refresh tracked moderators', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Poll for new proposals from tracked moderators
   */
  private async pollForProposals(): Promise<void> {
    try {
      for (const moderatorPdaStr of Array.from(this.moderatorDaoMap.keys())) {
        await this.checkModeratorForProposals(new PublicKey(moderatorPdaStr));
      }
    } catch (error) {
      this.logger.error('Error polling for proposals', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Check a moderator for active proposals
   */
  private async checkModeratorForProposals(moderatorPda: PublicKey): Promise<void> {
    try {
      // Fetch moderator account to get proposal count
      const moderatorAccount = await this.client.fetchModerator(moderatorPda);

      if (!moderatorAccount) {
        this.logger.warn('Moderator account not found', {
          moderatorPda: moderatorPda.toBase58(),
        });
        return;
      }

      const proposalCount = moderatorAccount.proposalIdCounter;

      // Check each proposal
      for (let proposalId = 0; proposalId < proposalCount; proposalId++) {
        const [proposalPda] = this.client.deriveProposalPDA(moderatorPda, proposalId);
        const proposalPdaStr = proposalPda.toBase58();

        // Skip if already tracking
        if (this.trackedProposals.has(proposalPdaStr)) {
          continue;
        }

        // Fetch proposal account
        const proposalAccount = await this.client.fetchProposal(proposalPda);

        if (!proposalAccount) {
          continue;
        }

        // Only track pending proposals
        if (proposalAccount.state.pending) {
          await this.startTrackingProposal(proposalPda, moderatorPda, proposalAccount);
        }
      }
    } catch (error) {
      this.logger.error('Error checking moderator for proposals', {
        moderatorPda: moderatorPda.toBase58(),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Start tracking a proposal
   */
  private async startTrackingProposal(
    proposalPda: PublicKey,
    moderatorPda: PublicKey,
    proposalAccount: any
  ): Promise<void> {
    const proposalPdaStr = proposalPda.toBase58();
    const moderatorPdaStr = moderatorPda.toBase58();

    // Get DAO info for this moderator
    const daoInfo = this.moderatorDaoMap.get(moderatorPdaStr);
    if (!daoInfo) {
      this.logger.warn('Cannot track proposal - moderator not in DAO map', {
        proposalPda: proposalPdaStr,
        moderatorPda: moderatorPdaStr,
      });
      return;
    }

    // Calculate end time from proposal params
    const createdAt = proposalAccount.createdAt.toNumber() * 1000; // Convert to ms
    const durationMs = proposalAccount.params.length * 1000;
    const endTime = createdAt + durationMs;

    const tracked: TrackedProposal = {
      proposalPda,
      moderatorPda,
      proposalId: proposalAccount.id,
      daoId: daoInfo.daoId,
      createdAt,
      endTime,
      status: 'pending',
      poolPdas: [proposalAccount.pool0, proposalAccount.pool1],
    };

    this.trackedProposals.set(proposalPdaStr, tracked);

    this.logger.info('Started tracking proposal', {
      proposalPda: proposalPdaStr,
      moderatorPda: moderatorPdaStr,
      proposalId: proposalAccount.id,
      daoId: daoInfo.daoId,
      daoName: daoInfo.daoName,
      endTime: new Date(endTime).toISOString(),
    });

    // Schedule TWAP cranking
    this.scheduleTwapCranking(tracked);

    // Schedule price recording
    this.schedulePriceRecording(tracked);

    // Schedule finalization
    this.scheduleFinalization(tracked);
  }

  /**
   * Schedule TWAP cranking for a proposal
   */
  private scheduleTwapCranking(proposal: TrackedProposal): void {
    const proposalPdaStr = proposal.proposalPda.toBase58();

    proposal.twapCrankTimer = setInterval(async () => {
      // Check if proposal has ended
      if (Date.now() >= proposal.endTime) {
        this.logger.info('Proposal ended, stopping TWAP cranking', {
          proposalPda: proposalPdaStr,
        });
        if (proposal.twapCrankTimer) {
          clearInterval(proposal.twapCrankTimer);
          proposal.twapCrankTimer = undefined;
        }
        return;
      }

      await this.crankTwap(proposal);
    }, this.config.twapCrankIntervalMs);

    this.logger.info('Scheduled TWAP cranking', {
      proposalPda: proposalPdaStr,
      intervalMs: this.config.twapCrankIntervalMs,
    });
  }

  /**
   * Crank TWAP for all pools in a proposal
   */
  private async crankTwap(proposal: TrackedProposal): Promise<void> {
    const proposalPdaStr = proposal.proposalPda.toBase58();

    try {
      for (const poolPda of proposal.poolPdas) {
        const builder = await this.client.amm.crankTwap(poolPda);
        await builder.rpc();
      }

      this.logger.debug('TWAP cranked', {
        proposalPda: proposalPdaStr,
        poolCount: proposal.poolPdas.length,
      });
    } catch (error) {
      this.logger.error('Failed to crank TWAP', {
        proposalPda: proposalPdaStr,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Schedule price recording for a proposal
   */
  private schedulePriceRecording(proposal: TrackedProposal): void {
    const proposalPdaStr = proposal.proposalPda.toBase58();

    proposal.priceRecordTimer = setInterval(async () => {
      // Check if proposal has ended
      if (Date.now() >= proposal.endTime) {
        this.logger.info('Proposal ended, stopping price recording', {
          proposalPda: proposalPdaStr,
        });
        if (proposal.priceRecordTimer) {
          clearInterval(proposal.priceRecordTimer);
          proposal.priceRecordTimer = undefined;
        }
        return;
      }

      await this.recordPrices(proposal);
    }, this.config.priceRecordIntervalMs);

    this.logger.info('Scheduled price recording', {
      proposalPda: proposalPdaStr,
      intervalMs: this.config.priceRecordIntervalMs,
    });
  }

  /**
   * Record prices and TWAP for all pools in a proposal
   */
  private async recordPrices(proposal: TrackedProposal): Promise<void> {
    const proposalPdaStr = proposal.proposalPda.toBase58();

    try {
      const spotPrices: Decimal[] = [];
      const twapValues: Decimal[] = [];
      const aggregations: Decimal[] = [];

      for (let i = 0; i < proposal.poolPdas.length; i++) {
        const poolPda = proposal.poolPdas[i];

        // Fetch spot price from AMM
        const spotPrice = await this.client.amm.fetchSpotPrice(poolPda);

        if (spotPrice) {
          // Convert BN to decimal price
          const price = spotPrice.toNumber();
          spotPrices.push(new Decimal(price));

          // Record spot price to history (cmb_ tables for futarchy)
          await HistoryService.recordCmbPrice({
            daoId: proposal.daoId,
            proposalId: proposal.proposalId,
            market: i,
            price: new Decimal(price),
          });
        }

        // Fetch TWAP value from AMM
        const twap = await this.client.amm.fetchTwap(poolPda);
        if (twap !== null) {
          twapValues.push(new Decimal(twap.toNumber()));
        } else {
          // If TWAP is null (warmup period), use 0
          twapValues.push(new Decimal(0));
        }

        // Fetch pool to get cumulative observations (aggregation data)
        try {
          const poolAccount = await this.client.amm.fetchPool(poolPda);
          if (poolAccount && poolAccount.oracle) {
            // cumulativeObservations is a BN representing the sum of (observation * time_elapsed)
            const aggValue = poolAccount.oracle.cumulativeObservations?.toString() || '0';
            aggregations.push(new Decimal(aggValue));
          } else {
            aggregations.push(new Decimal(0));
          }
        } catch {
          aggregations.push(new Decimal(0));
        }
      }

      // Record TWAP history if we have values (cmb_ tables for futarchy)
      if (twapValues.length > 0) {
        await HistoryService.recordCmbTWAP({
          daoId: proposal.daoId,
          proposalId: proposal.proposalId,
          twaps: twapValues,
          aggregations,
        });
      }

      this.logger.debug('Recorded prices and TWAP', {
        proposalPda: proposalPdaStr,
        poolCount: proposal.poolPdas.length,
        daoId: proposal.daoId,
        twapValues: twapValues.map(t => t.toString()),
      });
    } catch (error) {
      this.logger.error('Failed to record prices', {
        proposalPda: proposalPdaStr,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Schedule finalization for a proposal
   */
  private scheduleFinalization(proposal: TrackedProposal): void {
    const proposalPdaStr = proposal.proposalPda.toBase58();
    const delayMs = proposal.endTime - Date.now() + 1000; // 1 second buffer

    if (delayMs <= 0) {
      // Should finalize immediately
      this.finalizeProposal(proposal);
      return;
    }

    proposal.finalizationTimer = setTimeout(async () => {
      await this.finalizeProposal(proposal);
    }, delayMs);

    this.logger.info('Scheduled finalization', {
      proposalPda: proposalPdaStr,
      endTime: new Date(proposal.endTime).toISOString(),
      delayMs,
    });
  }

  /**
   * Finalize a proposal via zcombinator API endpoints
   * Flow (from CLIENT_README.md):
   * 1. Call zcombinator /dao/finalize-proposal (reads TWAP, determines winner)
   * 2. Call zcombinator /dao/redeem-liquidity (redeems liquidity from resolved proposal)
   * 3. Call zcombinator /dao/deposit-back (returns liquidity to Meteora pool)
   */
  private async finalizeProposal(proposal: TrackedProposal): Promise<void> {
    const proposalPdaStr = proposal.proposalPda.toBase58();

    this.logger.info('Finalizing proposal', {
      proposalPda: proposalPdaStr,
    });

    try {
      // Step 1: Call zcombinator /dao/finalize-proposal endpoint
      // This reads final TWAP values and determines the winning outcome
      this.logger.info('Calling zcombinator finalize-proposal', { proposalPda: proposalPdaStr });

      const finalizeResponse = await fetch(
        `${this.config.zcombinatorApiUrl}/dao/finalize-proposal`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposal_pda: proposalPdaStr }),
        }
      );

      if (!finalizeResponse.ok) {
        const error = await finalizeResponse.json().catch(() => ({}));
        throw new Error(
          `finalize-proposal failed: ${(error as any).error || finalizeResponse.statusText}`
        );
      }

      const finalizeResult = await finalizeResponse.json();

      this.logger.info('Finalize proposal succeeded', {
        proposalPda: proposalPdaStr,
        finalizeResult,
      });

      // Step 2: Call zcombinator /dao/redeem-liquidity endpoint
      this.logger.info('Calling zcombinator redeem-liquidity', { proposalPda: proposalPdaStr });

      const redeemResponse = await fetch(
        `${this.config.zcombinatorApiUrl}/dao/redeem-liquidity`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposal_pda: proposalPdaStr }),
        }
      );

      if (!redeemResponse.ok) {
        const error = await redeemResponse.json().catch(() => ({}));
        throw new Error(
          `redeem-liquidity failed: ${(error as any).error || redeemResponse.statusText}`
        );
      }

      const redeemResult = await redeemResponse.json();

      this.logger.info('Redeem liquidity succeeded', {
        proposalPda: proposalPdaStr,
        redeemResult,
      });

      // Step 3: Call zcombinator /dao/deposit-back endpoint
      this.logger.info('Calling zcombinator deposit-back', { proposalPda: proposalPdaStr });

      const depositBackResponse = await fetch(
        `${this.config.zcombinatorApiUrl}/dao/deposit-back`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ proposal_pda: proposalPdaStr }),
        }
      );

      if (!depositBackResponse.ok) {
        const error = await depositBackResponse.json().catch(() => ({}));
        // Log but don't fail - deposit-back is best-effort
        this.logger.warn('deposit-back failed', {
          proposalPda: proposalPdaStr,
          error: (error as any).error || depositBackResponse.statusText,
        });
      } else {
        const depositBackResult = await depositBackResponse.json();
        this.logger.info('Deposit-back completed', {
          proposalPda: proposalPdaStr,
          depositBackResult,
        });
      }

      this.logger.info('Proposal finalization complete', {
        proposalPda: proposalPdaStr,
      });

      // Update tracked proposal status
      proposal.status = 'resolved';

      // Clear all timers
      this.clearProposalTimers(proposal);

    } catch (error) {
      this.logger.error('Failed to finalize proposal', {
        proposalPda: proposalPdaStr,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Clear all timers for a proposal
   */
  private clearProposalTimers(proposal: TrackedProposal): void {
    if (proposal.twapCrankTimer) {
      clearInterval(proposal.twapCrankTimer);
      proposal.twapCrankTimer = undefined;
    }
    if (proposal.priceRecordTimer) {
      clearInterval(proposal.priceRecordTimer);
      proposal.priceRecordTimer = undefined;
    }
    if (proposal.finalizationTimer) {
      clearTimeout(proposal.finalizationTimer);
      proposal.finalizationTimer = undefined;
    }
  }

  /**
   * Get list of tracked proposals
   */
  public getTrackedProposals(): Array<{
    proposalPda: string;
    moderatorPda: string;
    proposalId: number;
    daoId: number;
    status: string;
    endTime: number;
  }> {
    return Array.from(this.trackedProposals.values()).map((p) => ({
      proposalPda: p.proposalPda.toBase58(),
      moderatorPda: p.moderatorPda.toBase58(),
      proposalId: p.proposalId,
      daoId: p.daoId,
      status: p.status,
      endTime: p.endTime,
    }));
  }

  /**
   * Get list of tracked moderators with their DAO info
   */
  public getTrackedModerators(): Array<{
    moderatorPda: string;
    daoId: number;
    daoPda: string;
    daoName: string;
  }> {
    return Array.from(this.moderatorDaoMap.entries()).map(([moderatorPda, daoInfo]) => ({
      moderatorPda,
      daoId: daoInfo.daoId,
      daoPda: daoInfo.daoPda,
      daoName: daoInfo.daoName,
    }));
  }
}

export default ProposalListenerService;
