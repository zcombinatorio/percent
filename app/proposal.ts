import { Transaction, PublicKey, Keypair, Connection } from '@solana/web3.js';
import { IProposal } from './types/proposal.interface';
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
  public __pVault: IVault | null = null;
  public __fVault: IVault | null = null;
  public readonly twapOracle: ITWAPOracle;
  public readonly createdAt: number;
  public readonly finalizedAt: number;
  public readonly baseMint: PublicKey;
  public readonly quoteMint: PublicKey;
  private _status: ProposalStatus = ProposalStatus.Pending;

  /**
   * Getter for proposal status (read-only access)
   */
  get status(): ProposalStatus { 
    return this._status;
  }

  /**
   * Creates a new Proposal instance
   * @param id - Unique proposal identifier
   * @param description - Human-readable description
   * @param transaction - Solana transaction to execute if passed
   * @param createdAt - Creation timestamp in milliseconds
   * @param proposalLength - Duration of voting period in seconds
   * @param baseMint - Public key of base token mint
   * @param quoteMint - Public key of quote token mint
   * @param twapMaxObservationChangePerUpdate - Max TWAP change per update
   * @param twapStartDelay - Delay before TWAP starts in seconds
   * @param passThresholdBps - Basis points threshold for passing
   */
  constructor(
    id: number,
    description: string,
    transaction: Transaction,
    createdAt: number,
    proposalLength: number,
    baseMint: PublicKey,
    quoteMint: PublicKey,
    twapMaxObservationChangePerUpdate: bigint,
    twapStartDelay: number,
    passThresholdBps: number
  ) {
    this.id = id;
    this.description = description;
    this.transaction = transaction;
    this.createdAt = createdAt;
    this.finalizedAt = createdAt + (proposalLength * 1000);
    this.baseMint = baseMint;
    this.quoteMint = quoteMint;
    
    this.twapOracle = new TWAPOracle(
      id,
      twapMaxObservationChangePerUpdate,
      twapStartDelay,
      passThresholdBps,
      createdAt,
      this.finalizedAt
    );
  }

  /**
   * Initializes the proposal's blockchain components
   * Deploys AMMs, vaults, and starts TWAP oracle recording
   * @param connection - Solana connection for blockchain interactions
   * @param authority - Keypair with authority to create mints and manage vaults
   */
  async initialize(connection: Connection, authority: Keypair): Promise<void> {
    // Initialize vaults for pass and fail markets
    this.__pVault = new Vault({
      proposalId: this.id,
      vaultType: VaultType.Pass,
      baseMint: this.baseMint,
      quoteMint: this.quoteMint,
      connection,
      authority
    });
    
    this.__fVault = new Vault({
      proposalId: this.id,
      vaultType: VaultType.Fail,
      baseMint: this.baseMint,
      quoteMint: this.quoteMint,
      connection,
      authority
    });
    
    // Initialize vaults (creates conditional token mints and escrow accounts)
    await this.__pVault.initialize();
    await this.__fVault.initialize();
    
    // TODO: Initialize AMMs using conditional token mints from vaults
    // The AMMs will use:
    // - pAMM: this.__pVault.conditionalBaseMint / this.__pVault.conditionalQuoteMint
    // - fAMM: this.__fVault.conditionalBaseMint / this.__fVault.conditionalQuoteMint
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
   * @returns Tuple of [pVault, fVault]  
   * @throws Error if vaults are not initialized
   */
  getVaults(): [IVault, IVault] {
    if (!this.__pVault || !this.__fVault) {
      throw new Error(`Proposal #${this.id}: Vaults are uninitialized`);
    }
    return [this.__pVault, this.__fVault];
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
      
      // Finalize vaults - winning vault can still process redemptions
      if (this.__pVault && this.__fVault) {
        await this.__pVault.finalize(passed); // pVault wins if passed
        await this.__fVault.finalize(!passed); // fVault wins if failed
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
    const result = await executionService.executeTransaction(
      this.transaction,
      signer,
      this.id
    );
    
    // Update status to Executed regardless of transaction result
    this._status = ProposalStatus.Executed;
    
    return result;
  }
}