import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

interface PoolMetadata {
  poolAddress: string;
  ticker: string;
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;
}

interface WhitelistStatus {
  isWhitelisted: boolean;
  pools: string[];
  poolsWithMetadata: Array<{
    poolAddress: string;
    metadata: PoolMetadata | null;
  }>;
  isLoading: boolean;
  error: string | null;
}

export function useWhitelist(walletAddress: string | null) {
  const [status, setStatus] = useState<WhitelistStatus>({
    isWhitelisted: false,
    pools: [],
    poolsWithMetadata: [],
    isLoading: false,
    error: null
  });

  useEffect(() => {
    if (!walletAddress) {
      setStatus({
        isWhitelisted: false,
        pools: [],
        poolsWithMetadata: [],
        isLoading: false,
        error: null
      });
      return;
    }

    const checkWhitelist = async () => {
      setStatus(prev => ({ ...prev, isLoading: true, error: null }));

      try {
        const result = await api.checkWhitelistStatus(walletAddress);

        if (result) {
          setStatus({
            isWhitelisted: result.isWhitelisted,
            pools: result.pools,
            poolsWithMetadata: result.poolsWithMetadata,
            isLoading: false,
            error: null
          });
        } else {
          setStatus({
            isWhitelisted: false,
            pools: [],
            poolsWithMetadata: [],
            isLoading: false,
            error: 'Failed to check whitelist status'
          });
        }
      } catch (err) {
        setStatus({
          isWhitelisted: false,
          pools: [],
          poolsWithMetadata: [],
          isLoading: false,
          error: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    };

    checkWhitelist();
  }, [walletAddress]);

  return status;
}
