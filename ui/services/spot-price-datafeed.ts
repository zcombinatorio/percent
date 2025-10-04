import {
  IBasicDataFeed,
  LibrarySymbolInfo,
  ResolutionString,
  Bar,
  HistoryCallback,
  SubscribeBarsCallback,
  PeriodParams,
} from '@/public/charting_library/charting_library';
import { getPriceStreamService, PriceUpdate } from './price-stream.service';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface ChartDataPoint {
  timestamp: string;
  market: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

/**
 * TradingView Datafeed for Spot Market Price
 * Provides historical and real-time spot price data as a line overlay
 * Converts spot pool price to market cap USD for comparison with conditional markets
 */
export class SpotPriceDatafeed implements IBasicDataFeed {
  private proposalId: number;
  private spotPoolAddress: string;
  private totalSupply: number;
  private subscribers: Map<string, SubscribeBarsCallback> = new Map();
  private latestPrice: number = 0;
  private solPrice: number = 0;

  constructor(proposalId: number, spotPoolAddress: string, totalSupply: number) {
    this.proposalId = proposalId;
    this.spotPoolAddress = spotPoolAddress;
    this.totalSupply = totalSupply;
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
   * Search symbols - not needed for our use case
   */
  searchSymbols(): void {
    // Not implemented - we don't need symbol search
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
      name: 'SPOT-MARKET',
      description: 'Spot Market Cap (USD)',
      type: 'crypto',
      session: '24x7',
      timezone: 'Etc/UTC',
      ticker: 'SPOT-MARKET',
      exchange: 'METEORA',
      listed_exchange: 'METEORA',
      minmov: 1,
      pricescale: 1, // USD market cap values
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
   * Fetch historical bars
   */
  async getBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    periodParams: PeriodParams,
    onResult: HistoryCallback,
    onError: (reason: string) => void
  ): Promise<void> {
    try {
      const { from, to } = periodParams;

      console.log(`[SPOT] getBars called:`, {
        from: new Date(from * 1000).toISOString(),
        to: new Date(to * 1000).toISOString(),
      });

      // Map TradingView resolution to our API interval format
      const intervalMap: Record<string, string> = {
        '1': '1m',
        '5': '5m',
        '15': '15m',
        '60': '1h',
        '240': '4h',
        '1D': '1d',
        'D': '1d',
      };

      const interval = intervalMap[resolution] || '1m';
      const fromDate = new Date(from * 1000).toISOString();
      const toDate = new Date(to * 1000).toISOString();

      // Fetch spot price data from the history API
      const url = `${API_BASE_URL}/api/history/${this.proposalId}/chart?interval=${interval}&from=${fromDate}&to=${toDate}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (!data.data || data.data.length === 0) {
        console.log(`[SPOT] No data from API, returning noData=true`);
        onResult([], { noData: true });
        return;
      }

      // Filter for spot market data and convert to bars
      // For spot price (line chart), all OHLC values are the same
      const bars: Bar[] = data.data
        .filter((item: ChartDataPoint) => item.market === 'spot')
        .map((item: ChartDataPoint) => {
          const price = parseFloat(item.close); // Use close price as the spot price
          return {
            time: new Date(item.timestamp).getTime(),
            open: price,
            high: price,
            low: price,
            close: price,
            volume: 0, // No volume for spot line
          };
        })
        .filter((bar: Bar) => !isNaN(bar.close))
        .sort((a: Bar, b: Bar) => a.time - b.time);

      console.log(`[SPOT] Returning ${bars.length} bars`);

      if (bars.length === 0) {
        console.log(`[SPOT] No bars after filtering, returning noData=true`);
        onResult([], { noData: true });
        return;
      }

      // Store the latest price for real-time updates
      if (bars.length > 0) {
        this.latestPrice = bars[bars.length - 1].close;
      }

      onResult(bars, { noData: false });
    } catch (error) {
      console.error('[SPOT] Error fetching bars:', error);
      onError(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Subscribe to real-time updates
   */
  async subscribeBars(
    symbolInfo: LibrarySymbolInfo,
    resolution: ResolutionString,
    onTick: SubscribeBarsCallback,
    listenerGuid: string,
    onResetCacheNeededCallback: () => void
  ): Promise<void> {
    console.log(`[SPOT] subscribeBars called for resolution ${resolution}, listenerGuid: ${listenerGuid}`);

    this.subscribers.set(listenerGuid, onTick);

    // Fetch SOL price for market cap calculation
    await this.fetchSolPrice();

    // Subscribe to spot pool price updates via WebSocket
    // Note: We subscribe to the spot pool's base token for price updates
    const priceService = getPriceStreamService();

    // Create a callback to handle price updates
    const handlePriceUpdate = (update: PriceUpdate) => {
      try {
        // Convert spot price to market cap USD
        // price is in SOL, so multiply by totalSupply and solPrice
        const spotPriceInSol = update.price;
        const marketCapUSD = spotPriceInSol * this.totalSupply * this.solPrice;

        // Only update if price has changed
        if (marketCapUSD === this.latestPrice) {
          return;
        }

        this.latestPrice = marketCapUSD;

        // Create a bar with flat OHLC (line chart)
        const bar: Bar = {
          time: update.timestamp,
          open: marketCapUSD,
          high: marketCapUSD,
          low: marketCapUSD,
          close: marketCapUSD,
          volume: 0,
        };

        // Notify all subscribers
        for (const callback of this.subscribers.values()) {
          callback(bar);
        }

        console.log(`[SPOT] Updated price: $${marketCapUSD.toFixed(2)}`);
      } catch (error) {
        console.error('[SPOT] Error in price update callback:', error);
      }
    };

    // Subscribe to the spot pool token address
    // Note: This assumes the WebSocket service can handle spot pool subscriptions
    // If your spot pool token address is available, use it here
    await priceService.subscribeToToken(this.spotPoolAddress, handlePriceUpdate, this.spotPoolAddress);

    console.log(`[SPOT] Subscribed to real-time price updates for spot pool ${this.spotPoolAddress}`);
  }

  /**
   * Fetch current SOL price for market cap calculation
   */
  private async fetchSolPrice(): Promise<void> {
    try {
      const response = await fetch('https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112');
      const data = await response.json();

      if (data.pairs && data.pairs.length > 0) {
        this.solPrice = parseFloat(data.pairs[0].priceUsd);
        console.log(`[SPOT] SOL price: $${this.solPrice}`);
      } else {
        this.solPrice = 180; // Fallback price
      }
    } catch (error) {
      console.error('[SPOT] Error fetching SOL price:', error);
      this.solPrice = 180; // Fallback price
    }
  }

  /**
   * Unsubscribe from real-time updates
   */
  unsubscribeBars(listenerGuid: string): void {
    this.subscribers.delete(listenerGuid);
    console.log(`[SPOT] Unsubscribed listenerGuid: ${listenerGuid}`);

    // If no more subscribers, we could unsubscribe from WebSocket here
    // but keeping the connection for other potential subscribers
  }
}
