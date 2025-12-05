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

import { PublicKey } from "@solana/web3.js";
import {
  IProposal,
  IProposalConfig,
  IProposalSerializedData,
  IProposalDeserializeConfig,
  IProposalStatusInfo,
} from "./types/proposal.interface";
import { IAMM } from "./types/amm.interface";
import { ITWAPOracle } from "./types/twap-oracle.interface";
import { ProposalStatus } from "./types/moderator.interface";
import { TWAPOracle } from "./twap-oracle";
import { AMM } from "./amm";
import { AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import { LoggerService } from "./services/logger.service";
import {
  MAX_OPTIONS,
  VaultClient,
  VaultType,
} from "@zcomb/vault-sdk";

/**
 * Proposal class representing a governance proposal in the protocol
 * Handles initialization, finalization, and execution of proposals
 * Manages prediction markets through AMMs and vaults
 */
export class Proposal {
  public readonly config: IProposalConfig;
  public AMMs: IAMM[];
  public readonly twapOracle: ITWAPOracle;
  public readonly finalizedAt: number;

  private _status: ProposalStatus = ProposalStatus.Uninitialized;
  private logger: LoggerService;
  private provider: AnchorProvider;
  private vaultClient: VaultClient;

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
        winningQuoteConditionalMint: null,
      };
    }

    const winningIndex = this.twapOracle.fetchHighestTWAPIndex();

    return {
      status: this._status,
      winningMarketIndex: winningIndex,
      winningMarketLabel: this.config.market_labels![winningIndex],
      winningBaseConditionalMint: this.vaultClient.deriveConditionalMint(
        this.deriveVaultPDA(VaultType.Base),
        VaultType.Base,
        winningIndex
      )[0],
      winningQuoteConditionalMint: this.vaultClient.deriveConditionalMint(
        this.deriveVaultPDA(VaultType.Quote),
        VaultType.Quote,
        winningIndex
      )[0],
    };
  }

  /**
   * Creates a new Proposal instance
   * @param config - Configuration object containing all proposal parameters
   */
  constructor(config: IProposalConfig) {
    this.config = config;
    this.finalizedAt = config.createdAt + config.proposalLength * 1000;
    this.logger = config.logger;
    this.AMMs = [];

    // Create Anchor provider using authority keypair as wallet
    const wallet = new Wallet(config.authority);
    this.provider = new AnchorProvider(
      config.executionService.connection,
      wallet,
      { commitment: "confirmed" }
    );

    // Initialize VaultClient with provider
    this.vaultClient = new VaultClient(this.provider);

    if (config.markets < 2 || config.markets > MAX_OPTIONS) {
      throw new Error(`Number of markets must be between 2 & ${MAX_OPTIONS}`);
    }

    if (
      config.market_labels &&
      config.market_labels.length !== config.markets
    ) {
      throw new Error("Number of market labels must match number of markets");
    }

    if (!config.market_labels) {
      config.market_labels = Array(config.markets).map(
        (_, index) => `Market ${index + 1}`
      );
    }

    // Create TWAP oracle
    this.twapOracle = new TWAPOracle(
      config.id,
      config.twap,
      config.markets,
      config.createdAt,
      this.finalizedAt
    );
  }

  /**
   * Initializes the proposal's blockchain components
   * Deploys AMMs, vaults, and starts TWAP oracle recording
   * If DAMM withdrawal data is provided, withdraws liquidity from spot pool
   * Uses connection, authority, and decimals from constructor config
   */
  async initialize(): Promise<void> {
    this.logger.info("Initializing proposal");
    // Initialize vaults
    this.logger.info("Initializing vaults");

    // Base Vault
    const {
      builder: initBuilder,
      vaultPda: vaultPda,
      condBaseMint0,
      condBaseMint1,
      condQuoteMint0,
      condQuoteMint1
    } = this.vaultClient.initialize(
      this.config.authority.publicKey,
      this.config.baseMint,
      this.config.quoteMint,
      this.config.moderatorId,
      this.config.id,
    );
    const baseCondMints: PublicKey[] = [condBaseMint0, condBaseMint1];
    const quoteCondMints: PublicKey[] = [condQuoteMint0, condQuoteMint1];
    await initBuilder.rpc();

    // Add additional options to base vault if markets > 2
    for (let i = 2; i < this.config.markets; i++) { 
      const { builder: addOptionBuilder, condBaseMint, condQuoteMint } =
        await this.vaultClient.addOption(
          this.config.authority.publicKey,
          vaultPda
        );
      baseCondMints.push(condBaseMint);
      quoteCondMints.push(condQuoteMint);
      await addOptionBuilder.rpc();
    }

    await this.vaultClient
      .activate(this.config.authority.publicKey, vaultPda)
      .rpc();

    // Withdraw Liquidity from Spot (if callback provided)
    if (this.config.confirmDammWithdrawal) {
      await this.config.confirmDammWithdrawal();
    }


    // Split regular tokens through vaults to get conditional tokens for AMM seeding
    // The authority needs to have regular tokens to split
    // Splitting gives equal amounts of pass and fail tokens
    await (
      await this.vaultClient.deposit(
        this.config.authority.publicKey,
        vaultPda,
        VaultType.Base,
        this.config.ammConfig.initialBaseAmount
      )
    ).rpc();
    await (
      await this.vaultClient.deposit(
        this.config.authority.publicKey,
        vaultPda,
        VaultType.Quote,
        this.config.ammConfig.initialQuoteAmount
      )
    ).rpc();

    // Initialize AMMs with initial liquidity
    // All AMMs get the same amounts since splitting gives equal conditional tokens
    this.logger.info("Initializing AMMs");
    this.AMMs = [];
    for (let i = 0; i < this.config.markets; i++) {
      this.AMMs.push(
        new AMM(
          baseCondMints[i],
          quoteCondMints[i],
          this.config.baseDecimals,
          this.config.quoteDecimals,
          this.config.authority,
          this.config.executionService,
          this.config.logger.createChild(`amm-${i}`)
        )
      );
      await this.AMMs[i].initialize(
        this.config.ammConfig.initialBaseAmount,
        this.config.ammConfig.initialQuoteAmount
      );
    }
    // Set AMMs in TWAP oracle so it can track prices
    this.twapOracle.setAMMs(this.AMMs);

    // Update status to Pending now that everything is initialized
    this._status = ProposalStatus.Pending;
    this.logger.info("Proposal initialized and set to pending");
  }

  /**
   * Returns all AMMs for the proposal
   * @returns Array of AMM instances
   * @throws Error if AMMs are not initialized
   */
  getAMMs(): IAMM[] {
    if (this._status === ProposalStatus.Uninitialized) {
      throw new Error(
        `Proposal #${this.config.id}: Not initialized - call initialize() first`
      );
    }

    return this.AMMs;
  }

  /**
   * Finalizes the proposal based on time
   * Currently assumes all proposals pass for simplicity
   * Also finalizes the AMMs and vaults accordingly
   * @returns Tuple of [status, winningMarketIndex | null]
   */
  async finalize(): Promise<[ProposalStatus, number | null]> {
    this.logger.info("Finalizing proposal");
    if (this._status === ProposalStatus.Uninitialized) {
      throw new Error(
        `Proposal #${this.config.id}: Not initialized - call initialize() first`
      );
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
      this.logger.info("Cranking TWAP");
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
          this.logger.error("Error removing liquidity from AMM", {
            ammIndex: i,
            error,
          });
        }
      }

      // Determine the winning conditional mint
      winningIndex = this.twapOracle.fetchHighestTWAPIndex();

      const [vaultPDA] = this.vaultClient.deriveVaultPDA(
        this.config.authority.publicKey,
        this.config.moderatorId,
        this.config.id
      );

      // Finalize both vaults
      this.logger.info("Finalizing vaults");
      await this.vaultClient
        .finalize(this.config.authority.publicKey, vaultPDA, winningIndex)
        .rpc();

      // Redeem authority's winning tokens after finalization
      // This converts winning conditional tokens back to regular tokens
      try {
        this.logger.info("Redeem winning tokens transaction for base vault");
        await (
          await this.vaultClient.redeemWinnings(
            this.config.authority.publicKey,
            vaultPDA,
            VaultType.Base
          )
        ).rpc();
      } catch (error) {
        this.logger.warn("Error redeeming base vault winning tokens", {
          vaultType: "base",
          error,
        });
      }

      try {
        this.logger.info("Redeem winning tokens transaction for quote vault");
        await (
          await this.vaultClient.redeemWinnings(
            this.config.authority.publicKey,
            vaultPDA,
            VaultType.Quote
          )
        ).rpc();
      } catch (error) {
        this.logger.warn("Error redeeming quote vault winning tokens", {
          vaultType: "quote",
          error,
        });
      }
    }

    this.logger.info("Proposal finalization returned", {
      status: this._status,
      winningIndex,
    });
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
      AMMData: this.AMMs.map((amm) => amm.serialize()),
      twapOracleData: this.twapOracle.serialize(),
    };
  }

  /**
   * Deserializes proposal data and restores the proposal state
   * @param data - Serialized proposal data from database
   * @param config - Configuration for reconstructing the proposal
   * @returns Restored proposal instance
   */
  static async deserialize(
    data: IProposalSerializedData,
    config: IProposalDeserializeConfig
  ): Promise<Proposal> {
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
      logger: config.logger,
      // Note: confirmDammWithdrawal callback is not restored during deserialization since it's only used during initialize
    };

    // Create proposal instance
    const proposal = new Proposal(proposalConfig);

    // Restore the status
    proposal._status = data.status;

    // Only deserialize components if the proposal isn't in Uninitialized state
    if (data.status !== ProposalStatus.Uninitialized) {
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
          quoteDecimals: ammData.quoteDecimals ?? data.quoteDecimals,
        });
      }

      // Deserialize AMMs
      const AMMs: IAMM[] = [];
      for (let i = 0; i < data.markets; i++) {
        const ammData = data.AMMData[i];
        const amm = AMM.deserialize(ammData, {
          authority: config.authority,
          executionService: config.executionService,
          logger: config.logger.createChild(`amm-${i}`),
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

  deriveVaultPDA(vaultType: VaultType): PublicKey {
    return this.vaultClient.deriveVaultPDA(
      this.config.authority.publicKey,
      this.config.moderatorId,
      this.config.id
    )[0]; // Just return the public key
  }
}
