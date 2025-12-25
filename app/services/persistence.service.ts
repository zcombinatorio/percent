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

import { getPool } from '../utils/database';
import { IPersistenceService, IProposalDB, IModeratorStateDB } from '../types/persistence.interface';
import { IProposal, IProposalSerializedData } from '../types/proposal.interface';
import { IModeratorConfig } from '../types/moderator.interface';
import { Proposal } from '../proposal';
import { PublicKey } from '@solana/web3.js';
import { Pool } from 'pg';
import { ExecutionService } from './execution.service';
import { LoggerService } from './logger.service';
import { Commitment } from '@app/types/execution.interface';
import { decryptKeypair, encryptKeypair } from '../utils/crypto';
import { loadPoolAuthorities } from './router.service';

/**
 * Service for persisting and loading state from PostgreSQL database
 */
export class PersistenceService implements IPersistenceService {
  private pool: Pool;
  private moderatorId: number;
  private logger: LoggerService;

  constructor(moderatorId: number, logger: LoggerService) {
    this.pool = getPool();
    this.moderatorId = moderatorId;
    this.logger = logger;
  }

  /**
   * Get the current proposal ID counter
   * @returns The current proposal ID counter
   */
  async getProposalIdCounter(): Promise<number> {
    try {
      const result = await this.pool.query<{ proposal_id_counter: number }>(
        'SELECT proposal_id_counter FROM qm_moderators WHERE id = $1',
        [this.moderatorId]
      );

      if (result.rows.length === 0) {
        // No moderator state found, return 1 as the starting counter
        return 0;
      }

      // Return the counter + 1 for the next proposal ID
      return result.rows[0].proposal_id_counter;
    } catch (error) {
      this.logger.error('Failed to fetch proposal ID counter', {
        moderatorId: this.moderatorId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Save a proposal to the database (backward compatible)
   * @param proposal - The proposal to save
   * @returns A promise that resolves when the proposal is saved
   */
  async saveProposal(proposal: IProposal): Promise<void> {
    try {
      // Use the proposal's serialize method
      const serializedData = proposal.serialize();

      // Use qm_proposals table (id is auto-generated, not inserted)
      const query = `
        INSERT INTO qm_proposals (
          moderator_id, proposal_id, title, description, status,
          created_at, finalized_at, proposal_length,
          base_mint, quote_mint, base_decimals, quote_decimals,
          markets, market_labels,
          amm_config, twap_config,
          amm_data,
          twap_oracle_data,
          spot_pool_address, total_supply
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        ON CONFLICT (moderator_id, proposal_id) DO UPDATE SET
          status = EXCLUDED.status,
          amm_data = EXCLUDED.amm_data,
          twap_oracle_data = EXCLUDED.twap_oracle_data,
          twap_config = EXCLUDED.twap_config,
          updated_at = NOW()
      `;

      await this.pool.query(query, [
        serializedData.moderatorId,
        serializedData.id,  // This is the proposal_id (per-moderator sequential ID)
        serializedData.title,
        serializedData.description || null,
        serializedData.status,
        new Date(serializedData.createdAt),
        new Date(serializedData.finalizedAt),
        serializedData.proposalLength,
        serializedData.baseMint,
        serializedData.quoteMint,
        serializedData.baseDecimals,
        serializedData.quoteDecimals,
        serializedData.markets,
        serializedData.market_labels,
        JSON.stringify(serializedData.ammConfig),
        JSON.stringify(serializedData.twapConfig || {}),
        JSON.stringify(serializedData.AMMData),
        JSON.stringify(serializedData.twapOracleData),
        serializedData.spotPoolAddress || null,
        serializedData.totalSupply
      ]);
    } catch (error) {
      this.logger.error('Failed to save proposal', {
        proposalId: proposal.config.id,
        moderatorId: this.moderatorId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Load a proposal from the database by proposal_id
   * @param proposalId - The proposal ID
   * @returns The proposal or null if not found
   */
  async loadProposal(proposalId: number): Promise<IProposal | null> {
    try {
      const result = await this.pool.query<IProposalDB>(
        'SELECT * FROM qm_proposals WHERE moderator_id = $1 AND proposal_id = $2',
        [this.moderatorId, proposalId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return this.deserializeProposal(row);
    } catch (error) {
      this.logger.error('Failed to load proposal', {
        proposalId,
        moderatorId: this.moderatorId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Load all proposals from the database
   * @returns An array of proposals
   */
  async loadAllProposals(): Promise<IProposal[]> {
    try {
      const result = await this.pool.query<IProposalDB>(
        'SELECT * FROM qm_proposals WHERE moderator_id = $1 ORDER BY id',
        [this.moderatorId]
      );

      const proposals: IProposal[] = [];
      for (const row of result.rows) {
        const proposal = await this.deserializeProposal(row);
        if (proposal) {
          proposals.push(proposal);
        }
      }

      return proposals;
    } catch (error) {
      this.logger.error('Failed to load proposals', {
        moderatorId: this.moderatorId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Save moderator state to the database
   * @param proposalCounter - The proposal counter
   * @param config - The moderator config
   * @param protocolName - The protocol name
   * @returns A promise that resolves when the moderator state is saved
   */
  async saveModeratorState(proposalCounter: number, config: IModeratorConfig, protocolName?: string): Promise<void> {
    try {
      const encryptionKey = process.env.ENCRYPTION_KEY;
      if (!encryptionKey) {
        throw new Error('ENCRYPTION_KEY environment variable is not set');
      }

      const configData = {
        baseMint: config.baseMint.toBase58(),
        quoteMint: config.quoteMint.toBase58(),
        baseDecimals: config.baseDecimals,
        quoteDecimals: config.quoteDecimals,
        defaultAuthority: encryptKeypair(config.defaultAuthority, encryptionKey),
        rpcUrl: config.rpcEndpoint,
        dammWithdrawalPercentage: config.dammWithdrawalPercentage,
      };

      const query = `
        INSERT INTO qm_moderators (id, proposal_id_counter, config, protocol_name)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET
          proposal_id_counter = EXCLUDED.proposal_id_counter,
          config = EXCLUDED.config,
          protocol_name = EXCLUDED.protocol_name,
          updated_at = NOW()
      `;

      await this.pool.query(query, [this.moderatorId, proposalCounter, JSON.stringify(configData), protocolName || null]);
    } catch (error) {
      this.logger.error('Failed to save moderator state', {
        proposalCounter,
        moderatorId: this.moderatorId,
        protocolName,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Load moderator state from the database
   * @returns The moderator state or null if not found
   */
  async loadModeratorState(): Promise<{ proposalCounter: number; config: IModeratorConfig; protocolName?: string } | null> {
    try {
      const result = await this.pool.query<IModeratorStateDB>(
        'SELECT * FROM qm_moderators WHERE id = $1',
        [this.moderatorId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      const encryptionKey = process.env.ENCRYPTION_KEY;
      if (!encryptionKey) {
        throw new Error('ENCRYPTION_KEY environment variable is not set');
      }

      // Support both old 'authority' and new 'defaultAuthority' for smooth migration
      const configData = row.config as any;
      const authorityData = configData.defaultAuthority || configData.authority;

      // Load pool authorities from environment variables
      const poolAuthorities = loadPoolAuthorities(this.logger);

      const config: IModeratorConfig = {
        baseMint: new PublicKey(row.config.baseMint),
        quoteMint: new PublicKey(row.config.quoteMint),
        baseDecimals: row.config.baseDecimals,
        quoteDecimals: row.config.quoteDecimals,
        defaultAuthority: decryptKeypair(authorityData, encryptionKey),
        rpcEndpoint: row.config.rpcUrl,
        dammWithdrawalPercentage: row.config.dammWithdrawalPercentage,
        poolAuthorities,
      };

      return {
        proposalCounter: row.proposal_id_counter,
        config,
        protocolName: row.protocol_name || undefined,
      };
    } catch (error) {
      this.logger.error('Failed to load moderator state', {
        moderatorId: this.moderatorId,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Helper method to deserialize a Proposal object from database row
   * @param row - The database row
   * @returns The proposal or null if not found
   */
  private async deserializeProposal(row: IProposalDB): Promise<IProposal | null> {
    try {
      // Load authority keypair - use appropriate authority based on pool
      const moderatorState = await this.loadModeratorState();
      if (!moderatorState) {
        throw new Error('Moderator state not found');
      }

      // Get authority from environment variable - no fallback to database
      if (!row.spot_pool_address) {
        throw new Error(`Proposal ${row.proposal_id} has no spot_pool_address - cannot determine authority`);
      }

      if (!moderatorState.config.poolAuthorities) {
        throw new Error(
          `No pool authorities configured. Set MANAGER_PRIVATE_KEY_<TICKER> environment variable for pool ${row.spot_pool_address}`
        );
      }

      const authority = moderatorState.config.poolAuthorities.get(row.spot_pool_address);
      if (!authority) {
        throw new Error(
          `No authority configured for pool ${row.spot_pool_address}. Set MANAGER_PRIVATE_KEY_<TICKER> environment variable`
        );
      }

      // Create logger first
      const logger = new LoggerService(`moderator-${row.moderator_id}`).createChild(`proposal-${row.proposal_id}`);

      // Create execution service with logger
      const executionService = new ExecutionService({
        rpcEndpoint: moderatorState.config.rpcEndpoint,
        commitment: Commitment.Confirmed,
        maxRetries: 3,
        skipPreflight: false
      }, logger);

      // Parse the serialized data from the database
      const serializedData: IProposalSerializedData = {
        id: row.proposal_id,
        moderatorId: row.moderator_id,
        title: row.title || '',
        description: row.description || undefined,
        createdAt: new Date(row.created_at).getTime(),
        proposalLength: parseInt(row.proposal_length),
        finalizedAt: new Date(row.finalized_at).getTime(),
        status: row.status,

        baseMint: row.base_mint,
        quoteMint: row.quote_mint,
        baseDecimals: row.base_decimals,
        quoteDecimals: row.quote_decimals,

        markets: row.markets,
        market_labels: row.market_labels,

        ammConfig: typeof row.amm_config === 'string'
          ? JSON.parse(row.amm_config)
          : row.amm_config,

        twapConfig: typeof row.twap_config === 'string'
          ? JSON.parse(row.twap_config)
          : row.twap_config,

        spotPoolAddress: row.spot_pool_address || undefined,
        totalSupply: row.total_supply || 1000000000,

        AMMData: typeof row.amm_data === 'string'
          ? JSON.parse(row.amm_data)
          : row.amm_data,
        twapOracleData: typeof row.twap_oracle_data === 'string'
          ? JSON.parse(row.twap_oracle_data)
          : row.twap_oracle_data,
      };

      // Use the Proposal.deserialize method
      const proposal = await Proposal.deserialize(serializedData, {
        authority,
        executionService,
        logger
      });

      return proposal;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to deserialize proposal #${row.proposal_id}`, {
        proposalId: row.id,
        moderatorId: this.moderatorId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined
      });
      throw new Error(`Failed to deserialize proposal #${row.proposal_id}: ${errorMessage}`);
    }
  }

  /**
   * Store withdrawal metadata for a proposal
   * @param proposalId - The proposal ID
   * @param requestId - DAMM withdrawal request ID
   * @param signature - Solana transaction signature
   * @param percentage - Withdrawal percentage (0-15)
   * @param tokenA - Base token amount withdrawn
   * @param tokenB - Quote token amount withdrawn
   * @param spotPrice - Spot price at withdrawal time
   * @param poolAddress - DAMM pool address used for withdrawal
   */
  async storeWithdrawalMetadata(
    proposalId: number,
    requestId: string,
    signature: string,
    percentage: number,
    tokenA: string,
    tokenB: string,
    spotPrice: number,
    poolAddress: string
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO qm_proposal_withdrawals (
          moderator_id, proposal_id,
          withdrawal_request_id, withdrawal_signature,
          withdrawal_percentage, withdrawn_token_a, withdrawn_token_b,
          spot_price, needs_deposit_back, pool_address
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (moderator_id, proposal_id) DO UPDATE SET
          withdrawal_request_id = EXCLUDED.withdrawal_request_id,
          withdrawal_signature = EXCLUDED.withdrawal_signature,
          withdrawal_percentage = EXCLUDED.withdrawal_percentage,
          withdrawn_token_a = EXCLUDED.withdrawn_token_a,
          withdrawn_token_b = EXCLUDED.withdrawn_token_b,
          spot_price = EXCLUDED.spot_price,
          pool_address = EXCLUDED.pool_address,
          updated_at = NOW()
      `;

      await this.pool.query(query, [
        this.moderatorId,
        proposalId,
        requestId,
        signature,
        percentage,
        tokenA,
        tokenB,
        spotPrice,
        true, // needs_deposit_back
        poolAddress
      ]);

      // Update proposal to mark it has a withdrawal
      await this.pool.query(
        `UPDATE qm_proposals
         SET has_withdrawal = true, updated_at = NOW()
         WHERE moderator_id = $1 AND proposal_id = $2`,
        [this.moderatorId, proposalId]
      );

      this.logger.info('Stored withdrawal metadata', {
        moderatorId: this.moderatorId,
        proposalId,
        percentage
      });
    } catch (error) {
      this.logger.error('Failed to store withdrawal metadata', {
        moderatorId: this.moderatorId,
        proposalId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get withdrawal metadata for a proposal
   * @param proposalId - The proposal ID
   * @returns Withdrawal metadata or null if not found
   */
  async getWithdrawalMetadata(proposalId: number): Promise<{
    requestId: string;
    signature: string;
    percentage: number;
    tokenA: number;
    tokenB: number;
    spotPrice: number;
    needsDepositBack: boolean;
    depositSignature: string | null;
    depositedAt: Date | null;
    poolAddress: string;
  } | null> {
    try {
      const result = await this.pool.query(
        `SELECT
          withdrawal_request_id, withdrawal_signature,
          withdrawal_percentage, withdrawn_token_a, withdrawn_token_b,
          spot_price, needs_deposit_back, deposit_signature, deposited_at,
          pool_address
         FROM qm_proposal_withdrawals
         WHERE moderator_id = $1 AND proposal_id = $2`,
        [this.moderatorId, proposalId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        requestId: row.withdrawal_request_id,
        signature: row.withdrawal_signature,
        percentage: row.withdrawal_percentage,
        tokenA: parseFloat(row.withdrawn_token_a),
        tokenB: parseFloat(row.withdrawn_token_b),
        spotPrice: parseFloat(row.spot_price),
        needsDepositBack: row.needs_deposit_back,
        depositSignature: row.deposit_signature,
        depositedAt: row.deposited_at ? new Date(row.deposited_at) : null,
        poolAddress: row.pool_address
      };
    } catch (error) {
      this.logger.error('Failed to get withdrawal metadata', {
        moderatorId: this.moderatorId,
        proposalId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Mark withdrawal as deposited back
   * @param proposalId - The proposal ID
   * @param depositSignature - Solana transaction signature for deposit
   * @param depositedTokenA - Actual token A amount deposited (raw units)
   * @param depositedTokenB - Actual token B amount deposited (raw units)
   */
  async markWithdrawalDeposited(
    proposalId: number,
    depositSignature: string,
    depositedTokenA?: string,
    depositedTokenB?: string
  ): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE qm_proposal_withdrawals
         SET needs_deposit_back = false,
             deposit_signature = $1,
             deposited_token_a = $2,
             deposited_token_b = $3,
             deposited_at = NOW(),
             updated_at = NOW()
         WHERE moderator_id = $4 AND proposal_id = $5`,
        [depositSignature, depositedTokenA, depositedTokenB, this.moderatorId, proposalId]
      );

      this.logger.info('Marked withdrawal as deposited', {
        moderatorId: this.moderatorId,
        proposalId,
        depositSignature,
        depositedTokenA,
        depositedTokenB
      });
    } catch (error) {
      this.logger.error('Failed to mark withdrawal as deposited', {
        moderatorId: this.moderatorId,
        proposalId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}