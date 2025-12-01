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
import { IProposal, IProposalConfig, IProposalSerializedData, IProposalDeserializeConfig, IProposalStatusInfo } from './types/proposal.interface';
import { IAMM } from './types/amm.interface';
import { IVault, VaultType } from './types/vault.interface';
import { ITWAPOracle } from './types/twap-oracle.interface';
import { ProposalStatus } from './types/moderator.interface';
import { TWAPOracle } from './twap-oracle';
import { Vault } from './vault';
import { AMM } from './amm';
import { BN } from '@coral-xyz/anchor';
import { LoggerService } from './services/logger.service';

/**
 * Proposal class representing a governance proposal in the protocol
 * Handles initialization, finalization, and execution of proposals
 * Manages prediction markets through AMMs and vaults
 */
export class Proposal implements IProposal {
  public readonly config: IProposalConfig;
  public AMMs: IAMM[];
  public baseVault: IVault;
  public quoteVault: IVault;
  public readonly twapOracle: ITWAPOracle;
  public readonly finalizedAt: number;

  private _status: ProposalStatus = ProposalStatus.Uninitialized;
  private logger: LoggerService;

  /**
   * Gets comprehensive status information including winner details
   * Winner details are computed from TWAP oracle when status is Finalized
   * @returns Status info with winning market details (null if not finalized)
   */
  getStatus(): IProposalStatusInfo {
    // Fetch current winning index (null if uninitialized, otherwise tracks current leader)
    if (this._status === ProposalStatus.Uninitialized) {
      return {
        status: this._status,
        winningMarketIndex: null,
        winningMarketLabel: null,
        winningBaseConditionalMint: null,
        winningQuoteConditionalMint: null
      };
    }

    const winningIndex = this.twapOracle.fetchHighestTWAPIndex();
    return {
      status: this._status,
      winningMarketIndex: winningIndex,
      winningMarketLabel: this.config.market_labels![winningIndex],
      winningBaseConditionalMint: this.baseVault.conditionalMints[winningIndex],
      winningQuoteConditionalMint: this.quoteVault.conditionalMints[winningIndex]
    };
  }

  /**
   * Creates a new Proposal instance
   * @param config - Configuration object containing all proposal parameters
   */
  constructor(config: IProposalConfig) {
    this.config = config;
    this.finalizedAt = config.createdAt + (config.proposalLength * 1000);
    this.logger = config.logger;
    
    if (config.markets < 2 || config.markets > 4) {
      throw new Error('Number of markets must be between 2 and 4 (inclusive)');
    }

    if (config.market_labels && config.market_labels.length !== config.markets) {
      throw new Error('Number of market labels must match number of markets');
    }

    if (!config.market_labels) {
      config.market_labels = Array(config.markets).map((_, index) => `Market ${index + 1}`);
    }

    // Create TWAP oracle
    this.twapOracle = new TWAPOracle(
      config.id,
      config.twap,
      config.markets,
      config.createdAt,
      this.finalizedAt
    );

    // Create vaults
    this.baseVault = new Vault({
      proposalId: config.id,
      vaultType: VaultType.Base,
      markets: config.markets,
      regularMint: config.baseMint,
      decimals: config.baseDecimals,
      authority: config.authority,
      executionService: config.executionService,
      logger: config.logger.createChild('baseVault')
    });

    this.quoteVault = new Vault({
      proposalId: config.id,
      vaultType: VaultType.Quote,
      markets: config.markets,
      regularMint: config.quoteMint,
      decimals: config.quoteDecimals,
      authority: config.authority,
      executionService: config.executionService,
      logger: config.logger.createChild('quoteVault')
    });

    // Initialize AMMs (trades conditional tokens for each market)
    this.AMMs = [];
    for (let i = 0; i < config.markets; i++) {
      this.AMMs.push(new AMM(
        this.baseVault.conditionalMints[i],
        this.quoteVault.conditionalMints[i],
        config.baseDecimals,
        config.quoteDecimals,
        config.authority,
        config.executionService,
        config.logger.createChild(`amm-${i}`)
      ));
    }
  }


