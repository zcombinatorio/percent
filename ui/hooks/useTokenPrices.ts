import { useState, useEffect } from 'react';

interface TokenPrices {
  sol: number;
  oogway: number;
  loading: boolean;
  error: string | null;
}

const OOGWAY_ADDRESS = 'C7MGcMnN8cXUkj8JQuMhkJZh6WqY2r8QnT3AUfKTkrix';

export function useTokenPrices(): TokenPrices {
  const [prices, setPrices] = useState<TokenPrices>({
    sol: 0,
    oogway: 0,
    loading: true,
    error: null
  });

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        // Fetch both SOL and $oogway prices
        const [solResponse, oogwayResponse] = await Promise.all([
          fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'),
          fetch(`https://api.dexscreener.com/latest/dex/tokens/${OOGWAY_ADDRESS}`)
        ]);

        if (!solResponse.ok || !oogwayResponse.ok) {
          throw new Error('Failed to fetch token prices');
        }

        const solData = await solResponse.json();
        const oogwayData = await oogwayResponse.json();

        // Extract SOL price from CoinGecko
        const solPrice = solData.solana?.usd || 0;

        // Extract $oogway price from DexScreener
        // DexScreener returns pairs, we need to find the most liquid one
        const oogwayPairs = oogwayData.pairs || [];
        let oogwayPrice = 0;
        
        if (oogwayPairs.length > 0) {
          // Sort by liquidity and take the highest
          const sortedPairs = oogwayPairs.sort((a: any, b: any) => 
            (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
          );
          oogwayPrice = parseFloat(sortedPairs[0]?.priceUsd || '0');
        }

        setPrices({
          sol: solPrice,
          oogway: oogwayPrice,
          loading: false,
          error: null
        });
      } catch (error) {
        console.error('Error fetching token prices:', error);
        // Fallback prices if API fails
        setPrices({
          sol: 180, // Fallback SOL price
          oogway: 0.01, // Fallback $oogway price
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch prices'
        });
      }
    };

    fetchPrices();
    // Refresh prices every 30 seconds
    const interval = setInterval(fetchPrices, 30000);

    return () => clearInterval(interval);
  }, []);

  return prices;
}