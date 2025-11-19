'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

interface PoolMetadata {
  poolAddress: string;
  ticker: string;
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  moderatorId: number;
  icon?: string;
}

interface TokenContextValue {
  tokenSlug: string;
  poolAddress: string | null;
  poolMetadata: PoolMetadata | null;
  // Convenience getters for common values
  baseMint: string | null;
  baseDecimals: number;
  tokenSymbol: string;
  moderatorId: number | null;
  icon: string | null;
  isLoading: boolean;
  error: string | null;
}

const TokenContext = createContext<TokenContextValue | null>(null);

interface TokenProviderProps {
  tokenSlug: string;
  children: ReactNode;
}

export function TokenProvider({ tokenSlug, children }: TokenProviderProps) {
  const router = useRouter();
  const [poolMetadata, setPoolMetadata] = useState<PoolMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPoolMetadata = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await api.getPoolByName(tokenSlug);

        if (!result) {
          // Pool not found, redirect to default (zc)
          setError('Pool not found');
          router.replace('/zc');
          return;
        }

        setPoolMetadata(result.pool);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load pool');
        // Redirect to default on error
        router.replace('/zc');
      } finally {
        setIsLoading(false);
      }
    };

    fetchPoolMetadata();
  }, [tokenSlug, router]);

  const value: TokenContextValue = {
    tokenSlug,
    poolAddress: poolMetadata?.poolAddress || null,
    poolMetadata,
    // Convenience getters
    baseMint: poolMetadata?.baseMint || null,
    baseDecimals: poolMetadata?.baseDecimals || 6, // Default to 6 if not loaded
    tokenSymbol: poolMetadata?.ticker?.toUpperCase() || tokenSlug.toUpperCase(),
    moderatorId: poolMetadata?.moderatorId || null,
    icon: poolMetadata?.icon || null,
    isLoading,
    error,
  };

  return (
    <TokenContext.Provider value={value}>
      {children}
    </TokenContext.Provider>
  );
}

export function useTokenContext() {
  const context = useContext(TokenContext);
  if (!context) {
    throw new Error('useTokenContext must be used within TokenProvider');
  }
  return context;
}

// Helper hook for pages that need pool info but should work without context
export function useOptionalTokenContext() {
  return useContext(TokenContext);
}
