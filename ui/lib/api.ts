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
import type { ProposalListResponse, ProposalListItem, ProposalDetailResponse } from '@/types/api';
import { buildApiUrl } from './api-utils';
import { transformProposalListItem, transformProposalDetail, transformTWAPHistory } from './api-adapter';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

// Zcombinator API for futarchy DAOs (new system)
const ZCOMBINATOR_API_URL = process.env.NEXT_PUBLIC_ZCOMBINATOR_API_URL || 'https://api.zcombinator.io';

/**
 * DAO data returned from zcombinator API
 */
export interface ZcombinatorDAO {
  id: number;
  dao_pda: string;
  dao_name: string;
  moderator_pda: string;
  owner_wallet: string;
  admin_wallet: string;
  token_mint: string;
  pool_address: string;
  pool_type: 'damm' | 'dlmm';
  quote_mint: string;
  treasury_cosigner: string;
  parent_dao_id: number | null;
  dao_type: 'parent' | 'child';
  created_at: string;
  proposer_token_threshold: number | null;
  withdrawal_percentage: number;
  treasury_vault: string;
  mint_vault: string;
  stats: {
    proposerCount: number;
    childDaoCount: number;
    proposalCount?: number; // undefined until cache is populated
  };
  // Verification status for display on projects page
  verified?: boolean;
  icon?: string;
}

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

  /**
   * Fetch all proposals from both old system (ZC, OOGWAY, SURF) and new futarchy DAOs
   * Used by the /markets page to show all proposals across all tokens
   */
  async getAllProposals(): Promise<Array<ProposalListItem & {
    moderatorId: number;
    tokenTicker: string;
    tokenIcon: string | null;
    // Futarchy-specific fields
    isFutarchy?: boolean;
    daoPda?: string;
    daoName?: string;
  }>> {
    // Fetch from both systems in parallel
    const [oldSystemProposals, futarchyProposals] = await Promise.all([
      this.getOldSystemProposals(),
      this.getFutarchyProposals(),
    ]);

    // Merge and return combined results
    return [...oldSystemProposals, ...futarchyProposals];
  }

  /**
   * Fetch proposals from old system (ZC, OOGWAY, SURF)
   */
  private async getOldSystemProposals(): Promise<Array<ProposalListItem & {
    moderatorId: number;
    tokenTicker: string;
    tokenIcon: string | null;
    isFutarchy: false;
  }>> {
    try {
      const url = buildApiUrl(API_BASE_URL, '/api/proposals/all');
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch all proposals from old system');
      }
      const data = await response.json();
      // Transform each proposal to UI format (Finalized -> Passed/Failed)
      return data.proposals.map((p: any) => ({
        ...transformProposalListItem(p),
        moderatorId: p.moderatorId,
        tokenTicker: p.tokenTicker,
        tokenIcon: p.tokenIcon,
        isFutarchy: false as const,
      }));
    } catch (error) {
      console.error('[api.getOldSystemProposals] Error:', error);
      return [];
    }
  }

  /**
   * Fetch proposals from all verified futarchy DAOs
   */
  private async getFutarchyProposals(): Promise<Array<ProposalListItem & {
    moderatorId: number;
    tokenTicker: string;
    tokenIcon: string | null;
    isFutarchy: true;
    daoPda: string;
    daoName: string;
  }>> {
    try {
      const response = await fetch(`${ZCOMBINATOR_API_URL}/dao/proposals/all`);
      if (!response.ok) {
        throw new Error('Failed to fetch proposals from zcombinator');
      }
      const data = await response.json() as { proposals: Array<{
        id: number;
        proposalPda: string;
        title: string;
        description: string;
        options: string[];
        status: 'Pending' | 'Passed' | 'Failed';
        createdAt: number;
        endsAt: number | null;
        finalizedAt: number | null;
        metadataCid: string | null;
        daoPda: string;
        daoName: string;
        tokenMint: string;
        tokenIcon: string | null;
      }> };

      // Transform to match old system format
      return data.proposals.map(p => ({
        id: p.id,
        title: p.title,
        description: p.description,
        status: p.status,
        createdAt: p.createdAt,
        endsAt: p.endsAt,
        finalizedAt: p.finalizedAt || 0,
        winningMarketIndex: p.status === 'Passed' ? 0 : p.status === 'Failed' ? 1 : null,
        winningMarketLabel: p.status === 'Passed' ? 'Pass' : p.status === 'Failed' ? 'Fail' : null,
        passThresholdBps: 5000,
        markets: 2,
        marketLabels: p.options.length > 0 ? p.options : ['Pass', 'Fail'],
        baseDecimals: 6,
        quoteDecimals: 9,
        vaultPDA: '',
        proposalPda: p.proposalPda,
        metadataCid: p.metadataCid,
        // Fields for markets page
        moderatorId: 0, // Not applicable for futarchy
        tokenTicker: p.daoName,
        tokenIcon: p.tokenIcon,
        isFutarchy: true as const,
        daoPda: p.daoPda,
        daoName: p.daoName,
      }));
    } catch (error) {
      console.error('[api.getFutarchyProposals] Error:', error);
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
      minTokenBalance?: number;
      // Futarchy-specific fields (new system)
      isFutarchy?: boolean;
      moderatorPda?: string;
      daoPda?: string;
      poolType?: 'damm' | 'dlmm';
      daoType?: 'parent' | 'child';
      parentDaoId?: number | null;
    };
    isAuthorized?: boolean;
    authMethod?: 'whitelist' | 'token_balance';
  } | null> {
    // First, try zcombinator for futarchy DAOs (new system)
    // This avoids CORS errors when running locally against production old system
    try {
      const dao = await this.getZcombinatorDaoByName(name);
      if (dao) {
        return {
          pool: {
            poolAddress: dao.pool_address,
            ticker: dao.dao_name,
            baseMint: dao.token_mint,
            quoteMint: dao.quote_mint || 'So11111111111111111111111111111111111111112',
            baseDecimals: 6, // Default for most tokens
            quoteDecimals: 9, // SOL decimals
            moderatorId: dao.id,
            icon: dao.icon,
            // Futarchy-specific fields
            isFutarchy: true,
            moderatorPda: dao.moderator_pda,
            daoPda: dao.dao_pda,
            poolType: dao.pool_type,
            daoType: dao.dao_type,
            parentDaoId: dao.parent_dao_id,
          },
          isAuthorized: true, // Futarchy DAOs are permissionless for trading
        };
      }
    } catch (error) {
      console.error('Error fetching DAO from zcombinator:', error);
      // Continue to try old system
    }

    // Fallback: try the old system (production os-percent)
    try {
      const url = buildApiUrl(API_BASE_URL, `/api/whitelist/pool/${name}`);
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
      // If not 404, it's a real error
      if (response.status !== 404) {
        throw new Error('Failed to fetch pool');
      }
    } catch (error) {
      console.error('Error fetching pool from old system:', error);
    }

    return null;
  }

  /**
   * Fetch a DAO from zcombinator API by name
   */
  private async getZcombinatorDaoByName(name: string): Promise<ZcombinatorDAO | null> {
    try {
      const response = await fetch(`${ZCOMBINATOR_API_URL}/dao`);
      if (!response.ok) {
        console.warn('[getZcombinatorDaoByName] Failed to fetch DAOs from zcombinator');
        return null;
      }

      const data = await response.json() as { daos: ZcombinatorDAO[] };

      // Find DAO by name (case-insensitive)
      const dao = data.daos.find(d =>
        d.dao_name.toLowerCase() === name.toLowerCase()
      );

      return dao || null;
    } catch (error) {
      console.error('[getZcombinatorDaoByName] Error:', error);
      return null;
    }
  }

  /**
   * Fetch all DAOs from zcombinator API
   */
  async getZcombinatorDaos(): Promise<ZcombinatorDAO[]> {
    try {
      const response = await fetch(`${ZCOMBINATOR_API_URL}/dao`);
      if (!response.ok) {
        throw new Error('Failed to fetch DAOs from zcombinator');
      }
      const data = await response.json() as { daos: ZcombinatorDAO[] };
      return data.daos;
    } catch (error) {
      console.error('[getZcombinatorDaos] Error:', error);
      return [];
    }
  }

  /**
   * Fetch proposals for a futarchy DAO from zcombinator API
   * Returns proposals in the same format as the old system for UI compatibility
   */
  async getZcombinatorProposals(daoPda: string): Promise<ProposalListItem[]> {
    try {
      const response = await fetch(`${ZCOMBINATOR_API_URL}/dao/${daoPda}/proposals`);
      if (!response.ok) {
        throw new Error('Failed to fetch proposals from zcombinator');
      }
      const data = await response.json() as { proposals: Array<{
        id: number;
        proposalPda: string;
        title: string;
        description: string;
        options: string[];
        status: 'Setup' | 'Pending' | 'Passed' | 'Failed';
        createdAt: number;
        endsAt: number | null;
        finalizedAt: number | null;
        metadataCid: string | null;
      }> };

      // Filter out Setup proposals (not yet launched) and transform to match old system format
      return data.proposals
        .filter((p): p is typeof p & { status: 'Pending' | 'Passed' | 'Failed' } => p.status !== 'Setup')
        .map(p => ({
        id: p.id,
        title: p.title,
        description: p.description,
        status: p.status,
        createdAt: p.createdAt,
        endsAt: p.endsAt,
        finalizedAt: p.finalizedAt || 0,
        // Default values for fields not applicable to futarchy
        winningMarketIndex: p.status === 'Passed' ? 0 : p.status === 'Failed' ? 1 : null,
        winningMarketLabel: p.status === 'Passed' ? 'Pass' : p.status === 'Failed' ? 'Fail' : null,
        passThresholdBps: 5000, // 50% default
        markets: 2, // Pass/Fail
        marketLabels: p.options.length > 0 ? p.options : ['Pass', 'Fail'],
        baseDecimals: 6, // Default
        quoteDecimals: 9, // SOL decimals
        vaultPDA: '', // Not applicable to futarchy
        // Futarchy-specific fields
        isFutarchy: true,
        proposalPda: p.proposalPda,
        metadataCid: p.metadataCid,
      }));
    } catch (error) {
      console.error('[getZcombinatorProposals] Error:', error);
      return [];
    }
  }

  /**
   * Get a single proposal from zcombinator API by PDA.
   * Uses read-through cache: reads from chain, caches if not already cached.
   */
  async getZcombinatorProposal(proposalPda: string): Promise<{
    id: number;
    proposalPda: string;
    title: string;
    description: string;
    options: string[];
    status: 'Setup' | 'Pending' | 'Passed' | 'Failed';
    numOptions: number;
    createdAt: number;
    endsAt: number;
    warmupEndsAt: number;
    moderator: string;
    creator: string;
    vault: string;
    baseMint: string;
    quoteMint: string;
    pools: string[];
    metadataCid: string | null;
    daoPda: string | null;
    daoId: number | null;
    config: {
      length: number;
      warmupDuration: number;
      marketBias: number;
      fee: number;
    };
  } | null> {
    try {
      const response = await fetch(`${ZCOMBINATOR_API_URL}/dao/proposal/${proposalPda}`);
      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }
        throw new Error('Failed to fetch proposal from zcombinator');
      }
      return await response.json();
    } catch (error) {
      console.error('[getZcombinatorProposal] Error:', error);
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
      minTokenBalance?: number;
    };
    isAuthorized: boolean;
    authMethod?: 'whitelist' | 'token_balance';
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
        minTokenBalance?: number;
      } | null;
      authMethod?: 'whitelist' | 'token_balance';
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