  /**
   * Initializes the proposal's blockchain components
   * Deploys AMMs, vaults, and starts TWAP oracle recording
   * Uses connection, authority, and decimals from constructor config
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing proposal');
    // Initialize vaults
    this.logger.info('Initializing vaults');
    await this.baseVault.initialize();
    await this.quoteVault.initialize();
    
    // Split regular tokens through vaults to get conditional tokens for AMM seeding
    // The authority needs to have regular tokens to split
    // Splitting gives equal amounts of pass and fail tokens
    const baseTokensToSplit = BigInt(this.config.ammConfig.initialBaseAmount.toString());
    const quoteTokensToSplit = BigInt(this.config.ammConfig.initialQuoteAmount.toString());
    
    // Build and execute split transactions for both vaults
    this.logger.info('Building split transactions');
    const baseSplitTx = await this.baseVault.buildSplitTx(
      this.config.authority.publicKey,
      baseTokensToSplit
    );

    const quoteSplitTx = await this.quoteVault.buildSplitTx(
      this.config.authority.publicKey,
      quoteTokensToSplit
    );
    
    // Execute splits using vault's executeSplitTx method
    this.logger.info('Executing split transactions');
    await this.baseVault.executeSplitTx(baseSplitTx);
    await this.quoteVault.executeSplitTx(quoteSplitTx);
    
    // Initialize AMMs with initial liquidity
    // All AMMs get the same amounts since splitting gives equal conditional tokens
    this.logger.info('Initializing AMMs');
    for (let i = 0; i < this.config.markets; i++) {
      await this.AMMs[i].initialize(
        this.config.ammConfig.initialBaseAmount,
        this.config.ammConfig.initialQuoteAmount
      );
    }
    
    // Set AMMs in TWAP oracle so it can track prices
    this.twapOracle.setAMMs(this.AMMs);
    
    // Update status to Pending now that everything is initialized
    this._status = ProposalStatus.Pending;
    this.logger.info('Proposal initialized and set to pending');
  }

  /**
   * Returns all AMMs for the proposal
   * @returns Array of AMM instances
   * @throws Error if AMMs are not initialized
   */
  getAMMs(): IAMM[] {
    if (this._status === ProposalStatus.Uninitialized) {
      throw new Error(`Proposal #${this.config.id}: Not initialized - call initialize() first`);
    }

    return this.AMMs;
  }

  /**
   * Returns both vaults for the proposal
   * @returns Tuple of [baseVault, quoteVault]  
   * @throws Error if vaults are not initialized
   */
  getVaults(): [IVault, IVault] {
    if (this._status === ProposalStatus.Uninitialized) {
      throw new Error(`Proposal #${this.config.id}: Not initialized - call initialize() first`);
    }
    return [this.baseVault, this.quoteVault];
  }

