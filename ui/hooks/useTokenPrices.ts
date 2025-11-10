import { useState, useEffect } from 'react';

interface TokenPrices {
  sol: number;
  zc: number;
  loading: boolean;
  error: string | null;
}

const ZC_ADDRESS = 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC';
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function useTokenPrices(): TokenPrices {
  const [prices, setPrices] = useState<TokenPrices>({
    sol: 0,
    zc: 0,
    loading: true,
    error: null
  });

  useEffect(() => {
    const fetchPrices = async () => {
      try {
        // Fetch SOL price from our backend API (uses cached SolPriceService)
        // Fetch $ZC price from DexScreener
        const [solResponse, zcResponse] = await Promise.all([
          fetch(`${API_BASE_URL}/api/sol-price`),
          fetch(`https://api.dexscreener.com/latest/dex/tokens/${ZC_ADDRESS}`)
        ]);

        if (!solResponse.ok || !zcResponse.ok) {
          throw new Error('Failed to fetch token prices');
        }

        const solData = await solResponse.json();
        const zcData = await zcResponse.json();

        // Extract SOL price from API response
        const solPrice = solData.price || 150;

        // Extract $ZC price from DexScreener
        // DexScreener returns pairs, we need to find the most liquid one
        const zcPairs = zcData.pairs || [];
        let zcPrice = 0;
        
        if (zcPairs.length > 0) {
          // Sort by liquidity and take the highest
          const sortedPairs = zcPairs.sort((a: any, b: any) => 
            (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
          );
          zcPrice = parseFloat(sortedPairs[0]?.priceUsd || '0');
        }

        setPrices({
          sol: solPrice,
          zc: zcPrice,
          loading: false,
          error: null
        });
      } catch (error) {
        console.error('Error fetching token prices:', error);
        // Fallback prices if API fails
        setPrices({
          sol: 150, // Fallback SOL price
          zc: 0.01, // Fallback $ZC price
          loading: false,
          error: error instanceof Error ? error.message : 'Failed to fetch prices'
        });
      }
    };

    fetchPrices();
    // Disabled polling - using WebSocket for real-time prices
    // const interval = setInterval(fetchPrices, 30000);
    // return () => clearInterval(interval);
  }, []);

  return prices;
}