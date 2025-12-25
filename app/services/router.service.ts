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

import { Moderator } from '../moderator';
import { IModeratorConfig, ProposalStatus } from '../types/moderator.interface';
import { IRouterService } from '../types/router.interface';
import { PublicKey, Keypair } from '@solana/web3.js';
import { PersistenceService } from './persistence.service';
import { SchedulerService } from './scheduler.service';
import { LoggerService } from './logger.service';
import { getPool } from '../utils/database';

import bs58 from 'bs58';
import { POOL_CONFIG } from '../../src/config/pools';

/**
 * Load per-pool manager keypairs from base58 private key environment variables
 *
 * Environment variable pattern:
 * - MANAGER_PRIVATE_KEY_ZC - Base58-encoded private key for ZC pool manager
 * - MANAGER_PRIVATE_KEY_OOGWAY - Base58-encoded private key for oogway pool manager
 * - MANAGER_PRIVATE_KEY_SURF - Base58-encoded private key for SURF pool manager
 *
 * The manager wallet:
 * - Receives withdrawn DAMM liquidity (same as MANAGER_WALLET_* in zcombinator)
 * - Is the mint authority for conditional tokens (pass/fail)
 * - Signs vault operations in percent
 *
 * @param logger - Logger instance for logging
 * @returns Map of pool addresses to manager keypairs, or undefined if none configured
 */
