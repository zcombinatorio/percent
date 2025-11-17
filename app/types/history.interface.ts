import { Decimal } from 'decimal.js';

/**
 * Price history record for AMM price tracking
 * Captures point-in-time price snapshots
 */
export interface IPriceHistory {
  id?: number;                   // Database primary key (auto-generated)
  timestamp: Date;                // Snapshot timestamp
  moderatorId: number;            // Associated moderator ID
  proposalId: number;             // Associated proposal ID
  market: number;                 // Market index (-1 for spot, 0+ for market index)
  price: Decimal;                 // Current price at this point in time
}

/**
 * TWAP (Time-Weighted Average Price) history record
 * Tracks both current TWAP values and cumulative aggregations
 */
export interface ITWAPHistory {
  id?: number;                   // Database primary key (auto-generated)
  timestamp: Date;                // Snapshot timestamp
  moderatorId: number;            // Associated moderator ID
  proposalId: number;             // Associated proposal ID
  twaps: Decimal[];               // Array of TWAPs for each market
  aggregations: Decimal[];        // Array of cumulative aggregations for each market
}

/**
 * Trade history record for swap transactions
 * Captures individual trades executed on the AMMs
 */
export interface ITradeHistory {
  id?: number;                   // Database primary key (auto-generated)
  timestamp: Date;                // Trade execution timestamp
  moderatorId: number;            // Associated moderator ID
  proposalId: number;             // Associated proposal ID
  market: number;                 // Market index (0+)
  userAddress: string;            // Trader's wallet address
  isBaseToQuote: boolean;         // Trade direction (true: base→quote, false: quote→base)
  amountIn: Decimal;              // Input token amount
  amountOut: Decimal;             // Output token amount received
  price: Decimal;                 // Execution price (calculated from amounts)
  txSignature?: string;           // Solana transaction signature (optional)
}

/**
 * Chart data point for visualization
 * OHLCV data for displaying candlestick charts
 */
export interface IChartDataPoint {
  timestamp: number;              // Unix timestamp in milliseconds
  moderatorId: number;            // Associated moderator ID
  market: number;                 // Market index (-1 for spot, 0+ for market index)
  open: number;                   // Opening price in the time bucket
  high: number;                   // Highest price in the time bucket
  low: number;                    // Lowest price in the time bucket
  close: number;                  // Closing price in the time bucket
  volume?: number;                // Trading volume in this time period (optional)
}