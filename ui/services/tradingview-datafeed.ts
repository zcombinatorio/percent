import {
  IBasicDataFeed,
  LibrarySymbolInfo,
  ResolutionString,
  Bar,
  HistoryCallback,
  SubscribeBarsCallback,
  PeriodParams,
} from '@/types/charting-library';
import { getPriceStreamService, TradeUpdate, ChartPriceUpdate } from './price-stream.service';
import { BarAggregator } from '@/lib/bar-aggregator';
import { buildApiUrl } from '@/lib/api-utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const TOTAL_SUPPLY = 1_000_000_000; // 1 billion tokens

interface ChartDataPoint {
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

/**
 * TradingView Datafeed for Proposal Markets
 * Provides historical and real-time price data for Pass/Fail markets
 */
export class ProposalMarketDatafeed implements IBasicDataFeed {
  private proposalId: number;
  private market: number;  // Numeric market index (0-3 for quantum markets)
  private moderatorId?: number;
  private tokenAddress: string | null = null;
  private poolAddress: string | null = null;
  private spotPoolAddress: string | null = null;
  private subscribers: Map<string, { callback: SubscribeBarsCallback; aggregator: BarAggregator; isSpotMarket: boolean }> = new Map();
  // NOTE: solPrice and totalSupply no longer needed - backend calculates market cap USD
  // All prices (pass, fail, spot) and trade prices are pre-calculated as market cap USD

  constructor(proposalId: number, market: number, spotPoolAddress?: string, moderatorId?: number) {
    this.proposalId = proposalId;
    this.market = market;
    this.spotPoolAddress = spotPoolAddress || null;
    this.moderatorId = moderatorId;
  }

