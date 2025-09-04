import { Transaction } from '@solana/web3.js';
import { IModerator, IModeratorConfig, ProposalStatus } from './types/moderator.interface';
import { IProposal } from './types/proposal.interface';
import { Proposal } from './proposal';

/**
 * Moderator class that manages governance proposals for the protocol
 * Handles creation, finalization, and execution of proposals
 */
export class Moderator implements IModerator {
  public config: IModeratorConfig;                         // Configuration parameters for the moderator
  public proposals: [IProposal, ProposalStatus][] = [];   // Array storing all proposals and their statuses
  private proposalIdCounter: number = 0;                   // Auto-incrementing ID counter for proposals

  /**
   * Creates a new Moderator instance
   * @param config - Configuration object containing all necessary parameters
   */
  constructor(config: IModeratorConfig) {
    this.config = config;
  }

  /**
   * Creates a new governance proposal
   * @param description - Human-readable description of the proposal
   * @param transaction - Solana transaction that will be executed if proposal passes
   * @returns The newly created proposal object
   * @throws Error if proposal creation fails
   */
  async createProposal(description: string, transaction: Transaction): Promise<IProposal> {
    try {
      // Create new proposal with current timestamp and config parameters
      const proposal = new Proposal(
        this.proposalIdCounter,
        description,
        transaction,
        Date.now(),  // Set creation timestamp
        this.config.proposalLength,
        this.config.baseMint,
        this.config.quoteMint,
        this.config.twapMaxObservationChangePerUpdate,
        this.config.twapStartDelay,
        this.config.passThresholdBps
      );
      
      // Store proposal with Pending status at index matching its ID
      this.proposals[this.proposalIdCounter] = [proposal, ProposalStatus.Pending];
      this.proposalIdCounter++;  // Increment counter for next proposal
      
      return proposal;
    } catch (error) {
      console.error('Failed to create proposal:', error);
      throw error;
    }
  }

  /**
   * Finalizes a proposal after the voting period has ended
   * Determines if proposal passed or failed based on votes
   * TODO: Implement finalization logic
   */
  async finalizeProposal(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  /**
   * Executes the transaction of a passed proposal
   * Only callable for proposals with Passed status
   * TODO: Implement execution logic
   */
  async executeProposal(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}