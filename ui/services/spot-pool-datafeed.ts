import {
  IBasicDataFeed,
  LibrarySymbolInfo,
  ResolutionString,
  Bar,
  HistoryCallback,
  SubscribeBarsCallback,
  PeriodParams,
} from '@/types/charting-library';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * TradingView Datafeed for Spot Market Pools
 * Provides real-time price data from Meteora spot pools
 */
export class SpotPoolDatafeed implements IBasicDataFeed {
  private poolAddress: string;
  private updateInterval: NodeJS.Timeout | null = null;
  private subscribers: Map<string, SubscribeBarsCallback> = new Map();
  private lastPrice: number = 0;

  constructor(poolAddress: string) {
    this.poolAddress = poolAddress;
  }

  /**
   * Called when the chart library is ready
   */
  onReady(callback: (config: any) => void): void {
    setTimeout(() => {
      callback({
        supported_resolutions: ['1', '5', '15', '60', '240', '1D'] as ResolutionString[],
        supports_marks: false,
        supports_timescale_marks: false,
        supports_time: true,
      });
    }, 0);
  }

  /**
   * Search symbols - not needed for spot pools
   */
  searchSymbols(): void {
    // Not implemented
  }

  /**
   * Resolve symbol information
   */
  resolveSymbol(
    symbolName: string,
    onResolve: (symbolInfo: LibrarySymbolInfo) => void,
    onError: (reason: string) => void
  ): void {
    const symbolInfo: LibrarySymbolInfo = {
      name: 'SPOT',
      description: 'Spot Market Price',
      type: 'crypto',
      session: '24x7',
      timezone: 'Etc/UTC',
      ticker: 'SPOT',
      exchange: 'METEORA',
      listed_exchange: 'METEORA',
      minmov: 1,
      pricescale: 1000000, // 6 decimal places
      has_intraday: true,
      has_daily: true,
      has_weekly_and_monthly: false,
      supported_resolutions: ['1', '5', '15', '60', '240', '1D'] as ResolutionString[],
      volume_precision: 2,
      data_status: 'streaming',
      format: 'price',
    };

    setTimeout(() => onResolve(symbolInfo), 0);
  }

  /**
   * Fetch historical bars - returns current price as flat line
   */
  async getBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: PeriodParams,
    onResult: HistoryCallback,
    onError: (reason: string) => void
  ): Promise<void> {
    try {
      // Fetch current price from the pool
      const url = `${API_BASE_URL}/api/pools/${this.poolAddress}/price`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const currentPrice = data.price;
      this.lastPrice = currentPrice;

      // Create a single bar with flat price (line chart)
      const { from, to } = periodParams;
      const bars: Bar[] = [];

      // Create bar at the start of the period
      bars.push({
        time: from * 1000,
        open: currentPrice,
        high: currentPrice,
        low: currentPrice,
        close: currentPrice,
        volume: 0,
      });

      // Create bar at current time if within period
      const now = Date.now();
      if (now >= from * 1000 && now <= to * 1000) {
        bars.push({
          time: now,
          open: currentPrice,
          high: currentPrice,
          low: currentPrice,
          close: currentPrice,
          volume: 0,
        });
      }

      onResult(bars, { noData: bars.length === 0 });
    } catch (error) {
      console.error('Error fetching spot pool price:', error);
      onError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Subscribe to real-time updates
   */
  subscribeBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: SubscribeBarsCallback,
    listenerGuid: string,
    onResetCacheNeededCallback: () => void
  ): void {
    this.subscribers.set(listenerGuid, onTick);

    // Poll for price updates every 5 seconds
    if (!this.updateInterval) {
      this.updateInterval = setInterval(async () => {
        try {
          const url = `${API_BASE_URL}/api/pools/${this.poolAddress}/price`;
          const response = await fetch(url);

          if (response.ok) {
            const data = await response.json();
            const newPrice = data.price;

            // Only update if price changed
            if (newPrice !== this.lastPrice) {
              this.lastPrice = newPrice;

              const bar: Bar = {
                time: Date.now(),
                open: newPrice,
                high: newPrice,
                low: newPrice,
                close: newPrice,
                volume: 0,
              };

              // Notify all subscribers
              this.subscribers.forEach((callback) => {
                callback(bar);
              });
            }
          }
        } catch (error) {
          console.error('Error polling spot pool price:', error);
        }
      }, 5000); // Poll every 5 seconds
    }
  }

  /**
   * Unsubscribe from real-time updates
   */
  unsubscribeBars(listenerGuid: string): void {
    this.subscribers.delete(listenerGuid);

    // Stop polling if no more subscribers
    if (this.subscribers.size === 0 && this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }
}
