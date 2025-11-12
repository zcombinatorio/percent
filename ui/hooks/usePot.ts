import { useState, useEffect, useCallback } from 'react';
import { buildApiUrl } from '@/lib/api-utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function usePot() {
  const [potSol, setPotSol] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPot = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const url = buildApiUrl(API_BASE_URL, '/api/leaderboard/pot');
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Failed to fetch pot: ${response.statusText}`);
      }

      const data = await response.json();
      setPotSol(parseFloat(data.totalProfitSol));
    } catch (err) {
      console.error('Error fetching pot:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch pot');
      setPotSol(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPot();

    // Refresh pot value every 30 seconds
    const interval = setInterval(fetchPot, 30000);

    return () => clearInterval(interval);
  }, [fetchPot]);

  return {
    potSol,
    loading,
    error,
    refetch: fetchPot
  };
}
