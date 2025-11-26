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

/**
 * API Adapter Layer
 *
 * Transforms backend responses (index-based multi-market system)
 * to UI-expected format (pass/fail terminology).
 *
 * Market Index Convention:
 *   0 = fail market
 *   1 = pass market
 */

import type {
  ProposalListItem,
  ProposalDetailResponse,
  UserBalancesResponse,
  BackendProposalStatus,
  UIProposalStatus,
  RawUserBalancesResponse,
} from '@/types/api';

// Market index constants
export const MARKET_INDEX = {
  FAIL: 0,
  PASS: 1,
} as const;

export type MarketType = 'pass' | 'fail';

/**
 * Convert UI market string to backend index
 */
export function marketToIndex(market: MarketType): number {
  return market === 'pass' ? MARKET_INDEX.PASS : MARKET_INDEX.FAIL;
}

/**
 * Convert backend market index to UI string
 */
export function indexToMarket(index: number): MarketType {
  return index === MARKET_INDEX.PASS ? 'pass' : 'fail';
}

/**
 * Transform backend status to UI status
 *
 * Backend: 'Uninitialized' | 'Pending' | 'Finalized'
 * UI: 'Pending' | 'Passed' | 'Failed'
 */
export function transformStatus(
  status: BackendProposalStatus,
  winningMarketIndex: number | null
): UIProposalStatus {
  if (status === 'Pending' || status === 'Uninitialized') {
    return 'Pending';
  }

  if (status === 'Finalized') {
    if (winningMarketIndex === MARKET_INDEX.PASS) {
      return 'Passed';
    }
    if (winningMarketIndex === MARKET_INDEX.FAIL) {
      return 'Failed';
    }
    // Fallback for edge cases
    return 'Failed';
  }

  return 'Pending';
}

/**
 * Transform a raw proposal list item to UI format
 * Note: Backend returns BackendProposalStatus but we transform to UIProposalStatus
 */
export function transformProposalListItem(raw: ProposalListItem): ProposalListItem {
  return {
    ...raw,
    status: transformStatus(raw.status as unknown as BackendProposalStatus, raw.winningMarketIndex),
  };
}

/**
 * Transform a raw proposal detail response to UI format
 * Note: Backend returns BackendProposalStatus but we transform to UIProposalStatus
 */
export function transformProposalDetail(raw: ProposalDetailResponse): ProposalDetailResponse {
  return {
    ...raw,
    status: transformStatus(raw.status as unknown as BackendProposalStatus, raw.winningMarketIndex),
  };
}

/**
 * Transform raw user balances to UI format with pass/fail named fields
 */
export function transformUserBalances(raw: RawUserBalancesResponse): UserBalancesResponse {
  return {
    proposalId: raw.proposalId,
    user: raw.user,
    base: {
      regular: raw.base.regular,
      // Named fields for legacy UI
      failConditional: raw.base.conditionalBalances[MARKET_INDEX.FAIL] || '0',
      passConditional: raw.base.conditionalBalances[MARKET_INDEX.PASS] || '0',
      // Keep array format for forward compatibility
      conditionalMints: raw.base.conditionalMints,
      conditionalBalances: raw.base.conditionalBalances,
    },
    quote: {
      regular: raw.quote.regular,
      // Named fields for legacy UI
      failConditional: raw.quote.conditionalBalances[MARKET_INDEX.FAIL] || '0',
      passConditional: raw.quote.conditionalBalances[MARKET_INDEX.PASS] || '0',
      // Keep array format for forward compatibility
      conditionalMints: raw.quote.conditionalMints,
      conditionalBalances: raw.quote.conditionalBalances,
    },
  };
}

/**
 * Transform raw TWAP history item to UI format
 */
export function transformTWAPHistoryItem(raw: { twaps: string[] }): { passTwap: number; failTwap: number } {
  return {
    failTwap: parseFloat(raw.twaps[MARKET_INDEX.FAIL] || '0'),
    passTwap: parseFloat(raw.twaps[MARKET_INDEX.PASS] || '0'),
  };
}

/**
 * Transform TWAP history array and get latest
 */
export function transformTWAPHistory(data: { twaps: string[] }[]): { passTwap: number; failTwap: number } | null {
  if (!data || data.length === 0) {
    return null;
  }
  // Get the most recent TWAP data (first element)
  return transformTWAPHistoryItem(data[0]);
}
