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

import { Connection } from '@solana/web3.js';
import type { ProposalListResponse, ProposalListItem, ProposalDetailResponse, UserBalancesResponse, RawUserBalancesResponse } from '@/types/api';
import { buildApiUrl } from './api-utils';
import { transformProposalListItem, transformProposalDetail, transformUserBalances, transformTWAPHistory } from './api-adapter';

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
      // Transform each proposal to UI format (Finalized -> Passed/Failed)
      return data.proposals.map(transformProposalListItem);
    } catch (error) {
      console.error('Error fetching proposals:', error);
      return [];
    }
  }

  async getPoolByName(name: string): Promise<{
    pool: {
      poolAddress: string;
      ticker: string;
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
      ticker: string;
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

  async getProposal(id: number, moderatorId?: number | string): Promise<ProposalDetailResponse | null> {
    try {
      const url = buildApiUrl(API_BASE_URL, `/api/proposals/${id}`, {}, moderatorId);
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch proposal');
      const data = await response.json();
      // Transform to UI format (Finalized -> Passed/Failed)
      return transformProposalDetail(data);
    } catch (error) {
      console.error('Error fetching proposal:', error);
      return null;
    }
  }

  async getUserBalances(proposalId: number, userAddress: string, moderatorId?: number | string): Promise<UserBalancesResponse | null> {
    try {
      const url = buildApiUrl(API_BASE_URL, `/api/vaults/${proposalId}/getUserBalances`, { user: userAddress }, moderatorId);
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch user balances');
      const data: RawUserBalancesResponse = await response.json();
      // Transform to UI format with pass/fail named fields
      return transformUserBalances(data);
    } catch (error) {
      console.error('Error fetching user balances:', error);
      return null;
    }
  }

  async getTWAP(proposalId: number, moderatorId?: number | string): Promise<{ passTwap: number; failTwap: number } | null> {
    try {
      const url = buildApiUrl(API_BASE_URL, `/api/history/${proposalId}/twap`, {}, moderatorId);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch TWAP');
      }
      const data = await response.json();

      // Transform backend twaps[] array to UI passTwap/failTwap format
      if (data.data && data.data.length > 0) {
        return transformTWAPHistory(data.data);
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
    to?: Date,
    moderatorId?: number | string
  ): Promise<any> {
    try {
      const params: Record<string, any> = { interval };
      if (from) {
        params.from = from.toISOString();
      }
      if (to) {
        params.to = to.toISOString();
      }

      const url = buildApiUrl(API_BASE_URL, `/api/history/${proposalId}/chart`, params, moderatorId);
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
    market: number,  // Numeric market index (0-3 for quantum markets)
    isBaseToQuote: boolean,
    amountIn: string,
    slippageBps: number = 2000,
    moderatorId?: number | string
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
      // Market is already a numeric index, pass directly to backend
      const params = {
        isBaseToQuote,
        amountIn,
        slippageBps
      };
      const url = buildApiUrl(API_BASE_URL, `/api/swap/${proposalId}/${market}/quote`, params, moderatorId);

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
        ticker: string;
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
    creatorSignature?: string;
    attestationMessage?: string;
    spotPoolAddress?: string;
    moderatorId?: number | string;
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

      const url = buildApiUrl(API_BASE_URL, '/api/proposals', {}, params.moderatorId);
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