  /**
   * Set token and pool addresses for real-time updates
   */
  setAddresses(tokenAddress: string, poolAddress: string) {
    this.tokenAddress = tokenAddress;
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
    // Check if this is a spot market request
    const isSpotMarket = symbolName === 'SPOT-MARKET';

    const displayName = isSpotMarket
      ? 'SPOT $ZC'
      : `COIN ${this.market + 1} $ZC`;

    const symbolInfo: LibrarySymbolInfo = {
      name: displayName,
      description: displayName,
      type: 'crypto',
      session: '24x7',
      timezone: 'Etc/UTC',
      ticker: symbolName,
      exchange: 'PERCENT',
      listed_exchange: 'PERCENT',
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
      const { from, to, countBack, firstDataRequest } = periodParams;

      // Detect if this is a spot market request (check ticker, not name)
      const isSpotMarket = symbolInfo.ticker === 'SPOT-MARKET';
      const marketLabel = isSpotMarket ? 'spot' : `market-${this.market}`;

      console.log(`[${marketLabel}] getBars called:`, {
        from: new Date(from * 1000).toISOString(),
        to: new Date(to * 1000).toISOString(),
        countBack,
        firstDataRequest,
        isSpotMarket
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

      const url = buildApiUrl(API_BASE_URL, `/api/history/${this.proposalId}/chart`, {
        interval,
        from: fromDate,
        to: toDate
      }, this.moderatorId);
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (!data.data || data.data.length === 0) {
        console.log(`[${marketLabel}] No data from API, returning noData=true`);
        onResult([], { noData: true });
        return;
      }

      // Filter data for the specific market and convert to bars
      // For spot market, use 'spot' string. For others, use numeric index.
      const bars: Bar[] = data.data
        .filter((item: any) => isSpotMarket ? item.market === 'spot' : item.market === this.market)
        .map((item: ChartDataPoint) => ({
          time: new Date(item.timestamp).getTime(),
          open: parseFloat(item.open),
          high: parseFloat(item.high),
          low: parseFloat(item.low),
          close: parseFloat(item.close),
          volume: item.volume ? parseFloat(item.volume) : 0,
        }))
        .filter((bar: Bar) => !isNaN(bar.open) && !isNaN(bar.high) && !isNaN(bar.low) && !isNaN(bar.close))
        .sort((a: Bar, b: Bar) => a.time - b.time);

      console.log(`[${marketLabel}] Returning ${bars.length} bars:`, {
        firstBar: bars[0] ? new Date(bars[0].time).toISOString() : 'none',
        lastBar: bars[bars.length - 1] ? new Date(bars[bars.length - 1].time).toISOString() : 'none',
        requestedFrom: new Date(from * 1000).toISOString(),
        requestedTo: new Date(to * 1000).toISOString(),
        samplePrice: bars[0]?.close
      });

      if (bars.length === 0) {
        console.log(`[${marketLabel}] No bars after filtering, returning noData=true`);
        onResult([], { noData: true });
        return;
      }

      onResult(bars, { noData: false });
    } catch (error) {
      console.error('Error fetching bars:', error);
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
    // Detect if this is a spot market request (check ticker, not name)
    const isSpotMarket = symbolInfo.ticker === 'SPOT-MARKET';
    const marketLabel = isSpotMarket ? 'spot' : `market-${this.market}`;

    console.log(`[${marketLabel}] subscribeBars called for resolution ${resolution}, listenerGuid: ${listenerGuid}`);

    // Create bar aggregator for this resolution
    const aggregator = new BarAggregator(resolution);

    // Seed the aggregator with the last historical bar's close price
    await this.seedAggregatorWithLastBar(aggregator, resolution, isSpotMarket);

    this.subscribers.set(listenerGuid, { callback: onTick, aggregator, isSpotMarket });

    console.log(`[${marketLabel}] Subscribers count after add: ${this.subscribers.size}`);

    // Subscribe to both trade and price updates via WebSocket
    const priceService = getPriceStreamService();

    if (!isSpotMarket) {
      // Subscribe to trade updates for conditional markets
      priceService.subscribeToTrades(this.proposalId, this.handleTradeUpdate.bind(this));
      console.log(`[${marketLabel}] Subscribed to real-time trade updates for proposal ${this.proposalId}`);
    }

    // Subscribe to chart price updates for all markets (conditional and spot)
    priceService.subscribeToChartPrices(this.proposalId, this.handlePriceUpdate.bind(this));
    console.log(`[${marketLabel}] Subscribed to real-time price updates for proposal ${this.proposalId}`);
  }

  /**
   * Seed the bar aggregator with the last historical bar to ensure continuity
   */
  private async seedAggregatorWithLastBar(aggregator: BarAggregator, resolution: ResolutionString, isSpotMarket: boolean = false): Promise<void> {
    try {
      // For spot market use 'spot', otherwise use numeric market index
      const marketFilter: number | 'spot' = isSpotMarket ? 'spot' : this.market;
      const marketLabel = isSpotMarket ? 'spot' : `market-${this.market}`;

      // Map resolution to API interval format
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
      const toDate = new Date().toISOString();
      const fromDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // Last 24 hours

      const url = buildApiUrl(API_BASE_URL, `/api/history/${this.proposalId}/chart`, {
        interval,
        from: fromDate,
        to: toDate
      }, this.moderatorId);
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`[${marketLabel}] Failed to fetch last bar for seeding`);
        return;
      }

      const data = await response.json();

      if (!data.data || data.data.length === 0) {
        console.log(`[${marketLabel}] No historical data to seed aggregator`);
        return;
      }

      // Find the last bar for this market using direct comparison
      // Backend returns market as numeric index (0-3) or 'spot' string
      const lastBar = data.data
        .filter((item: any) => item.market === marketFilter)
        .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

      if (lastBar) {
        const lastPrice = parseFloat(lastBar.close);
        const lastTime = new Date(lastBar.timestamp).getTime();

        console.log(`[${marketLabel}] Seeding aggregator with last bar:`, {
          time: new Date(lastTime).toISOString(),
          close: lastPrice
        });

        // Create a synthetic trade at the last bar time to seed the aggregator
        // This ensures the next bar will open at this close price
        aggregator.updateBar(lastPrice, 0, lastTime);
      }
    } catch (error) {
      console.error(`[market-${this.market}] Error seeding aggregator:`, error);
      // Continue without seeding - not critical
    }
  }


  /**
   * Handle incoming trade updates
   */
  private handleTradeUpdate(trade: TradeUpdate): void {
    console.log(`[${this.market}] Trade received for ${trade.market}:`, trade);

    // Filter for our market only
    if (trade.market !== this.market) {
      console.log(`[${this.market}] Ignoring trade for ${trade.market} market`);
      return;
    }

    console.log(`[${this.market}] Processing trade - subscribers: ${this.subscribers.size}`);
    console.log(`[${this.market}] Trade timestamp: ${new Date(trade.timestamp).toISOString()} (${trade.timestamp})`);

    // Use marketCapUsd if available (new backend), otherwise price (legacy/old backend)
    const marketCapUSD = trade.marketCapUsd ?? trade.price;
    console.log(`[${this.market}] Market cap from trade: $${marketCapUSD.toFixed(2)}`);

    // Update all active subscribers (skip spot market subscribers)
    for (const [listenerGuid, { callback, aggregator, isSpotMarket }] of this.subscribers) {
      // Skip spot market subscribers - they get updates from backend periodic recording
      if (isSpotMarket) {
        console.log(`[${this.market}] Skipping spot market subscriber ${listenerGuid}`);
        continue;
      }

      try {
        // Update bar with new trade
        const updatedBar = aggregator.updateBar(
          marketCapUSD,
          trade.amountOut, // Volume in conditional tokens
          trade.timestamp
        );

        // Send updated bar to TradingView
        callback(updatedBar);

        console.log(`[${this.market}] Updated bar for ${listenerGuid}:`, {
          time: new Date(updatedBar.time).toISOString(),
          timeMs: updatedBar.time,
          marketCapUSD: marketCapUSD,
          open: updatedBar.open,
          high: updatedBar.high,
          low: updatedBar.low,
          close: updatedBar.close,
          volume: updatedBar.volume
        });
      } catch (error) {
        console.error(`[${this.market}] Error updating bar for ${listenerGuid}:`, error);
      }
    }
  }

  /**
   * Handle incoming price updates from scheduler
   */
  private handlePriceUpdate(priceUpdate: ChartPriceUpdate): void {
    console.log(`[Datafeed ${this.market}] 📊 Price update received:`, {
      proposalId: priceUpdate.proposalId,
      market: priceUpdate.market,
      price: priceUpdate.price,
      timestamp: new Date(priceUpdate.timestamp).toISOString(),
      subscribersCount: this.subscribers.size
    });

    // Update all subscribers that match this market
    let updatedCount = 0;
    for (const [listenerGuid, { callback, aggregator, isSpotMarket }] of this.subscribers) {
      // Match spot market subscribers to spot prices, pass/fail subscribers to their respective prices
      const marketMatches = isSpotMarket
        ? priceUpdate.market === 'spot'
        : priceUpdate.market === this.market;

      if (!marketMatches) {
        console.log(`[Datafeed ${this.market}] Skipping subscriber ${listenerGuid}: market mismatch (subscriber wants ${isSpotMarket ? 'spot' : this.market}, update is ${priceUpdate.market})`);
        continue;
      }

      try {
        // Use marketCapUsd if available (new backend), otherwise price (legacy/old backend)
        // New backend sends both: price (SOL) and marketCapUsd (USD)
        const marketCapUSD = priceUpdate.marketCapUsd ?? priceUpdate.price;

        // Update bar with new price (volume = 0 for price updates)
        const updatedBar = aggregator.updateBar(
          marketCapUSD,
          0, // No volume for scheduled price updates
          priceUpdate.timestamp
        );

        // Send updated bar to TradingView
        callback(updatedBar);
        updatedCount++;

        console.log(`[Datafeed ${this.market}] ✅ Bar updated for ${listenerGuid}:`, {
          time: new Date(updatedBar.time).toISOString(),
          timeMs: updatedBar.time,
          marketCapUSD: marketCapUSD,
          open: updatedBar.open,
          high: updatedBar.high,
          low: updatedBar.low,
          close: updatedBar.close,
        });
      } catch (error) {
        console.error(`[Datafeed ${this.market}] ❌ Error updating bar for ${listenerGuid}:`, error);
      }
    }
    console.log(`[Datafeed ${this.market}] Price update complete: ${updatedCount}/${this.subscribers.size} subscriber(s) updated`);
  }

  /**
   * Unsubscribe from real-time updates
   */
  unsubscribeBars(listenerGuid: string): void {
    this.subscribers.delete(listenerGuid);

    // If no more subscribers, unsubscribe from trades and prices
    if (this.subscribers.size === 0) {
      const priceService = getPriceStreamService();
      priceService.unsubscribeFromTrades(this.proposalId, this.handleTradeUpdate.bind(this));
      priceService.unsubscribeFromChartPrices(this.proposalId, this.handlePriceUpdate.bind(this));
      console.log(`[${this.market}] Unsubscribed from trade and price updates`);
    }
  }
}