  /**
   * Finalizes the proposal based on time
   * Currently assumes all proposals pass for simplicity
   * Also finalizes the AMMs and vaults accordingly
   * @returns Tuple of [status, winningMarketIndex | null]
   */
  async finalize(): Promise<[ProposalStatus, number | null]> {
    this.logger.info('Finalizing proposal');
    if (this._status === ProposalStatus.Uninitialized) {
      throw new Error(`Proposal #${this.config.id}: Not initialized - call initialize() first`);
    }

    // Still pending if before finalization time
    if (Date.now() < this.finalizedAt) {
      return [ProposalStatus.Pending, null];
    }

    // Track winning index
    let winningIndex: number | null = null;

    // Update status if still pending after finalization time
    if (this._status === ProposalStatus.Pending) {
      // Perform final TWAP crank to ensure we have the most up-to-date data
      this.logger.info('Cranking TWAP');
      await this.twapOracle.crankTWAP();

      this._status = ProposalStatus.Finalized;

      // Remove liquidity from AMMs before finalizing vaults
      for (let i = 0; i < this.config.markets; i++) {
        try {
          if (!this.AMMs[i].isFinalized) {
            this.logger.info(`Removing liquidity from AMM ${i}`);
            await this.AMMs[i].removeLiquidity();
          }
        } catch (error) {
          this.logger.error('Error removing liquidity from AMM', {
            ammIndex: i,
            error
          });
        }
      }

      // Determine the winning conditional mint
      winningIndex = this.twapOracle.fetchHighestTWAPIndex();

      // Finalize both vaults with the proposal status
      this.logger.info('Finalizing vaults');
      await this.baseVault.finalize(this.baseVault.conditionalMints[winningIndex]);
      await this.quoteVault.finalize(this.quoteVault.conditionalMints[winningIndex]);
      
      // Redeem authority's winning tokens after finalization
      // This converts winning conditional tokens back to regular tokens
      try {
        this.logger.info('Building redeem winning tokens transaction for base vault');
        const baseRedeemTx = await this.baseVault.buildRedeemWinningTokensTx(
          this.config.authority.publicKey
        );
        this.logger.info('Executing redeem winning tokens transaction for base vault');
        baseRedeemTx.sign(this.config.authority);
        await this.baseVault.executeRedeemWinningTokensTx(baseRedeemTx);
      } catch (error) {
        this.logger.warn('Error redeeming base vault winning tokens', {
          vaultType: 'base',
          error
        });
      }

      try {
        this.logger.info('Building redeem winning tokens transaction for quote vault');
        const quoteRedeemTx = await this.quoteVault.buildRedeemWinningTokensTx(
          this.config.authority.publicKey
        );
        this.logger.info('Executing redeem winning tokens transaction for quote vault');
        quoteRedeemTx.sign(this.config.authority);
        await this.quoteVault.executeRedeemWinningTokensTx(quoteRedeemTx);
      } catch (error) {
        this.logger.warn('Error redeeming quote vault winning tokens', {
          vaultType: 'quote',
          error
        });
      }
    }

    this.logger.info('Proposal finalization returned', { status: this._status, winningIndex });
    return [this._status, winningIndex];
  }

  /**
   * Serializes the proposal state for persistence
   * @returns Serialized proposal data that can be saved to database
   */
  serialize(): IProposalSerializedData {
    return {
      // Core configuration
      id: this.config.id,
      moderatorId: this.config.moderatorId,
      title: this.config.title,
      description: this.config.description,
      market_labels: this.config.market_labels,
      markets: this.config.markets,
      createdAt: this.config.createdAt,
      proposalLength: this.config.proposalLength,
      finalizedAt: this.finalizedAt,
      status: this._status,

      // Token configuration
      baseMint: this.config.baseMint.toBase58(),
      quoteMint: this.config.quoteMint.toBase58(),
      baseDecimals: this.config.baseDecimals,
      quoteDecimals: this.config.quoteDecimals,

      // AMM configuration
      ammConfig: {
        initialBaseAmount: this.config.ammConfig.initialBaseAmount.toString(),
        initialQuoteAmount: this.config.ammConfig.initialQuoteAmount.toString(),
      },

      // Optional fields
      spotPoolAddress: this.config.spotPoolAddress,
      totalSupply: this.config.totalSupply,

      // TWAP configuration
      twapConfig: this.config.twap,

      // Serialize components using their individual serialize methods
      AMMData: this.AMMs.map(amm => amm.serialize()),
      baseVaultData: this.baseVault.serialize(),
      quoteVaultData: this.quoteVault.serialize(),
      twapOracleData: this.twapOracle.serialize(),
    };
  }