export function loadPoolAuthorities(logger: LoggerService): Map<string, Keypair> | undefined {
  const poolAuthorities = new Map<string, Keypair>();

  for (const [ticker, poolAddress] of Object.entries(POOL_CONFIG.tickerToPool)) {
    const envVarName = `MANAGER_PRIVATE_KEY_${ticker}`;
    const privateKeyBase58 = process.env[envVarName];

    if (privateKeyBase58) {
      try {
        const secretKey = bs58.decode(privateKeyBase58);
        const keypair = Keypair.fromSecretKey(secretKey);
        poolAuthorities.set(poolAddress, keypair);
        logger.info(`Loaded manager keypair for ${ticker}`, {
          poolAddress,
          manager: keypair.publicKey.toBase58(),
        });
      } catch (error) {
        logger.warn(`Failed to load manager keypair for ${ticker}`, {
          envVarName,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  // Return undefined if no pool authorities were loaded
  return poolAuthorities.size > 0 ? poolAuthorities : undefined;
}

/**
 * RouterService manages multiple moderators by ID
 * This is the main service that handles all moderator operations
 */
export class RouterService implements IRouterService {
  private static instance: RouterService | null = null;
  public moderators: Map<number, Moderator> = new Map();
  private logger: LoggerService;

  private constructor() {
    this.logger = new LoggerService('router');
  }

  /**
   * Get singleton instance of RouterService
   */
  public static getInstance(): RouterService {
    if (!RouterService.instance) {
      RouterService.instance = new RouterService();
    }
    return RouterService.instance;
  }

  /**
   * Load all moderators from the database
   */
  public async loadModerators(): Promise<void> {
    const pool = getPool();

    try {
      this.logger.info('Loading moderators from database...');

      // Query for all moderator IDs
      const result = await pool.query<{ id: number }>('SELECT id FROM qm_moderators');

      // Load each moderator
      for (const row of result.rows) {
        const moderatorId = row.id;

        try {
          const loaded = await this.loadModeratorFromDB(moderatorId);
          if (loaded) {
            this.logger.info(`Loaded moderator ${moderatorId} successfully`);
          }
        } catch (error) {
          this.logger.error(`Failed to load moderator ${moderatorId}:`, error);
        }
      }

      this.logger.info(`Loaded ${this.moderators.size} moderator(s)`);
    } catch (error) {
      this.logger.error('Failed to load moderators:', error);
      throw error;
    }
  }

  /**
   * Load a specific moderator from the database
   * @param moderatorId - The ID of the moderator to load
   * @returns true if successful, false otherwise
   */
  private async loadModeratorFromDB(moderatorId: number): Promise<boolean> {
    const persistenceService = new PersistenceService(moderatorId, this.logger.createChild('persistence'));
    const savedState = await persistenceService.loadModeratorState();

    if (savedState) {
      this.logger.info(`Using saved moderator state for moderator ${moderatorId} with proposal counter:`, savedState.proposalCounter);

      // Load pool-specific authorities from environment variables
      // Note: Pool authorities are loaded from env vars, not from database, for security
      const poolAuthorities = loadPoolAuthorities(this.logger);

      // Update config with pool authorities from environment
      const config: IModeratorConfig = {
        ...savedState.config,
        poolAuthorities: poolAuthorities
      };

      const moderator = new Moderator(moderatorId, savedState.protocolName, config);
      this.moderators.set(moderatorId, moderator);
      return true;
    } else {
      this.logger.error(`No moderator state found for moderator ${moderatorId}`);
      return false;
    }
  }

  /**
   * Create a new moderator
   * @param baseMint - The base token mint address
   * @param quoteMint - The quote token mint address
   * @param baseDecimals - Decimals for base token
   * @param quoteDecimals - Decimals for quote token
   * @param authority - Authority keypair
   * @param protocolName - Optional protocol name
   * @param dammWithdrawalPercentage - Optional DAMM withdrawal percentage (0-50)
   * @returns The newly created moderator and its ID
   */
  public async createModerator(
    baseMint: PublicKey,
    quoteMint: PublicKey,
    baseDecimals: number,
    quoteDecimals: number,
    authority: Keypair,
    protocolName?: string,
    dammWithdrawalPercentage?: number
  ): Promise<{ moderator: Moderator; id: number }> {
    const pool = getPool();

    try {
      // Get the next available ID from qm_moderators table
      const idResult = await pool.query<{ max: number }>(
        'SELECT COALESCE(MAX(id), 0) as max FROM qm_moderators'
      );
      const nextId = (idResult.rows[0]?.max || 0) + 1;

      this.logger.info(`Creating new moderator with ID ${nextId}`);

      // Load pool-specific authorities from environment variables
      const poolAuthorities = loadPoolAuthorities(this.logger);

      // Create config
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://bernie-zo3q7f-fast-mainnet.helius-rpc.com';
      const config: IModeratorConfig = {
        baseMint,
        quoteMint,
        baseDecimals,
        quoteDecimals,
        defaultAuthority: authority,
        poolAuthorities: poolAuthorities,
        rpcEndpoint: rpcUrl,
        dammWithdrawalPercentage,
      };

      // Create moderator instance
      const moderator = new Moderator(nextId, protocolName, config);

      // Save initial state to database (start with proposal counter at 0)
      await moderator.persistenceService.saveModeratorState(0, config, protocolName);

      // Add to our map
      this.moderators.set(nextId, moderator);

      this.logger.info(`Created new moderator with ID ${nextId}`, {
        protocolName,
        baseMint: baseMint.toBase58(),
        quoteMint: quoteMint.toBase58()
      });

      return { moderator, id: nextId };
    } catch (error) {
      this.logger.error('Failed to create moderator:', error);
      throw error;
    }
  }

  /**
   * Recovers pending proposals after server restart for all moderators
   * Finalizes overdue proposals and reschedules tasks for active ones
   */
  public async recoverPendingProposals(): Promise<void> {
    this.logger.info('Starting recovery of pending proposals for all moderators...');

    for (const [_, moderator] of this.moderators) {
      try {
        await this.recoverModeratorProposals(moderator);
      } catch (error) {
        this.logger.error(`Failed to recover proposals for moderator ${moderator.id}:`, error);
        // Continue with other moderators even if one fails
      }
    }

    this.logger.info('Completed recovery of pending proposals');
  }

  /**
   * Recovers pending proposals for a specific moderator
   * @param moderator - The moderator instance
   */
  private async recoverModeratorProposals(moderator: Moderator): Promise<void> {
    const moderatorId = moderator.id;
    const scheduler = SchedulerService.getInstance();
    const persistenceService = new PersistenceService(moderatorId, this.logger.createChild('persistence'));

    try {
      this.logger.info(`Recovering pending proposals for moderator ${moderatorId}...`);

      // Load all proposals from database for this moderator
      const proposals = await persistenceService.loadAllProposals();

      let recoveredCount = 0;
      let finalizedCount = 0;
      let rescheduledCount = 0;

      for (const proposal of proposals) {
        const now = Date.now();
        
        let status = proposal.getStatus()
        if (status.status === ProposalStatus.Pending) {
          if (now >= proposal.finalizedAt) {
            // Proposal should have been finalized
            this.logger.info(`Finalizing overdue proposal #${proposal.config.id} for moderator ${moderatorId}`);
            try {
              await moderator.finalizeProposal(proposal.config.id);
              finalizedCount++;
            } catch (error) {
              this.logger.error(`Failed to finalize overdue proposal #${proposal.config.id}:`, error);
            }
          } else {
            // Proposal is still active, reschedule tasks
            this.logger.info(`Rescheduling tasks for active proposal #${proposal.config.id} for moderator ${moderatorId}`);

            // Schedule price recording (every 5 seconds)
            scheduler.schedulePriceRecording(moderatorId, proposal.config.id, 5000);

            // Schedule TWAP cranking (default 1 minute interval)
            scheduler.scheduleTWAPCranking(moderatorId, proposal.config.id, 60000);

            // Schedule spot price recording if spot pool address exists
            if (proposal.config.spotPoolAddress) {
              scheduler.scheduleSpotPriceRecording(moderatorId, proposal.config.id, proposal.config.spotPoolAddress, 60000);
              this.logger.info(`Scheduled spot price recording for proposal #${proposal.config.id}`);
            }

            // Schedule finalization 1 second after the proposal's end time
            scheduler.scheduleProposalFinalization(moderatorId, proposal.config.id, proposal.finalizedAt + 1000);

            rescheduledCount++;
          }
          recoveredCount++;
        }
      }

      if (recoveredCount > 0) {
        this.logger.info(`Recovery complete for moderator ${moderatorId}: ${recoveredCount} pending proposals processed`, {
          finalizedCount,
          rescheduledCount
        });
      } else {
        this.logger.info(`No pending proposals found to recover for moderator ${moderatorId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to recover pending proposals for moderator ${moderatorId}:`, error);
      // Don't throw - allow server to continue even if recovery fails
    }
  }

  /**
   * Get a moderator by ID
   * @param moderatorId - The ID of the moderator
   * @returns The moderator or null if not found
   */
  public getModerator(moderatorId: number): Moderator | null {
    return this.moderators.get(moderatorId) || null;
  }

  /**
   * Get all loaded moderators
   * @returns Map of all moderators keyed by ID
   */
  public getAllModerators(): Map<number, Moderator> {
    return this.moderators;
  }

  /**
   * Refresh the router service by reloading all moderators from database
   * This will clear the current moderators and reload them fresh
   */
  public async refresh(): Promise<void> {
    this.logger.info('Refreshing router service - reloading all moderators...');

    // Clear current moderators
    this.moderators.clear();

    // Reload all moderators
    await this.loadModerators();

    // Recover pending proposals for all loaded moderators
    await this.recoverPendingProposals();

    this.logger.info('Router service refresh complete');
  }
}

export default RouterService;