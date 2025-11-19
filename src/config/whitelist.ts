/**
 * Whitelist configuration for multi-token decision markets
 * Maps DAMM pool addresses to authorized dev wallet addresses
 */

// Map of DAMM pool address → array of authorized dev wallet public keys
// Each pool can have multiple authorized wallets (e.g., team members)
export const POOL_WHITELIST: Record<string, string[]> = {
  // ZC-SOL DAMM Pool (default)
  'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad': [
    '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',
    'BXc9g3zxbQhhfkLjxXbtSHrfd6MSFRdJo8pDQhW95QUw',
    'FgACAue3FuWPrL7xSqXWtUdHLne52dvVsKyKxjwqPYtr',
    'FtV94i2JvmaqsE1rBT72C9YR58wYJXt1ZjRmPb4tDvMK',
  ],
  // oogway
  '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX': [
    '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',
    'BXc9g3zxbQhhfkLjxXbtSHrfd6MSFRdJo8pDQhW95QUw',
  ],
};

/**
 * Get all pool addresses that a wallet is authorized to use
 * @param walletAddress - The connected wallet's public key
 * @returns Array of pool addresses the wallet can create DMs for
 */
export function getPoolsForWallet(walletAddress: string): string[] {
  const authorizedPools: string[] = [];

  for (const [poolAddress, authorizedWallets] of Object.entries(POOL_WHITELIST)) {
    if (authorizedWallets.includes(walletAddress)) {
      authorizedPools.push(poolAddress);
    }
  }

  return authorizedPools;
}

/**
 * Check if a wallet is authorized for a specific pool
 * @param walletAddress - The connected wallet's public key
 * @param poolAddress - The DAMM pool address to check
 * @returns true if wallet is authorized for the pool
 */
export function isWalletAuthorizedForPool(walletAddress: string, poolAddress: string): boolean {
  const authorizedWallets = POOL_WHITELIST[poolAddress];
  if (!authorizedWallets) {
    return false;
  }
  return authorizedWallets.includes(walletAddress);
}

/**
 * Check if a wallet is whitelisted for any pool
 * @param walletAddress - The connected wallet's public key
 * @returns true if wallet is authorized for at least one pool
 */
export function isWalletWhitelisted(walletAddress: string): boolean {
  return getPoolsForWallet(walletAddress).length > 0;
}

/**
 * Get pool metadata by name/slug (case-insensitive)
 * @param name - The pool name/slug (e.g., 'zc', 'bangit')
 * @returns Pool metadata or null if not found
 */
export function getPoolByName(name: string): PoolMetadata | null {
  const lowerName = name.toLowerCase();
  const pool = Object.values(POOL_METADATA).find(
    p => p.ticker.toLowerCase() === lowerName
  );
  return pool || null;
}

/**
 * Get pool metadata (can be extended with more info like token name, mint address, etc.)
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
}

// Optional: Pool metadata for UI display
export const POOL_METADATA: Record<string, PoolMetadata> = {
  'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad': {
    poolAddress: 'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad',
    ticker: 'zc',
    baseMint: 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC', // ZC token
    quoteMint: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    baseDecimals: 6,
    quoteDecimals: 9,
    moderatorId: 2, // Production ZC Decision Markets
    icon: 'https://wsrv.nl/?w=128&h=128&default=1&url=https%3A%2F%2Folive-imaginative-aardvark-508.mypinata.cloud%2Fipfs%2FQmY56Yz44o1EhTJfy6b4uhKCXpNGYvmFdsRX9yuiX1X45a',
  },
  '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX': {
    poolAddress: '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX',
    ticker: 'oogway',
    baseMint: 'C7MGcMnN8cXUkj8JQuMhkJZh6WqY2r8QnT3AUfKTkrix', // oogway token
    quoteMint: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    baseDecimals: 6,
    quoteDecimals: 9,
    moderatorId: 3, // oogway Decision Markets
    icon: 'https://wsrv.nl/?w=128&h=128&default=1&url=https%3A%2F%2Folive-imaginative-aardvark-508.mypinata.cloud%2Fipfs%2FQmV4rzAgYREFBpDRyM5VmboewHUwS1Xu8ey2wrs9rJKcfE',
  },
};
