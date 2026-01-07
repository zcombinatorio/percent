import { useState, useEffect, useCallback } from 'react';
import { buildApiUrl } from '@/lib/api-utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface MarketVolume {
  market: number;
  volume: string;
  volumeUsd: number;
  tradeCount: number;
}

interface VolumeResponse {
  moderatorId: number;
  proposalId: number;
  solPrice: number;
  totalVolume: string;
  totalVolumeUsd: number;
  totalTradeCount: number;
  byMarket: MarketVolume[];
}

interface UseMarketVolumeResult {
  volumeByMarket: Map<number, number>;
  totalVolumeUsd: number;
  totalTradeCount: number;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMarketVolume(
  proposalId: number | null,
  moderatorId?: number | string,
  isFutarchy?: boolean
): UseMarketVolumeResult {
  const [volumeByMarket, setVolumeByMarket] = useState<Map<number, number>>(new Map());
  const [totalVolumeUsd, setTotalVolumeUsd] = useState(0);
  const [totalTradeCount, setTotalTradeCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchVolume = useCallback(async () => {
    // Skip for futarchy DAOs - volume data not yet supported
    if (proposalId === null || isFutarchy) return;

    setLoading(true);
    setError(null);

    try {
      const url = buildApiUrl(API_BASE_URL, `/api/history/${proposalId}/volume`, {}, moderatorId);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error('Failed to fetch volume');
      }

      const data: VolumeResponse = await response.json();

      // Build map of market -> volumeUsd
      const volumeMap = new Map<number, number>();
      for (const m of data.byMarket) {
        volumeMap.set(m.market, m.volumeUsd);
      }

      setVolumeByMarket(volumeMap);
      setTotalVolumeUsd(data.totalVolumeUsd);
      setTotalTradeCount(data.totalTradeCount);
    } catch (err) {
      console.error('Error fetching volume:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch volume');
    } finally {
      setLoading(false);
    }
  }, [proposalId, moderatorId, isFutarchy]);

  useEffect(() => {
    // Skip for futarchy DAOs
    if (!proposalId || isFutarchy) {
      setVolumeByMarket(new Map());
      setTotalVolumeUsd(0);
      setTotalTradeCount(0);
      return;
    }

    fetchVolume();
  }, [proposalId, moderatorId, isFutarchy, fetchVolume]);

  return {
    volumeByMarket,
    totalVolumeUsd,
    totalTradeCount,
    loading,
    error,
    refetch: fetchVolume
  };
}
