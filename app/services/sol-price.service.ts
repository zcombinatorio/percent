/**
 * Service for fetching SOL/USD price from DexScreener
 */
export class SolPriceService {
  private static instance: SolPriceService;
  private priceCache: { price: number; timestamp: number } | null = null;
  private readonly CACHE_DURATION = 30000; // 30 seconds
  private readonly SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
  private readonly FALLBACK_PRICE = 150;

  private constructor() {}

  static getInstance(): SolPriceService {
    if (!SolPriceService.instance) {
      SolPriceService.instance = new SolPriceService();
    }
    return SolPriceService.instance;
  }

  /**
   * Fetch current SOL/USD price from DexScreener
   * Uses 30-second cache to avoid rate limiting
   */
  async getSolPrice(): Promise<number> {
    // Check cache
    if (this.priceCache && (Date.now() - this.priceCache.timestamp) < this.CACHE_DURATION) {
      return this.priceCache.price;
    }

    try {
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${this.SOL_ADDRESS}`
      );

      if (!response.ok) {
        console.warn('DexScreener API error, using fallback price');
        return this.FALLBACK_PRICE;
      }

      const data = await response.json() as any;
      const pairs = data.pairs || [];

      if (pairs.length === 0) {
        console.warn('No SOL pairs found, using fallback price');
        return this.FALLBACK_PRICE;
      }

      // Sort by liquidity and take the most liquid pair
      const sortedPairs = pairs.sort((a: any, b: any) =>
        (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      );

      const solPrice = parseFloat(sortedPairs[0]?.priceUsd || '0');

      if (!solPrice || isNaN(solPrice) || solPrice <= 0) {
        console.warn('Invalid SOL price, using fallback');
        return this.FALLBACK_PRICE;
      }

      // Cache the result
      this.priceCache = {
        price: solPrice,
        timestamp: Date.now()
      };

      return solPrice;
    } catch (error) {
      console.error('Error fetching SOL price:', error);
      return this.FALLBACK_PRICE;
    }
  }

  /**
   * Clear the price cache (useful for testing)
   */
  clearCache(): void {
    this.priceCache = null;
  }
}
