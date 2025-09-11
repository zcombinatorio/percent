import { Connection } from '@solana/web3.js';
import type { ProposalListResponse, ProposalListItem, ProposalDetailResponse } from '../../src/types/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

class GovernanceAPI {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(RPC_URL);
  }

  async getProposals(): Promise<ProposalListItem[]> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/proposals`);
      if (!response.ok) throw new Error('Failed to fetch proposals');
      const data: ProposalListResponse = await response.json();
      return data.proposals;
    } catch (error) {
      console.error('Error fetching proposals:', error);
      return [];
    }
  }

  async getProposal(id: number): Promise<ProposalDetailResponse | null> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/proposals/${id}`);
      if (!response.ok) throw new Error('Failed to fetch proposal');
      return await response.json();
    } catch (error) {
      console.error('Error fetching proposal:', error);
      return null;
    }
  }
}

export const api = new GovernanceAPI();