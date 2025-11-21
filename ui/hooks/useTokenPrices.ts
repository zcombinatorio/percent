import { useState, useEffect } from 'react';

interface TokenPrices {
  sol: number;
  baseToken: number; // Dynamic token price (ZC, OOGWAY, etc.)
  loading: boolean;
  error: string | null;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function useTokenPrices(baseMint?: string | null): TokenPrices {
  const [prices, setPrices] = useState<TokenPrices>({
    sol: 0,
    baseToken: 0,
    loading: true,
    error: null
  });

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        // Always fetch SOL price
        const solResponse = await fetch(`${API_BASE_URL}/api/sol-price`);

        if (!solResponse.ok) {
          throw new Error('Failed to fetch SOL price');
        }

        const solData = await solResponse.json();
        const solPrice = solData.price || 150;

        // Fetch base token price from DexScreener (if baseMint provided)
        let baseTokenPrice = 0;

        if (baseMint) {
          try {
            const tokenResponse = await fetch(
              `https://api.dexscreener.com/latest/dex/tokens/${baseMint}`
            );

            if (tokenResponse.ok) {
              const tokenData = await tokenResponse.json();
              const tokenPairs = tokenData.pairs || [];

              if (tokenPairs.length > 0) {
                // Sort by liquidity and take the highest
                const sortedPairs = tokenPairs.sort((a: unknown, b: unknown) => {
                  const aLiq = (a as { liquidity?: { usd?: number } })?.liquidity?.usd || 0;
                  const bLiq = (b as { liquidity?: { usd?: number } })?.liquidity?.usd || 0;
                  return bLiq - aLiq;
                });
                baseTokenPrice = parseFloat(
                  (sortedPairs[0] as { priceUsd?: string })?.priceUsd || '0'
                );
              }
            }
          } catch {
            // Token price fetch failed - use 0
            console.warn(`Could not fetch price for token ${baseMint}`);
          }
        }

        setPrices({
          sol: solPrice,
          baseToken: baseTokenPrice,
          loading: false,
          error: null
        });
      } catch (error) {
        console.error('Error fetching token prices:', error);
        // Fallback prices if API fails
        setPrices({
          sol: 150, // Fallback SOL price
          baseToken: 0, // No fallback for unknown token
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch prices'
        });
      }
    };

    fetchPrices();
    // Disabled polling - using WebSocket for real-time prices
    // const interval = setInterval(fetchPrices, 30000);
    // return () => clearInterval(interval);
  }, [baseMint]);

  return prices;
}