  /**
   * Deserializes proposal data and restores the proposal state
   * @param data - Serialized proposal data from database
   * @param config - Configuration for reconstructing the proposal
   * @returns Restored proposal instance
   */
  static async deserialize(data: IProposalSerializedData, config: IProposalDeserializeConfig): Promise<Proposal> {

    // Reconstruct proposal config
    const proposalConfig: IProposalConfig = {
      id: data.id,
      moderatorId: data.moderatorId,
      title: data.title,
      description: data.description,
      market_labels: data.market_labels,
      markets: data.markets,
      createdAt: data.createdAt,
      proposalLength: data.proposalLength,
      baseMint: new PublicKey(data.baseMint),
      quoteMint: new PublicKey(data.quoteMint),
      baseDecimals: data.baseDecimals,
      quoteDecimals: data.quoteDecimals,
      authority: config.authority,
      executionService: config.executionService,
      twap: data.twapConfig,
      spotPoolAddress: data.spotPoolAddress,
      totalSupply: data.totalSupply,
      ammConfig: {
        initialBaseAmount: new BN(data.ammConfig.initialBaseAmount),
        initialQuoteAmount: new BN(data.ammConfig.initialQuoteAmount),
      },
      logger: config.logger
    };

    // Create proposal instance
    const proposal = new Proposal(proposalConfig);

    // Restore the status
    proposal._status = data.status;

    // Only deserialize components if the proposal isn't in Uninitialized state
    if (data.status !== ProposalStatus.Uninitialized) {
      // Deserialize vaults
      // Patch vault data with proposal-level info if missing (for backward compatibility)
      const baseVaultData = {
        ...data.baseVaultData,
        proposalId: data.baseVaultData.proposalId ?? data.id,
        vaultType: data.baseVaultData.vaultType ?? VaultType.Base,
        regularMint: data.baseVaultData.regularMint || data.baseMint,
        decimals: data.baseVaultData.decimals ?? data.baseDecimals,
        proposalStatus: data.baseVaultData.proposalStatus ?? data.status
      };

      const quoteVaultData = {
        ...data.quoteVaultData,
        proposalId: data.quoteVaultData.proposalId ?? data.id,
        vaultType: data.quoteVaultData.vaultType ?? VaultType.Quote,
        regularMint: data.quoteVaultData.regularMint || data.quoteMint,
        decimals: data.quoteVaultData.decimals ?? data.quoteDecimals,
        proposalStatus: data.quoteVaultData.proposalStatus ?? data.status
      };

      const baseVault = await Vault.deserialize(baseVaultData, {
        authority: config.authority,
        executionService: config.executionService,
        logger: config.logger.createChild('baseVault')
      });

      const quoteVault = await Vault.deserialize(quoteVaultData, {
        authority: config.authority,
        executionService: config.executionService,
        logger: config.logger.createChild('quoteVault')
      });

      // Replace the default vaults with the deserialized ones
      proposal.baseVault = baseVault;
      proposal.quoteVault = quoteVault;

      // Deserialize AMMs
      // Patch AMM data with proposal-level token info if missing (for backward compatibility)
      const AMMData = [];
      for (let i = 0; i < data.markets; i++) {
        const ammData = data.AMMData[i];
        AMMData.push({
          ...ammData,
          baseMint: ammData.baseMint,
          quoteMint: ammData.quoteMint || data.quoteMint,
          baseDecimals: ammData.baseDecimals ?? data.baseDecimals,
          quoteDecimals: ammData.quoteDecimals ?? data.quoteDecimals
        });
      }

      // Deserialize AMMs
      const AMMs: IAMM[] = [];
      for (let i = 0; i < data.markets; i++) {
        const ammData = data.AMMData[i];
        const amm = AMM.deserialize(ammData, {
          authority: config.authority,
          executionService: config.executionService,
          logger: config.logger.createChild(`amm-${i}`)
        });
        AMMs.push(amm);
      }

      // Replace the default AMMs with the deserialized ones
      proposal.AMMs = AMMs;

      // Deserialize TWAP oracle
      const twapOracle = TWAPOracle.deserialize(data.twapOracleData);

      // Set AMMs in TWAP oracle
      twapOracle.setAMMs(AMMs);

      // Replace the default TWAP oracle with the deserialized one
      (proposal as any).twapOracle = twapOracle; // Need to cast since it's readonly
    }

    return proposal;
  }
}