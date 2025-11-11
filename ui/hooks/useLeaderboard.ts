import { useState, useEffect, useCallback } from 'react';
import { useProposals } from './useProposals';
import { useTokenPrices } from './useTokenPrices';
import { buildApiUrl } from '@/lib/api-utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Trade {
  userAddress: string;
  isBaseToQuote: boolean;
  amountIn: string;
  market: 'pass' | 'fail';
}

export interface LeaderboardEntry {
  walletAddress: string;
  volume: number; // USD volume
}

export function useLeaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [totalVolume, setTotalVolume] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { proposals, loading: proposalsLoading } = useProposals();
  const { sol: solPrice, zc: zcPrice } = useTokenPrices();

  const fetchLeaderboard = useCallback(async () => {
    console.log('[Leaderboard] Fetch attempt:', {
      proposalsLoading,
      proposalsCount: proposals.length,
      solPrice,
      zcPrice
    });

    if (proposalsLoading) {
      console.log('[Leaderboard] Waiting for proposals to load...');
      return;
    }

    if (!proposals.length) {
      console.log('[Leaderboard] No proposals found');
      setLoading(false);
      return;
    }

    if (!solPrice || !zcPrice) {
      console.log('[Leaderboard] Waiting for token prices...');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch trades for all proposals in parallel
      const tradesPromises = proposals.map(async (proposal) => {
        try {
          const url = buildApiUrl(API_BASE_URL, `/api/history/${proposal.id}/trades`, {
            limit: 10000
          });
          const response = await fetch(url);
          if (!response.ok) {
            console.warn(`Failed to fetch trades for proposal ${proposal.id}`);
            return [];
          }
          const data = await response.json();
          return data.data || [];
        } catch (err) {
          console.warn(`Error fetching trades for proposal ${proposal.id}:`, err);
          return [];
        }
      });

      const tradesArrays = await Promise.all(tradesPromises);
      const allTrades: Trade[] = tradesArrays.flat();

      console.log('Total trades fetched:', allTrades.length);

      // Aggregate volumes by wallet address
      const volumeMap = new Map<string, number>();

      allTrades.forEach((trade) => {
        const amount = parseFloat(trade.amountIn);

        // Calculate USD value based on token used
        // isBaseToQuote = true → used ZC (base token)
        // isBaseToQuote = false → used SOL (quote token)
        const volumeUSD = trade.isBaseToQuote
          ? amount * zcPrice
          : amount * solPrice;

        const currentVolume = volumeMap.get(trade.userAddress) || 0;
        volumeMap.set(trade.userAddress, currentVolume + volumeUSD);
      });

      // Convert to array and sort by volume descending
      const leaderboardEntries = Array.from(volumeMap.entries())
        .map(([walletAddress, volume]) => ({
          walletAddress,
          volume
        }))
        .sort((a, b) => b.volume - a.volume);

      // Calculate total volume across all traders
      const totalVolumeSum = leaderboardEntries.reduce((sum, entry) => sum + entry.volume, 0);

      console.log('Leaderboard entries:', leaderboardEntries.length);
      console.log('Total volume:', totalVolumeSum);
      setEntries(leaderboardEntries);
      setTotalVolume(totalVolumeSum);
    } catch (err) {
      console.error('Error fetching leaderboard:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch leaderboard');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [proposals, proposalsLoading, solPrice, zcPrice]);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  return {
    entries,
    totalVolume,
    loading: loading || proposalsLoading,
    error,
    refetch: fetchLeaderboard
  };
}
