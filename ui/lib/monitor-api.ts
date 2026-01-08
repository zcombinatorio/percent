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
 * Monitor API client for futarchy proposal data
 * Uses the monitor server's history endpoints (cmb_ tables)
 */

const MONITOR_URL = process.env.NEXT_PUBLIC_MONITOR_URL || 'http://localhost:4000';

// ============================================================================
// Types
// ============================================================================

export interface FutarchyTWAPRecord {
  id: number;
  timestamp: string;
  twaps: string[];
}

export interface FutarchyTradeRecord {
  id: number;
  timestamp: string;
  market: number;
  trader: string;
  isBaseToQuote: boolean;
  amountIn: string;
  amountOut: string;
  feeAmount?: string;
  txSignature?: string;
}

export interface FutarchyVolumeRecord {
  proposalPda: string;
  totalVolume: string;
  totalTradeCount: number;
  byMarket: {
    market: number;
    volume: string;
    tradeCount: number;
  }[];
}

export interface FutarchyChartDataPoint {
  timestamp: string;
  market: number | 'spot';
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Build URL with optional date query parameters
 */
function buildUrl(path: string, params?: { from?: Date; to?: Date; limit?: number; interval?: string }): string {
  const url = new URL(path, MONITOR_URL);

  if (params?.from) {
    url.searchParams.set('from', params.from.toISOString());
  }
  if (params?.to) {
    url.searchParams.set('to', params.to.toISOString());
  }
  if (params?.limit) {
    url.searchParams.set('limit', params.limit.toString());
  }
  if (params?.interval) {
    url.searchParams.set('interval', params.interval);
  }

  return url.toString();
}

/**
 * Get TWAP history for a futarchy proposal
 */
export async function getFutarchyTWAP(
  proposalPda: string,
  from?: Date,
  to?: Date
): Promise<{ proposalPda: string; count: number; data: FutarchyTWAPRecord[] } | null> {
  try {
    const url = buildUrl(`/api/history/${proposalPda}/twap`, { from, to });
    const response = await fetch(url);

    if (!response.ok) {
      console.error('[monitor-api] Failed to fetch TWAP:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[monitor-api] Error fetching TWAP:', error);
    return null;
  }
}

/**
 * Get trade history for a futarchy proposal
 */
export async function getFutarchyTrades(
  proposalPda: string,
  from?: Date,
  to?: Date,
  limit: number = 100
): Promise<{ proposalPda: string; count: number; data: FutarchyTradeRecord[] } | null> {
  try {
    const url = buildUrl(`/api/history/${proposalPda}/trades`, { from, to, limit });
    const response = await fetch(url);

    if (!response.ok) {
      console.error('[monitor-api] Failed to fetch trades:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[monitor-api] Error fetching trades:', error);
    return null;
  }
}

/**
 * Get trade volume for a futarchy proposal
 */
export async function getFutarchyVolume(
  proposalPda: string,
  from?: Date,
  to?: Date
): Promise<FutarchyVolumeRecord | null> {
  try {
    const url = buildUrl(`/api/history/${proposalPda}/volume`, { from, to });
    const response = await fetch(url);

    if (!response.ok) {
      console.error('[monitor-api] Failed to fetch volume:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[monitor-api] Error fetching volume:', error);
    return null;
  }
}

/**
 * Get chart data (OHLCV) for a futarchy proposal
 */
export async function getFutarchyChartData(
  proposalPda: string,
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d',
  from?: Date,
  to?: Date
): Promise<{ proposalPda: string; interval: string; count: number; data: FutarchyChartDataPoint[] } | null> {
  try {
    const url = buildUrl(`/api/history/${proposalPda}/chart`, { from, to, interval });
    const response = await fetch(url);

    if (!response.ok) {
      console.error('[monitor-api] Failed to fetch chart data:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('[monitor-api] Error fetching chart data:', error);
    return null;
  }
}

/**
 * Get the monitor server URL (for SSE connections)
 */
export function getMonitorUrl(): string {
  return MONITOR_URL;
}
