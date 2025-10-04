import { Bar, ResolutionString } from '@/types/charting-library';

/**
 * Bar Aggregator for Real-Time Chart Updates
 *
 * Aggregates trade data into OHLCV bars for TradingView charts.
 * Maintains current incomplete bars and updates them as trades arrive.
 *
 * Usage:
 *   const aggregator = new BarAggregator('5');
 *   const bar = aggregator.updateBar(tradePrice, tradeVolume, timestamp);
 *   onTick(bar); // Send to TradingView
 */
export class BarAggregator {
  private currentBars: Map<number, Bar> = new Map();
  private resolution: ResolutionString;
  private intervalMs: number;
  private lastClosePrice: number | null = null; // Track last close price across all bars

  constructor(resolution: ResolutionString) {
    this.resolution = resolution;
    this.intervalMs = this.getIntervalMs(resolution);
  }

  /**
   * Update or create a bar with new trade data
   * @param tradePrice - Execution price from trade
   * @param tradeVolume - Volume of trade (amount out)
   * @param timestamp - Trade timestamp in milliseconds
   * @returns Updated bar for TradingView
   */
  updateBar(tradePrice: number, tradeVolume: number, timestamp: number): Bar {
    // Round timestamp to interval boundary
    const barTime = this.roundToInterval(timestamp);

    let bar = this.currentBars.get(barTime);

    if (!bar) {
      // New bar - open at last close price if available, otherwise use trade price
      const openPrice = this.lastClosePrice !== null ? this.lastClosePrice : tradePrice;
      bar = {
        time: barTime,
        open: openPrice,
        high: Math.max(openPrice, tradePrice),
        low: Math.min(openPrice, tradePrice),
        close: tradePrice,
        volume: 0
      };
    } else {
      // Update existing bar
      bar.high = Math.max(bar.high, tradePrice);
      bar.low = Math.min(bar.low, tradePrice);
      bar.close = tradePrice; // Latest trade is close
    }

    // Add volume
    bar.volume = (bar.volume || 0) + tradeVolume;

    // Store updated bar
    this.currentBars.set(barTime, bar);

    // Update last close price
    this.lastClosePrice = tradePrice;

    // Clean up old bars (keep only last 2 bars to handle edge cases)
    this.cleanupOldBars(barTime);

    return { ...bar }; // Return copy
  }

  /**
   * Get current bar for a timestamp (without updating)
   */
  getCurrentBar(timestamp: number): Bar | null {
    const barTime = this.roundToInterval(timestamp);
    const bar = this.currentBars.get(barTime);
    return bar ? { ...bar } : null;
  }

  /**
   * Clear all bars (useful when switching resolution)
   */
  clearBars(): void {
    this.currentBars.clear();
  }

  /**
   * Round timestamp to interval boundary
   * Example: 10:03:45 with 5-min interval → 10:00:00
   */
  private roundToInterval(timestamp: number): number {
    return Math.floor(timestamp / this.intervalMs) * this.intervalMs;
  }

  /**
   * Convert resolution string to milliseconds
   */
  private getIntervalMs(resolution: ResolutionString): number {
    // TradingView resolution format
    const intervals: Record<string, number> = {
      '1': 60 * 1000,           // 1 minute
      '5': 5 * 60 * 1000,       // 5 minutes
      '15': 15 * 60 * 1000,     // 15 minutes
      '60': 60 * 60 * 1000,     // 1 hour
      '240': 4 * 60 * 60 * 1000, // 4 hours
      '1D': 24 * 60 * 60 * 1000, // 1 day
      'D': 24 * 60 * 60 * 1000,  // 1 day (alternative)
    };

    return intervals[resolution] || 5 * 60 * 1000; // Default to 5 minutes
  }

  /**
   * Remove bars older than 2 intervals ago
   * Keeps memory usage low while handling edge cases
   */
  private cleanupOldBars(currentBarTime: number): void {
    const cutoffTime = currentBarTime - (this.intervalMs * 2);

    for (const [barTime, _] of this.currentBars.entries()) {
      if (barTime < cutoffTime) {
        this.currentBars.delete(barTime);
      }
    }
  }
}
