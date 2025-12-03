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
 * Proposal Market Overrides
 *
 * Some proposals were created with incorrect market counts that need to be
 * corrected in the UI. This module provides utilities to filter out extra
 * markets for specific proposals.
 *
 * Structure: { moderatorId: { proposalId: maxMarkets } }
 */
export const PROPOSAL_MARKET_OVERRIDES: Record<string, Record<number, number>> = {
  // Proposal 25 on ZC (moderatorId 2) was created with 3 markets by mistake
  // We need to filter it to only show 2 markets (indices 0 and 1)
  '2': { 25: 2 },
};

/**
 * Get the effective market count for a proposal, applying any overrides
 */
export function getEffectiveMarketCount(
  moderatorId: number | string | null | undefined,
  proposalId: number,
  actualMarketCount: number
): number {
  const modIdStr = moderatorId?.toString();
  if (!modIdStr) return actualMarketCount;

  const overrides = PROPOSAL_MARKET_OVERRIDES[modIdStr];
  if (overrides && overrides[proposalId] !== undefined) {
    return Math.min(actualMarketCount, overrides[proposalId]);
  }
  return actualMarketCount;
}

/**
 * Filter an array of market data to the effective market count
 */
export function filterMarketData<T>(
  data: T[],
  moderatorId: number | string | null | undefined,
  proposalId: number
): T[] {
  const effectiveCount = getEffectiveMarketCount(moderatorId, proposalId, data.length);
  return data.slice(0, effectiveCount);
}
