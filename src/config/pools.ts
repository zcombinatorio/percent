/**
 * Consolidated Pool Configuration
 *
 * Single source of truth for all pool-related mappings in the percent backend.
 * This file centralizes pool addresses, tickers, metadata, and whitelists.
 */

/**
 * Pool type enum - distinguishes between DAMM (CP-AMM) and DLMM pools
 */
export type PoolType = 'damm' | 'dlmm';

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
  poolType: PoolType;
  withdrawalPercentage: number; // Liquidity withdrawal percentage (1-50)
  icon?: string;
  minTokenBalance?: number; // Minimum base token balance required to create proposals (in whole tokens)
}

/**
 * Ticker to pool address mapping
 * Used by router.service.ts for loading manager keypairs
 */
const TICKER_TO_POOL: Record<string, string> = {
  'ZC': '7jbhVZcYqCRmciBcZzK8L5B96Pyw7i1SpXQFKBkzD3G2', // DLMM pool
  'OOGWAY': '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX',
  'SURF': 'Ez1QYeC95xJRwPA9SR7YWC1H1Tj43exJr91QqKf8Puu1',
  'SURFTEST': 'PS3rPSb49GnAkmh3tec1RQizgNSb1hUwPsYHGGuAy5r',
  'TESTSURF': 'EC7MUufEpZcRZyXTFt16MMNLjJVnj9Vkku4UwdZ713Hx', // DLMM pool
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
  // SURFTEST-SOL DAMM Pool (test)
  [TICKER_TO_POOL.SURFTEST]: [
    'FtV94i2JvmaqsE1rBT72C9YR58wYJXt1ZjRmPb4tDvMK',
    '4GctbRKwsQjECaY1nL8HiqkgvEUAi8EyhU1ezNmhB3hg',
  ],
  // TESTSURF-SOL DLMM Pool
  [TICKER_TO_POOL.TESTSURF]: [
    '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',
    'BXc9g3zxbQhhfkLjxXbtSHrfd6MSFRdJo8pDQhW95QUw',
    'FgACAue3FuWPrL7xSqXWtUdHLne52dvVsKyKxjwqPYtr',
    'FtV94i2JvmaqsE1rBT72C9YR58wYJXt1ZjRmPb4tDvMK',
  ],
  // SURF-SOL DAMM Pool (production)
  [TICKER_TO_POOL.SURF]: [
    '4GctbRKwsQjECaY1nL8HiqkgvEUAi8EyhU1ezNmhB3hg',
    'BV9MxX2veiQwLeWqwzPcMWPEhzV9r47G63b3W3qcDH7X',
  ],
};

/**
 * Pool metadata for UI display and routing
 */
const POOL_METADATA: Record<string, PoolMetadata> = {
  // ZC DLMM Pool (Meteora DLMM)
  [TICKER_TO_POOL.ZC]: {
    poolAddress: TICKER_TO_POOL.ZC,
    ticker: 'zc',
    baseMint: 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC',
    quoteMint: 'So11111111111111111111111111111111111111112',
    baseDecimals: 6,
    quoteDecimals: 9,
    moderatorId: 2,
    poolType: 'dlmm',
    withdrawalPercentage: 50,
    icon: 'https://pbs.twimg.com/profile_images/1991222874401587200/V0ARKOcE_400x400.jpg',
  },
  // oogway DAMM Pool (Meteora CP-AMM)
  [TICKER_TO_POOL.OOGWAY]: {
    poolAddress: TICKER_TO_POOL.OOGWAY,
    ticker: 'oogway',
    baseMint: 'C7MGcMnN8cXUkj8JQuMhkJZh6WqY2r8QnT3AUfKTkrix',
    quoteMint: 'So11111111111111111111111111111111111111112',
    baseDecimals: 6,
    quoteDecimals: 9,
    moderatorId: 3,
    poolType: 'damm',
    withdrawalPercentage: 12,
    icon: 'https://wsrv.nl/?w=128&h=128&default=1&url=https%3A%2F%2Folive-imaginative-aardvark-508.mypinata.cloud%2Fipfs%2FQmV4rzAgYREFBpDRyM5VmboewHUwS1Xu8ey2wrs9rJKcfE',
  },
  // Test SURF DAMM pool
  [TICKER_TO_POOL.SURFTEST]: {
    poolAddress: TICKER_TO_POOL.SURFTEST,
    ticker: 'surftest',
    baseMint: 'E7xktmaFNM6vd4GKa8FrXwX7sA7hrLzToxc64foGq3iW',
    quoteMint: 'So11111111111111111111111111111111111111112',
    baseDecimals: 9,
    quoteDecimals: 9,
    moderatorId: 4,
    poolType: 'damm',
    withdrawalPercentage: 12,
    icon: 'https://arweave.net/r02Vz3jHG5_ZH0BrKbkIJOkF4LDcTTdLNljefYpJYJo',
    minTokenBalance: 5_000_000, // 5M SURF required to create proposals
  },
  // TESTSURF DLMM pool
  [TICKER_TO_POOL.TESTSURF]: {
    poolAddress: TICKER_TO_POOL.TESTSURF,
    ticker: 'testsurf',
    baseMint: 'E7xktmaFNM6vd4GKa8FrXwX7sA7hrLzToxc64foGq3iW',
    quoteMint: 'So11111111111111111111111111111111111111112',
    baseDecimals: 9,
    quoteDecimals: 9,
    moderatorId: 5,
    poolType: 'dlmm',
    withdrawalPercentage: 50,
    icon: 'https://arweave.net/r02Vz3jHG5_ZH0BrKbkIJOkF4LDcTTdLNljefYpJYJo',
  },
  // Production SURF DAMM pool
  [TICKER_TO_POOL.SURF]: {
    poolAddress: TICKER_TO_POOL.SURF,
    ticker: 'surf',
    baseMint: 'SurfwRjQQFV6P7JdhxSptf4CjWU8sb88rUiaLCystar',
    quoteMint: 'So11111111111111111111111111111111111111112',
    baseDecimals: 9,
    quoteDecimals: 9,
    moderatorId: 6,
    poolType: 'damm',
    withdrawalPercentage: 12,
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
