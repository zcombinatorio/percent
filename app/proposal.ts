import { Transaction, PublicKey, Keypair, Connection } from '@solana/web3.js';
import { IProposal, IProposalConfig } from './types/proposal.interface';
import { IAMM } from './types/amm.interface';
import { IVault, VaultType } from './types/vault.interface';
import { ITWAPOracle } from './types/twap-oracle.interface';
import { ProposalStatus } from './types/moderator.interface';
import { TWAPOracle } from './twap-oracle';
import { ExecutionService } from './services/execution.service';
import { IExecutionResult, IExecutionConfig } from './types/execution.interface';
import { Vault } from './vault';

/**
 * Proposal class representing a governance proposal in the protocol
 * Handles initialization, finalization, and execution of proposals
 * Manages prediction markets through AMMs and vaults
 */
export class Proposal implements IProposal {
  public readonly id: number;
  public description: string;
  public transaction: Transaction;
  public __pAMM: IAMM | null = null;
  public __fAMM: IAMM | null = null;
  public __baseVault: IVault | null = null;
  public __quoteVault: IVault | null = null;
  public readonly twapOracle: ITWAPOracle;
  public readonly createdAt: number;
  public readonly finalizedAt: number;
  public readonly baseMint: PublicKey;
  public readonly quoteMint: PublicKey;

  private _status: ProposalStatus = ProposalStatus.Pending;
  private readonly config: IProposalConfig;

  /**
   * Getter for proposal status (read-only access)
   */
  get status(): ProposalStatus { 
    return this._status;
  }

  /**
   * Creates a new Proposal instance
   * @param config - Configuration object containing all proposal parameters
   */
  constructor(config: IProposalConfig) {
    this.config = config;
    this.id = config.id;
    this.description = config.description;
    this.transaction = config.transaction;
    this.createdAt = config.createdAt;
    this.finalizedAt = config.createdAt + (config.proposalLength * 1000);
    this.baseMint = config.baseMint;
    this.quoteMint = config.quoteMint;
    
    this.twapOracle = new TWAPOracle(
      config.id,
      config.twapMaxObservationChangePerUpdate,
      config.twapStartDelay,
      config.passThresholdBps,
      config.createdAt,
      this.finalizedAt
    );
  }

  /**
   * Initializes the proposal's blockchain components
   * Deploys AMMs, vaults, and starts TWAP oracle recording
   * Uses connection, authority, and decimals from constructor config
   */
  async initialize(): Promise<void> {
    // Initialize vaults for base and quote tokens
    this.__baseVault = new Vault({
      proposalId: this.id,
      vaultType: VaultType.Base,
      regularMint: this.baseMint,
      decimals: this.config.baseDecimals,
      connection: this.config.connection,
      authority: this.config.authority
    });
    
    this.__quoteVault = new Vault({
      proposalId: this.id,
      vaultType: VaultType.Quote,
      regularMint: this.quoteMint,
      decimals: this.config.quoteDecimals,
      connection: this.config.connection,
      authority: this.config.authority
    });
    
    // Initialize vaults (creates conditional token mints and escrow accounts)
    await this.__baseVault.initialize();
    await this.__quoteVault.initialize();
    
    // TODO: Initialize AMMs using conditional token mints from vaults
    // The AMMs will use:
    // - pAMM: trades pBase/pQuote tokens (this.__baseVault.passConditionalMint / this.__quoteVault.passConditionalMint)
    // - fAMM: trades fBase/fQuote tokens (this.__baseVault.failConditionalMint / this.__quoteVault.failConditionalMint)
    // TODO: Start TWAP oracle recording
  }

  /**
   * Calculates remaining time until proposal voting ends
   * @returns Time-to-live in seconds (0 if expired)
   */
  fetchTTL(): number {
    const remaining = this.finalizedAt - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
  }


  /**
   * Returns both AMMs for the proposal
   * @returns Tuple of [pAMM, fAMM]
   * @throws Error if AMMs are not initialized
   */
  getAMMs(): [IAMM, IAMM] {
    if (!this.__pAMM || !this.__fAMM) {
      throw new Error(`Proposal #${this.id}: AMMs are uninitialized`);
    }
    return [this.__pAMM, this.__fAMM];
  }

  /**
   * Returns both vaults for the proposal
   * @returns Tuple of [baseVault, quoteVault]  
   * @throws Error if vaults are not initialized
   */
  getVaults(): [IVault, IVault] {
    if (!this.__baseVault || !this.__quoteVault) {
      throw new Error(`Proposal #${this.id}: Vaults are uninitialized`);
    }
    return [this.__baseVault, this.__quoteVault];
  }

  /**
   * Finalizes the proposal based on time
   * Currently assumes all proposals pass for simplicity
   * Also finalizes the vaults accordingly
   * @returns The current or updated proposal status
   */
  async finalize(): Promise<ProposalStatus> {
    // Still pending if before finalization time
    if (Date.now() < this.finalizedAt) {
      return ProposalStatus.Pending;
    }
    
    // Update status if still pending after finalization time
    if (this._status === ProposalStatus.Pending) {
      // TODO: Implement TWAP oracle logic to determine pass/fail
      // For now, assume all proposals pass
      const passed = true;
      this._status = passed ? ProposalStatus.Passed : ProposalStatus.Failed;
      
      // Finalize both vaults with the proposal status
      if (this.__baseVault && this.__quoteVault) {
        await this.__baseVault.finalize(this._status);
        await this.__quoteVault.finalize(this._status);
      }
    }
    
    return this._status;
  }

  /**
   * Executes the proposal's Solana transaction
   * Only callable for proposals with Passed status
   * @param signer - Keypair to sign and execute the transaction
   * @param executionConfig - Configuration for transaction execution
   * @returns Execution result with signature and status
   * @throws Error if proposal is pending, already executed, or failed
   */
  async execute(
    signer: Keypair, 
    executionConfig: IExecutionConfig
  ): Promise<IExecutionResult> {
    if (this._status === ProposalStatus.Pending) {
      throw new Error(`Cannot execute proposal #${this.id} - not finalized`);
    }
    
    if (this._status === ProposalStatus.Executed) {
      throw new Error(`Proposal #${this.id} has already been executed`);
    }
    
    if (this._status !== ProposalStatus.Passed) {
      throw new Error(`Cannot execute proposal #${this.id} - status is ${this._status}`);
    }
    
    // Execute the Solana transaction
    const executionService = new ExecutionService(executionConfig);
    const result = await executionService.executeTx(
      this.transaction,
      signer
    );
    
    // Update status to Executed regardless of transaction result
    this._status = ProposalStatus.Executed;
    
    return result;
  }
}