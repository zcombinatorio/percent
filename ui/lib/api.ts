import { Connection } from '@solana/web3.js';
import type { ProposalListResponse, ProposalListItem, ProposalDetailResponse, UserBalancesResponse } from '@/types/api';
import { buildApiUrl } from './api-utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

class GovernanceAPI {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(RPC_URL);
  }

  async getProposals(poolAddress?: string, moderatorId?: number | string): Promise<ProposalListItem[]> {
    try {
      const params = poolAddress ? { poolAddress } : {};
      const url = buildApiUrl(API_BASE_URL, '/api/proposals', params, moderatorId);
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch proposals');
      const data: ProposalListResponse = await response.json();
      return data.proposals;
    } catch (error) {
      console.error('Error fetching proposals:', error);
      return [];
    }
  }

  async getPoolByName(name: string): Promise<{
    pool: {
      poolAddress: string;
      name: string;
      baseMint: string;
      quoteMint: string;
      baseDecimals: number;
      quoteDecimals: number;
      moderatorId: number;
      icon?: string;
    };
    isAuthorized?: boolean;
  } | null> {
    try {
      const url = buildApiUrl(API_BASE_URL, `/api/whitelist/pool/${name}`);
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch pool');
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching pool:', error);
      return null;
    }
  }

  async getPoolByNameWithAuth(name: string, walletAddress: string): Promise<{
    pool: {
      poolAddress: string;
      name: string;
      baseMint: string;
      quoteMint: string;
      baseDecimals: number;
      quoteDecimals: number;
      moderatorId: number;
      icon?: string;
    };
    isAuthorized: boolean;
  } | null> {
    try {
      const url = buildApiUrl(API_BASE_URL, `/api/whitelist/pool/${name}`, { wallet: walletAddress });
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error('Failed to fetch pool');
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching pool with auth:', error);
      return null;
    }
  }

  async getProposal(id: number): Promise<ProposalDetailResponse | null> {
    try {
      const url = buildApiUrl(API_BASE_URL, `/api/proposals/${id}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch proposal');
      return await response.json();
    } catch (error) {
      console.error('Error fetching proposal:', error);
      return null;
    }
  }

  async getUserBalances(proposalId: number, userAddress: string): Promise<UserBalancesResponse | null> {
    try {
      const url = buildApiUrl(API_BASE_URL, `/api/vaults/${proposalId}/getUserBalances`, { user: userAddress });
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch user balances');
      return await response.json();
    } catch (error) {
      console.error('Error fetching user balances:', error);
      return null;
    }
  }

  async getTWAP(proposalId: number): Promise<{ passTwap: number; failTwap: number } | null> {
    try {
      const url = buildApiUrl(API_BASE_URL, `/api/history/${proposalId}/twap`);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch TWAP');
      }
      const data = await response.json();

      // Get the most recent TWAP data (first element, matching LivePriceDisplay)
      if (data.data && data.data.length > 0) {
        const latest = data.data[0];
        return {
          passTwap: parseFloat(latest.passTwap),
          failTwap: parseFloat(latest.failTwap)
        };
      }
      return null;
    } catch (error) {
      console.error('Error fetching TWAP:', error);
      return null;
    }
  }

  async getChartData(
    proposalId: number,
    interval: string,
    from?: Date,
    to?: Date
  ): Promise<any> {
    try {
      const params: Record<string, any> = { interval };
      if (from) {
        params.from = from.toISOString();
      }
      if (to) {
        params.to = to.toISOString();
      }

      const url = buildApiUrl(API_BASE_URL, `/api/history/${proposalId}/chart`, params);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch chart data');
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching chart data:', error);
      return null;
    }
  }

  async getSwapQuote(
    proposalId: number,
    market: 'pass' | 'fail',
    isBaseToQuote: boolean,
    amountIn: string,
    slippageBps: number = 2000
  ): Promise<{
    swapInAmount: string;
    consumedInAmount: string;
    swapOutAmount: string;
    minSwapOutAmount: string;
    totalFee: string;
    priceImpact: number;
    slippageBps: number;
    inputMint: string;
    outputMint: string;
  } | null> {
    try {
      const params = {
        isBaseToQuote,
        amountIn,
        slippageBps
      };
      const url = buildApiUrl(API_BASE_URL, `/api/swap/${proposalId}/${market}/quote`, params);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch swap quote');
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching swap quote:', error);
      return null;
    }
  }

  async checkWhitelistStatus(walletAddress: string): Promise<{
    wallet: string;
    isWhitelisted: boolean;
    pools: string[];
    poolsWithMetadata: Array<{
      poolAddress: string;
      metadata: {
        poolAddress: string;
        name: string;
        baseMint: string;
        quoteMint: string;
        baseDecimals: number;
        quoteDecimals: number;
        moderatorId: number;
        icon?: string;
      } | null;
    }>;
  } | null> {
    try {
      const url = buildApiUrl(API_BASE_URL, '/api/whitelist/check', { wallet: walletAddress });
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to check whitelist status');
      return await response.json();
    } catch (error) {
      console.error('Error checking whitelist status:', error);
      return null;
    }
  }

  async createProposal(params: {
    title: string;
    description: string;
    proposalLength: number;
    creatorWallet: string;
  }): Promise<{
    moderatorId: number;
    id: number;
    title: string;
    description: string;
    status: string;
    createdAt: number;
    finalizedAt: number;
  } | null> {
    try {
      const apiKey = process.env.NEXT_PUBLIC_API_KEY;
      if (!apiKey) {
        throw new Error('API key not configured');
      }

      const url = buildApiUrl(API_BASE_URL, '/api/proposals', { moderatorId: '1' });
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': apiKey
        },
        body: JSON.stringify(params)
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create proposal');
      }
      return await response.json();
    } catch (error) {
      console.error('Error creating proposal:', error);
      throw error;
    }
  }
}

export const api = new GovernanceAPI();