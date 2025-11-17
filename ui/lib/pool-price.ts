const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface AMMAmounts {
  initialBaseAmount: string;
  initialQuoteAmount: string;
}

/**
 * Fetch the current spot price from a pool
 * Returns price in SOL per base token
 */
export async function fetchPoolPrice(poolAddress: string): Promise<number> {
  // Fetch pool price from backend API
  const response = await fetch(`${API_BASE_URL}/api/pools/${poolAddress}/price`);

  if (!response.ok) {
    throw new Error('Failed to fetch pool price');
  }

  const data = await response.json();
  return data.price;
}

/**
 * Calculate initial AMM amounts based on spot price and SOL liquidity
 * Returns amounts in smallest units (lamports for SOL, smallest units for base token)
 */
export function calculateAMMAmounts(spotPrice: number, solAmount: number): AMMAmounts {
  // Convert SOL to lamports (9 decimals)
  const quoteAmountLamports = Math.floor(solAmount * 1e9);

  // Calculate base token amount based on spot price
  // If spotPrice is SOL per base token, then:
  // baseAmount = solAmount / spotPrice
  const baseTokens = solAmount / spotPrice;

  // Assume base token has 6 decimals (common for SPL tokens)
  // This will be adjusted by the calling code using actual decimals from pool metadata
  const baseAmountSmallestUnits = Math.floor(baseTokens * 1e6);

  return {
    initialBaseAmount: baseAmountSmallestUnits.toString(),
    initialQuoteAmount: quoteAmountLamports.toString(),
  };
}
