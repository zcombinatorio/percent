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
        'SELECT proposal_id_counter FROM i_moderators WHERE id = $1',
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

      // Use new i_proposals table (id is auto-generated, not inserted)
      const query = `
        INSERT INTO i_proposals (
          moderator_id, proposal_id, title, description, status,
          created_at, finalized_at, proposal_length,
          transaction_instructions, transaction_fee_payer,
          base_mint, quote_mint, base_decimals, quote_decimals,
          amm_config, twap_config,
          pass_amm_data, fail_amm_data,
          base_vault_data, quote_vault_data,
          twap_oracle_data,
          spot_pool_address, total_supply
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
        ON CONFLICT (moderator_id, proposal_id) DO UPDATE SET
          status = EXCLUDED.status,
          pass_amm_data = EXCLUDED.pass_amm_data,
          fail_amm_data = EXCLUDED.fail_amm_data,
          base_vault_data = EXCLUDED.base_vault_data,
          quote_vault_data = EXCLUDED.quote_vault_data,
          twap_oracle_data = EXCLUDED.twap_oracle_data,
          twap_config = EXCLUDED.twap_config,
          transaction_fee_payer = EXCLUDED.transaction_fee_payer,
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
        JSON.stringify(serializedData.transactionInstructions), // New format
        serializedData.transactionFeePayer || null,
        serializedData.baseMint,
        serializedData.quoteMint,
        serializedData.baseDecimals,
        serializedData.quoteDecimals,
        JSON.stringify(serializedData.ammConfig),
        JSON.stringify(serializedData.twapConfig || {}),
        JSON.stringify(serializedData.pAMMData),
        JSON.stringify(serializedData.fAMMData),
        JSON.stringify(serializedData.baseVaultData),
        JSON.stringify(serializedData.quoteVaultData),
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
        'SELECT * FROM i_proposals WHERE moderator_id = $1 AND proposal_id = $2',
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
        'SELECT * FROM i_proposals WHERE moderator_id = $1 ORDER BY id',
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
   * Get proposals for frontend (simplified data)
   * @returns An array of proposals
   */
  async getProposalsForFrontend(): Promise<IProposalDB[]> {
    try {
      const result = await this.pool.query<IProposalDB>(
        'SELECT * FROM i_proposals WHERE moderator_id = $1 ORDER BY created_at DESC',
        [this.moderatorId]
      );

      return result.rows;
    } catch (error) {
      this.logger.error('Failed to get proposals for frontend', {
        moderatorId: this.moderatorId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Get a single proposal for frontend by proposal_id
   * @param proposalId - The proposal ID
   * @returns The proposal or null if not found
   */
  async getProposalForFrontend(proposalId: number): Promise<IProposalDB | null> {
    try {
      const result = await this.pool.query<IProposalDB>(
        'SELECT * FROM i_proposals WHERE moderator_id = $1 AND proposal_id = $2',
        [this.moderatorId, proposalId]
      );

      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      this.logger.error('Failed to get proposal for frontend', {
        proposalId,
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
        authority: encryptKeypair(config.authority, encryptionKey),
        rpcUrl: config.rpcEndpoint,
      };

      const query = `
        INSERT INTO i_moderators (id, proposal_id_counter, config, protocol_name)
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
        'SELECT * FROM i_moderators WHERE id = $1',
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

      const config: IModeratorConfig = {
        baseMint: new PublicKey(row.config.baseMint),
        quoteMint: new PublicKey(row.config.quoteMint),
        baseDecimals: row.config.baseDecimals,
        quoteDecimals: row.config.quoteDecimals,
        authority: decryptKeypair(row.config.authority, encryptionKey),
        rpcEndpoint: row.config.rpcUrl,
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
      // Load authority keypair - use test authority if in test mode
      const moderatorState = await this.loadModeratorState();
      if (!moderatorState) {
        throw new Error('Moderator state not found');
      }
      const authority = moderatorState.config.authority;

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

        transactionInstructions: (() => {
          const txData = typeof row.transaction_instructions === 'string'
            ? JSON.parse(row.transaction_instructions)
            : row.transaction_instructions;

          // Handle both old format (array) and new format (object with instructions)
          if (Array.isArray(txData)) {
            return txData; // Old format: direct array of instructions
          } else if (txData && typeof txData === 'object' && 'instructions' in txData) {
            return txData.instructions; // New format: extract instructions array
          }
          return []; // Fallback
        })(),
        transactionFeePayer: (() => {
          if (row.transaction_fee_payer) return row.transaction_fee_payer;

          // Check if new format has feePayer
          const txData = typeof row.transaction_instructions === 'string'
            ? JSON.parse(row.transaction_instructions)
            : row.transaction_instructions;

          if (txData && typeof txData === 'object' && 'feePayer' in txData && txData.feePayer) {
            return txData.feePayer;
          }
          return undefined;
        })(),

        ammConfig: typeof row.amm_config === 'string'
          ? JSON.parse(row.amm_config)
          : row.amm_config,

        twapConfig: typeof row.twap_config === 'string'
          ? JSON.parse(row.twap_config)
          : row.twap_config,

        spotPoolAddress: row.spot_pool_address || undefined,
        totalSupply: row.total_supply || 1000000000,

        pAMMData: typeof row.pass_amm_data === 'string'
          ? JSON.parse(row.pass_amm_data)
          : row.pass_amm_data,
        fAMMData: typeof row.fail_amm_data === 'string'
          ? JSON.parse(row.fail_amm_data)
          : row.fail_amm_data,
        baseVaultData: typeof row.base_vault_data === 'string'
          ? JSON.parse(row.base_vault_data)
          : row.base_vault_data,
        quoteVaultData: typeof row.quote_vault_data === 'string'
          ? JSON.parse(row.quote_vault_data)
          : row.quote_vault_data,
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
}