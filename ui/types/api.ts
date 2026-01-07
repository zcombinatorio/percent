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

// Backend status (what API returns)
export type BackendProposalStatus = 'Uninitialized' | 'Pending' | 'Finalized';

// UI status (what components expect) - transformed from backend status
export type UIProposalStatus = 'Pending' | 'Passed' | 'Failed';

// Keep ProposalStatus as alias for backward compatibility (uses UI format)
export type ProposalStatus = UIProposalStatus;

export interface ProposalListItem {
  id: number;
  title: string;
  description: string;
  status: ProposalStatus;
  winningMarketIndex: number | null;
  winningMarketLabel: string | null;
  createdAt: number;
  finalizedAt: number;
  passThresholdBps: number;
  markets: number;
  marketLabels?: string[];
  totalSupply?: number;
  baseDecimals: number;
  quoteDecimals: number;
  poolAddress?: string | null;
  poolName?: string;
  vaultPDA: string;
  // Futarchy-specific fields (new system)
  isFutarchy?: boolean;
  proposalPda?: string;
  metadataCid?: string | null;
  endsAt?: number | null;  // Timestamp when proposal voting ends (futarchy only)
}

export interface ProposalListResponse {
  proposals: ProposalListItem[];
}

export interface ProposalDetailResponse {
  moderatorId: number;
  id: number;
  title: string;
  description: string;
  status: ProposalStatus;
  winningMarketIndex: number | null;
  winningMarketLabel: string | null;
  winningBaseConditionalMint: string | null;
  winningQuoteConditionalMint: string | null;
  createdAt: number;
  finalizedAt: number;
  proposalLength: number;
  baseMint: string;
  quoteMint: string;
  spotPoolAddress?: string;
  totalSupply?: number;
  baseDecimals: number;
  quoteDecimals: number;
  markets: number;
  marketLabels?: string[];
  ammConfig: {
    initialBaseAmount: string;
    initialQuoteAmount: string;
  } | null;
  ammData: any | null;
  twapOracleState: any | null;
  vaultPDA: string;
}

