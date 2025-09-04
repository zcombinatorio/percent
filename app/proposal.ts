import { Transaction } from '@solana/web3.js';
import { IProposal } from './types/proposal.interface';
import { IAMM } from './types/amm.interface';
import { IVault } from './types/vault.interface';
import { ITWAPOracle } from './types/twap-oracle.interface';
import { ProposalStatus } from './types/moderator.interface';
import { TWAPOracle } from './twap-oracle';

export class Proposal implements IProposal {
  public id: number;
  public description: string;
  public transaction: Transaction;
  public pAMM: IAMM | null = null;
  public fAMM: IAMM | null = null;
  public pVault: IVault | null = null;
  public fVault: IVault | null = null;
  public twapOracle: ITWAPOracle;
  public createdAt: number;
  public finalizedAt: number;
  public baseMint: string;
  public quoteMint: string;
  private _status: ProposalStatus = ProposalStatus.Pending;

  get status(): ProposalStatus { 
    return this._status;
  }

  constructor(
    id: number,
    description: string,
    transaction: Transaction,
    createdAt: number,
    proposalLength: number,
    baseMint: string,
    quoteMint: string,
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

  fetchTTL(): number {
    const remaining = this.finalizedAt - Date.now();
    return Math.max(0, Math.floor(remaining / 1000));
  }

  private async deployVirtualVault(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  private async deployAMM(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async getAMMs(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async getVaults(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  finalize(): ProposalStatus {
    if (Date.now() < this.finalizedAt) {
      return ProposalStatus.Pending;
    }
    
    if (this._status === ProposalStatus.Pending) {
      this._status = ProposalStatus.Failed; // TODO: Implement finalization logic
    }
    
    return this._status;
  }

  async execute(): Promise<void> {
    if (this._status === ProposalStatus.Pending) {
      throw new Error('Cannot execute proposal that has not been finalized');
    }
    
    if (this._status === ProposalStatus.Executed) {
      throw new Error('Proposal has already been executed');
    }
    
    if (this._status !== ProposalStatus.Passed) {
      throw new Error('Cannot execute proposal that has not passed');
    }
    
    this._status = ProposalStatus.Executed;
  }
}