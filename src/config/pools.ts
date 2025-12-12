/**
 * Consolidated Pool Configuration
 *
 * Single source of truth for all pool-related mappings in the percent backend.
 * This file centralizes pool addresses, tickers, metadata, and whitelists.
 */

/**
 * Pool metadata interface
 */
export interface PoolMetadata {
  poolAddress: string;
  ticker: string;
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  moderatorId: number;
  icon?: string;
  minTokenBalance?: number; // Minimum base token balance required to create proposals (in whole tokens)
}

/**
 * Ticker to pool address mapping
 * Used by router.service.ts for loading manager keypairs
 */
const TICKER_TO_POOL: Record<string, string> = {
  'ZC': 'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad',
  'OOGWAY': '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX',
  'SURF': 'PS3rPSb49GnAkmh3tec1RQizgNSb1hUwPsYHGGuAy5r', // was: Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1
};

/**
 * Pool address to ticker mapping (reverse of TICKER_TO_POOL)
 */
const POOL_TO_TICKER: Record<string, string> = Object.fromEntries(
  Object.entries(TICKER_TO_POOL).map(([ticker, pool]) => [pool, ticker])
);

/**
 * Whitelist of authorized wallets per pool
 * Maps pool address -> array of authorized wallet public keys
 */
const POOL_WHITELIST: Record<string, string[]> = {
  // ZC-SOL DAMM Pool
  [TICKER_TO_POOL.ZC]: [
    '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',
    'BXc9g3zxbQhhfkLjxXbtSHrfd6MSFRdJo8pDQhW95QUw',
    'FgACAue3FuWPrL7xSqXWtUdHLne52dvVsKyKxjwqPYtr',
    'FtV94i2JvmaqsE1rBT72C9YR58wYJXt1ZjRmPb4tDvMK',
  ],
  // oogway-SOL DAMM Pool
  [TICKER_TO_POOL.OOGWAY]: [
    '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',
    'BXc9g3zxbQhhfkLjxXbtSHrfd6MSFRdJo8pDQhW95QUw',
    'FgACAue3FuWPrL7xSqXWtUdHLne52dvVsKyKxjwqPYtr',
  ],
  // SURF-SOL DAMM Pool
  [TICKER_TO_POOL.SURF]: [
    '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',
    'BXc9g3zxbQhhfkLjxXbtSHrfd6MSFRdJo8pDQhW95QUw',
    'FgACAue3FuWPrL7xSqXWtUdHLne52dvVsKyKxjwqPYtr',
    'FtV94i2JvmaqsE1rBT72C9YR58wYJXt1ZjRmPb4tDvMK',
    '4GctbRKwsQjECaY1nL8HiqkgvEUAi8EyhU1ezNmhB3hg',
    'HU65idnreBAe9gsLzSGTV7w7tVTzaSzXBw518F1aQrGv',
  ],
};

/**
 * Pool metadata for UI display and routing
 */
const POOL_METADATA: Record<string, PoolMetadata> = {
  [TICKER_TO_POOL.ZC]: {
    poolAddress: TICKER_TO_POOL.ZC,
    ticker: 'zc',
    baseMint: 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC',
    quoteMint: 'So11111111111111111111111111111111111111112',
    baseDecimals: 6,
    quoteDecimals: 9,
    moderatorId: 2,
    icon: 'https://wsrv.nl/?w=128&h=128&default=1&url=https%3A%2F%2Folive-imaginative-aardvark-508.mypinata.cloud%2Fipfs%2FQmY56Yz44o1EhTJfy6b4uhKCXpNGYvmFdsRX9yuiX1X45a',
  },
  [TICKER_TO_POOL.OOGWAY]: {
    poolAddress: TICKER_TO_POOL.OOGWAY,
    ticker: 'oogway',
    baseMint: 'C7MGcMnN8cXUkj8JQuMhkJZh6WqY2r8QnT3AUfKTkrix',
    quoteMint: 'So11111111111111111111111111111111111111112',
    baseDecimals: 6,
    quoteDecimals: 9,
    moderatorId: 3,
    icon: 'https://wsrv.nl/?w=128&h=128&default=1&url=https%3A%2F%2Folive-imaginative-aardvark-508.mypinata.cloud%2Fipfs%2FQmV4rzAgYREFBpDRyM5VmboewHUwS1Xu8ey2wrs9rJKcfE',
  },
  [TICKER_TO_POOL.SURF]: {
    poolAddress: TICKER_TO_POOL.SURF,
    ticker: 'surf',
    baseMint: 'E7xktmaFNM6vd4GKa8FrXwX7sA7hrLzToxc64foGq3iW', // was: SurfwRjQQFV6P7JdhxSptf4CjWU8sb88rUiaLCystar
    quoteMint: 'So11111111111111111111111111111111111111112',
    baseDecimals: 9,
    quoteDecimals: 9,
    moderatorId: 4,
    icon: 'https://arweave.net/r02Vz3jHG5_ZH0BrKbkIJOkF4LDcTTdLNljefYpJYJo',
    minTokenBalance: 5_000_000, // 5M SURF required to create proposals
  },
};

/**
 * Consolidated pool configuration export
 */
export const POOL_CONFIG = {
  tickerToPool: TICKER_TO_POOL,
  poolToTicker: POOL_TO_TICKER,
  whitelist: POOL_WHITELIST,
  metadata: POOL_METADATA,
} as const;

// Re-export for convenience
export { TICKER_TO_POOL, POOL_TO_TICKER, POOL_WHITELIST, POOL_METADATA };
