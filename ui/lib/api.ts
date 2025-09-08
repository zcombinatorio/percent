import { PublicKey, Transaction, Connection } from '@solana/web3.js';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

export interface CreateProposalRequest {
  title: string;
  description: string;
  votingPeriodMs: number;
  passThresholdBps: number;
  baseMint: string;
  quoteMint: string;
  transaction?: string;
}

export interface ProposalResponse {
  id: number;
  title: string;
  description: string;
  status: 'Pending' | 'Passed' | 'Failed' | 'Executed';
  createdAt: string;
  finalizedAt?: string;
  passPrice: number;
  failPrice: number;
  volume24h: number;
  passThresholdBps: number;
  votingPeriodMs: number;
}

export interface TradeRequest {
  proposalId: number;
  market: 'pass' | 'fail';
  type: 'buy' | 'sell';
  amount: number;
  walletAddress: string;
}

export interface VaultOperation {
  proposalId: number;
  operation: 'split' | 'merge' | 'redeem';
  amount: number;
  walletAddress: string;
}

class GovernanceAPI {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(RPC_URL);
  }

  async getProposals(): Promise<ProposalResponse[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/proposals`);
      if (!response.ok) throw new Error('Failed to fetch proposals');
      return await response.json();
    } catch (error) {
      console.error('Error fetching proposals:', error);
      return [];
    }
  }

  async getProposal(id: number): Promise<ProposalResponse | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/proposals/${id}`);
      if (!response.ok) throw new Error('Failed to fetch proposal');
      return await response.json();
    } catch (error) {
      console.error('Error fetching proposal:', error);
      return null;
    }
  }

  async createProposal(request: CreateProposalRequest): Promise<{ id: number } | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/proposals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error('Failed to create proposal');
      return await response.json();
    } catch (error) {
      console.error('Error creating proposal:', error);
      return null;
    }
  }

  async executeTrade(request: TradeRequest): Promise<{ signature: string } | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/trade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error('Failed to execute trade');
      return await response.json();
    } catch (error) {
      console.error('Error executing trade:', error);
      return null;
    }
  }

  async executeVaultOperation(request: VaultOperation): Promise<{ signature: string } | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/vault/${request.operation}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) throw new Error(`Failed to execute ${request.operation}`);
      return await response.json();
    } catch (error) {
      console.error('Error executing vault operation:', error);
      return null;
    }
  }

  async getPortfolio(walletAddress: string): Promise<any> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/portfolio/${walletAddress}`);
      if (!response.ok) throw new Error('Failed to fetch portfolio');
      return await response.json();
    } catch (error) {
      console.error('Error fetching portfolio:', error);
      return null;
    }
  }

  async finalizeProposal(id: number): Promise<{ success: boolean } | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/proposals/${id}/finalize`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to finalize proposal');
      return await response.json();
    } catch (error) {
      console.error('Error finalizing proposal:', error);
      return null;
    }
  }

  async executeProposal(id: number, signerAddress: string): Promise<{ signature: string } | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/proposals/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerAddress }),
      });
      if (!response.ok) throw new Error('Failed to execute proposal');
      return await response.json();
    } catch (error) {
      console.error('Error executing proposal:', error);
      return null;
    }
  }
}

export const api = new GovernanceAPI();