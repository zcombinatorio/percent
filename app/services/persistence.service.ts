import { getPool } from './database.service';
import { IPersistenceService, IProposalDB, IModeratorStateDB } from '../types/persistence.interface';
import { IProposal, IProposalConfig } from '../types/proposal.interface';
import { IModeratorConfig } from '../types/moderator.interface';
import { Proposal } from '../proposal';
import { PublicKey, Keypair, Connection, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import fs from 'fs';
import path from 'path';

/**
 * Service for persisting and loading state from PostgreSQL database
 */
export class PersistenceService implements IPersistenceService {
  private static instance: PersistenceService | null = null;
  
  private constructor() {}
  
  public static getInstance(): PersistenceService {
    if (!PersistenceService.instance) {
      PersistenceService.instance = new PersistenceService();
    }
    return PersistenceService.instance;
  }
  
  /**
   * Run database migrations
   */
  async runMigrations(): Promise<void> {
    try {
      const pool = getPool();
      const migrationPath = path.join(process.cwd(), 'migrations', '001_initial_schema.sql');
      
      if (fs.existsSync(migrationPath)) {
        const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');
        await pool.query(migrationSQL);
        console.log('Database migrations completed successfully');
      } else {
        console.warn('Migration file not found, skipping migrations');
      }
    } catch (error) {
      console.error('Failed to run migrations:', error);
      throw error;
    }
  }
  
  /**
   * Save a proposal to the database
   */
  async saveProposal(proposal: IProposal): Promise<void> {
    const pool = getPool();
    
    try {
      // Serialize AMM states
      const passAmmState = proposal.__pAMM ? {
        state: proposal.__pAMM.state,
        pool: proposal.__pAMM.pool?.toBase58(),
        position: proposal.__pAMM.position?.toBase58(),
        positionNft: proposal.__pAMM.positionNft?.toBase58(),
      } : null;
      
      const failAmmState = proposal.__fAMM ? {
        state: proposal.__fAMM.state,
        pool: proposal.__fAMM.pool?.toBase58(),
        position: proposal.__fAMM.position?.toBase58(),
        positionNft: proposal.__fAMM.positionNft?.toBase58(),
      } : null;
      
      // Serialize Vault states
      const baseVaultState = proposal.__baseVault ? {
        state: proposal.__baseVault.state,
        escrow: proposal.__baseVault.escrow.toBase58(),
        passConditionalMint: proposal.__baseVault.passConditionalMint.toBase58(),
        failConditionalMint: proposal.__baseVault.failConditionalMint.toBase58(),
      } : null;
      
      const quoteVaultState = proposal.__quoteVault ? {
        state: proposal.__quoteVault.state,
        escrow: proposal.__quoteVault.escrow.toBase58(),
        passConditionalMint: proposal.__quoteVault.passConditionalMint.toBase58(),
        failConditionalMint: proposal.__quoteVault.failConditionalMint.toBase58(),
      } : null;
      
      // Serialize TWAP Oracle state
      const twapOracleState = proposal.twapOracle ? {
        passObservation: (proposal.twapOracle as any)._passObservation,
        failObservation: (proposal.twapOracle as any)._failObservation,
        passAggregation: (proposal.twapOracle as any)._passAggregation,
        failAggregation: (proposal.twapOracle as any)._failAggregation,
        lastUpdateTime: (proposal.twapOracle as any)._lastUpdateTime,
        initialTwapValue: proposal.twapOracle.initialTwapValue,
        twapMaxObservationChangePerUpdate: proposal.twapOracle.twapMaxObservationChangePerUpdate,
        twapStartDelay: proposal.twapOracle.twapStartDelay,
        passThresholdBps: proposal.twapOracle.passThresholdBps,
      } : null;
      
      // Serialize AMM config
      const ammConfig = proposal.ammConfig ? {
        initialBaseAmount: proposal.ammConfig.initialBaseAmount.toString(),
        initialQuoteAmount: proposal.ammConfig.initialQuoteAmount.toString(),
      } : null;
      
      // Serialize transaction
      const transactionData = proposal.transaction ? 
        Buffer.from(proposal.transaction.serialize({ requireAllSignatures: false })).toString('base64') : 
        null;
      
      const query = `
        INSERT INTO proposals (
          id, description, status, created_at, finalized_at, proposal_length,
          transaction_data, base_mint, quote_mint, base_decimals, quote_decimals,
          authority, amm_config, pass_amm_state, fail_amm_state,
          base_vault_state, quote_vault_state, twap_oracle_state
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          pass_amm_state = EXCLUDED.pass_amm_state,
          fail_amm_state = EXCLUDED.fail_amm_state,
          base_vault_state = EXCLUDED.base_vault_state,
          quote_vault_state = EXCLUDED.quote_vault_state,
          twap_oracle_state = EXCLUDED.twap_oracle_state,
          updated_at = NOW()
      `;
      
      await pool.query(query, [
        proposal.id,
        proposal.description,
        proposal.status,
        new Date(proposal.createdAt),
        new Date(proposal.finalizedAt),
        proposal.proposalLength.toString(),
        transactionData,
        (proposal as any).baseMint.toBase58(),
        (proposal as any).quoteMint.toBase58(),
        (proposal as any).baseDecimals,
        (proposal as any).quoteDecimals,
        (proposal as any).authority.publicKey.toBase58(),
        JSON.stringify(ammConfig),
        JSON.stringify(passAmmState),
        JSON.stringify(failAmmState),
        JSON.stringify(baseVaultState),
        JSON.stringify(quoteVaultState),
        JSON.stringify(twapOracleState)
      ]);
    } catch (error) {
      console.error('Failed to save proposal:', error);
      throw error;
    }
  }
  
  /**
   * Load a proposal from the database
   */
  async loadProposal(id: number): Promise<IProposal | null> {
    const pool = getPool();
    
    try {
      const result = await pool.query<IProposalDB>(
        'SELECT * FROM proposals WHERE id = $1',
        [id]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return this.reconstructProposal(row);
    } catch (error) {
      console.error('Failed to load proposal:', error);
      throw error;
    }
  }
  
  /**
   * Load all proposals from the database
   */
  async loadAllProposals(): Promise<IProposal[]> {
    const pool = getPool();
    
    try {
      const result = await pool.query<IProposalDB>(
        'SELECT * FROM proposals ORDER BY id'
      );
      
      const proposals: IProposal[] = [];
      for (const row of result.rows) {
        const proposal = await this.reconstructProposal(row);
        if (proposal) {
          proposals.push(proposal);
        }
      }
      
      return proposals;
    } catch (error) {
      console.error('Failed to load proposals:', error);
      throw error;
    }
  }
  
  /**
   * Get proposals for frontend (simplified data)
   */
  async getProposalsForFrontend(): Promise<IProposalDB[]> {
    const pool = getPool();
    
    try {
      const result = await pool.query<IProposalDB>(
        'SELECT * FROM proposals ORDER BY created_at DESC'
      );
      
      return result.rows;
    } catch (error) {
      console.error('Failed to get proposals for frontend:', error);
      throw error;
    }
  }
  
  /**
   * Get a single proposal for frontend
   */
  async getProposalForFrontend(id: number): Promise<IProposalDB | null> {
    const pool = getPool();
    
    try {
      const result = await pool.query<IProposalDB>(
        'SELECT * FROM proposals WHERE id = $1',
        [id]
      );
      
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      console.error('Failed to get proposal for frontend:', error);
      throw error;
    }
  }
  
  /**
   * Save moderator state to the database
   */
  async saveModeratorState(proposalCounter: number, config: IModeratorConfig): Promise<void> {
    const pool = getPool();
    
    try {
      const configData = {
        baseMint: config.baseMint.toBase58(),
        quoteMint: config.quoteMint.toBase58(),
        baseDecimals: config.baseDecimals,
        quoteDecimals: config.quoteDecimals,
        authority: config.authority.publicKey.toBase58(),
        rpcUrl: config.connection.rpcEndpoint,
      };
      
      const query = `
        INSERT INTO moderator_state (id, proposal_id_counter, config)
        VALUES (1, $1, $2)
        ON CONFLICT (id) DO UPDATE SET
          proposal_id_counter = EXCLUDED.proposal_id_counter,
          config = EXCLUDED.config,
          updated_at = NOW()
      `;
      
      await pool.query(query, [proposalCounter, JSON.stringify(configData)]);
    } catch (error) {
      console.error('Failed to save moderator state:', error);
      throw error;
    }
  }
  
  /**
   * Load moderator state from the database
   */
  async loadModeratorState(): Promise<{ proposalCounter: number; config: IModeratorConfig } | null> {
    const pool = getPool();
    
    try {
      const result = await pool.query<IModeratorStateDB>(
        'SELECT * FROM moderator_state WHERE id = 1'
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      
      // Load authority keypair from environment
      const keypairPath = process.env.SOLANA_KEYPAIR_PATH || './wallet.json';
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
      const authority = Keypair.fromSecretKey(new Uint8Array(keypairData));
      
      const config: IModeratorConfig = {
        baseMint: new PublicKey(row.config.baseMint),
        quoteMint: new PublicKey(row.config.quoteMint),
        baseDecimals: row.config.baseDecimals,
        quoteDecimals: row.config.quoteDecimals,
        authority,
        connection: new Connection(row.config.rpcUrl, 'confirmed'),
      };
      
      return {
        proposalCounter: row.proposal_id_counter,
        config,
      };
    } catch (error) {
      console.error('Failed to load moderator state:', error);
      return null;
    }
  }
  
  /**
   * Helper method to reconstruct a Proposal object from database row
   */
  private async reconstructProposal(row: IProposalDB): Promise<IProposal | null> {
    try {
      // Load authority keypair from environment
      const keypairPath = process.env.SOLANA_KEYPAIR_PATH || './wallet.json';
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
      const authority = Keypair.fromSecretKey(new Uint8Array(keypairData));
      
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const connection = new Connection(rpcUrl, 'confirmed');
      
      // Reconstruct transaction from database
      const transaction = Transaction.from(Buffer.from(row.transaction_data, 'base64'));
      
      // Reconstruct proposal config
      const config: IProposalConfig = {
        id: row.id,
        description: row.description,
        transaction: transaction,
        createdAt: new Date(row.created_at).getTime(),
        proposalLength: parseInt(row.proposal_length),
        baseMint: new PublicKey(row.base_mint),
        quoteMint: new PublicKey(row.quote_mint),
        baseDecimals: row.base_decimals,
        quoteDecimals: row.quote_decimals,
        authority,
        connection,
        twap: row.twap_oracle_state ? {
          initialTwapValue: row.twap_oracle_state.initialTwapValue,
          twapMaxObservationChangePerUpdate: row.twap_oracle_state.twapMaxObservationChangePerUpdate,
          twapStartDelay: row.twap_oracle_state.twapStartDelay,
          passThresholdBps: row.twap_oracle_state.passThresholdBps,
          minUpdateInterval: 60000, // 1 minute default
        } : {
          initialTwapValue: 0.5,
          twapMaxObservationChangePerUpdate: 0.1,
          twapStartDelay: 60000,
          passThresholdBps: 5000,
          minUpdateInterval: 60000, // 1 minute default
        },
        ammConfig: row.amm_config ? {
          initialBaseAmount: new BN(row.amm_config.initialBaseAmount),
          initialQuoteAmount: new BN(row.amm_config.initialQuoteAmount),
        } : {
          initialBaseAmount: new BN(0),
          initialQuoteAmount: new BN(0),
        },
      };
      
      // Create proposal instance
      const proposal = new Proposal(config);
      
      // Restore status
      (proposal as any)._status = row.status;
      
      // Restore AMM states if they exist
      if (row.pass_amm_state && proposal.__pAMM) {
        if (row.pass_amm_state.pool) {
          proposal.__pAMM.pool = new PublicKey(row.pass_amm_state.pool);
        }
        if (row.pass_amm_state.position) {
          proposal.__pAMM.position = new PublicKey(row.pass_amm_state.position);
        }
        if (row.pass_amm_state.positionNft) {
          proposal.__pAMM.positionNft = new PublicKey(row.pass_amm_state.positionNft);
        }
        (proposal.__pAMM as any)._state = row.pass_amm_state.state;
      }
      
      if (row.fail_amm_state && proposal.__fAMM) {
        if (row.fail_amm_state.pool) {
          proposal.__fAMM.pool = new PublicKey(row.fail_amm_state.pool);
        }
        if (row.fail_amm_state.position) {
          proposal.__fAMM.position = new PublicKey(row.fail_amm_state.position);
        }
        if (row.fail_amm_state.positionNft) {
          proposal.__fAMM.positionNft = new PublicKey(row.fail_amm_state.positionNft);
        }
        (proposal.__fAMM as any)._state = row.fail_amm_state.state;
      }
      
      // Restore Vault states if they exist
      if (row.base_vault_state && proposal.__baseVault) {
        (proposal.__baseVault as any)._state = row.base_vault_state.state;
      }
      
      if (row.quote_vault_state && proposal.__quoteVault) {
        (proposal.__quoteVault as any)._state = row.quote_vault_state.state;
      }
      
      // Restore TWAP Oracle state if exists
      if (row.twap_oracle_state && proposal.twapOracle) {
        (proposal.twapOracle as any)._passObservation = row.twap_oracle_state.passObservation;
        (proposal.twapOracle as any)._failObservation = row.twap_oracle_state.failObservation;
        (proposal.twapOracle as any)._passAggregation = row.twap_oracle_state.passAggregation;
        (proposal.twapOracle as any)._failAggregation = row.twap_oracle_state.failAggregation;
        (proposal.twapOracle as any)._lastUpdateTime = row.twap_oracle_state.lastUpdateTime;
      }
      
      return proposal;
    } catch (error) {
      console.error('Failed to reconstruct proposal:', error);
      return null;
    }
  }
}