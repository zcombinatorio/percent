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

export type ProposalStatus = 'Pending' | 'Passed' | 'Failed' | 'Executed';

export interface ProposalListItem {
  id: number;
  title: string;
  description: string;
  status: ProposalStatus;
  createdAt: number;
  finalizedAt: number;
  passThresholdBps: number;
  totalSupply?: number;
  poolAddress?: string | null;
  poolName?: string;
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
  createdAt: number;
  finalizedAt: number;
  proposalStatus: ProposalStatus;
  proposalLength: number;
  baseMint: string;
  quoteMint: string;
  authority: string;
  spotPoolAddress?: string;
  totalSupply?: number;
  ammConfig: {
    initialBaseAmount: string;
    initialQuoteAmount: string;
  } | null;
  passAmmState: any | null;
  failAmmState: any | null;
  baseVaultState: any | null;
  quoteVaultState: any | null;
  twapOracleState: any | null;
}

export interface UserBalancesResponse {
  proposalId: number;
  user: string;
  base: {
    regular: string;
    passConditional: string;
    failConditional: string;
  };
  quote: {
    regular: string;
    passConditional: string;
    failConditional: string;
  };
}