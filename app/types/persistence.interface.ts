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

import { IModeratorConfig, ProposalStatus } from './moderator.interface';
import { IProposal } from './proposal.interface';
import { ITWAPConfig } from './twap-oracle.interface';

/**
 * Serialized transaction instruction data
 */
export interface ITransactionInstructionData {
  programId: string;
  keys: {
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }[];
  data: string; // base64 encoded
}

/**
 * Database representation of a proposal (new schema)
 */
export interface IProposalDB {
  id: number;                          // Global unique ID
  moderator_id: number;                 // Reference to moderator
  proposal_id: number;                  // Per-moderator proposal ID
  title: string;                       // Proposal title
  description?: string;                 // Proposal description (optional)
  status: ProposalStatus;               // Proposal status enum
  created_at: Date;
  finalized_at: Date;
  proposal_length: string;              // bigint stored as string

  // Transaction data
  transaction_instructions: string | ITransactionInstructionData[]; // JSON string or parsed array
  transaction_fee_payer?: string;       // Optional fee payer

  // Token configuration
  base_mint: string;
  quote_mint: string;
  base_decimals: number;
  quote_decimals: number;

  // AMM configuration
  amm_config: string | {                // JSON string or parsed object
    initialBaseAmount: string;
    initialQuoteAmount: string;
  };

  // TWAP configuration
  twap_config: string | ITWAPConfig;    // JSON string or parsed object

  // Serialized component data
  pass_amm_data: string | any;          // JSON string or parsed object
  fail_amm_data: string | any;          // JSON string or parsed object
  base_vault_data: string | any;        // JSON string or parsed object
  quote_vault_data: string | any;       // JSON string or parsed object
  twap_oracle_data: string | any;       // JSON string or parsed object

  // Optional fields
  spot_pool_address?: string;
  total_supply: number;

  updated_at: Date;
}

/**
 * Database representation of moderator state
 */
export interface IModeratorStateDB {
  id: number;
  proposal_id_counter: number;
  config: {
    baseMint: string;
    quoteMint: string;
    baseDecimals: number;
    quoteDecimals: number;
    authority: string;
    rpcUrl: string;
  };
  protocol_name?: string;
  updated_at: Date;
}

/**
 * Service for persisting and loading state from database
 */
export interface IPersistenceService {
  /**
   * Save a proposal to the database
   */
  saveProposal(proposal: IProposal): Promise<void>;
  
  /**
   * Load a proposal from the database
   */
  loadProposal(id: number): Promise<IProposal | null>;
  
  /**
   * Load all proposals from the database
   */
  loadAllProposals(): Promise<IProposal[]>;
  
  /**
   * Get proposals for frontend (simplified data)
   */
  getProposalsForFrontend(): Promise<IProposalDB[]>;
  
  /**
   * Get a single proposal for frontend
   */
  getProposalForFrontend(id: number): Promise<IProposalDB | null>;
  
  /**
   * Save moderator state to the database
   */
  saveModeratorState(proposalCounter: number, config: IModeratorConfig, protocolName?: string): Promise<void>;

  /**
   * Load moderator state from the database
   */
  loadModeratorState(): Promise<{ proposalCounter: number; config: IModeratorConfig; protocolName?: string } | null>;
}