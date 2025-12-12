import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';

/**
 * Whitelist configuration for multi-token decision markets
 *
 * This file re-exports pool configuration from the consolidated pools.ts
 * and provides helper functions for authorization checks.
 */

import {
  POOL_CONFIG,
  POOL_WHITELIST as _POOL_WHITELIST,
  POOL_METADATA as _POOL_METADATA,
  PoolMetadata,
} from './pools';

// Re-export for backward compatibility
export const POOL_WHITELIST = _POOL_WHITELIST;
export const POOL_METADATA = _POOL_METADATA;
export type { PoolMetadata };

/**
 * Get all pool addresses that a wallet is authorized to use
 * @param walletAddress - The connected wallet's public key
 * @returns Array of pool addresses the wallet can create DMs for
 */
export function getPoolsForWallet(walletAddress: string): string[] {
  const authorizedPools: string[] = [];

  for (const [poolAddress, authorizedWallets] of Object.entries(POOL_CONFIG.whitelist)) {
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
  const authorizedWallets = POOL_CONFIG.whitelist[poolAddress];
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
 * @param name - The pool name/slug (e.g., 'zc', 'surf')
 * @returns Pool metadata or null if not found
 */
export function getPoolByName(name: string): PoolMetadata | null {
  const lowerName = name.toLowerCase();
  const pool = Object.values(POOL_CONFIG.metadata).find(
    p => p.ticker.toLowerCase() === lowerName
  );
  return pool || null;
}

// ============================================================================
// Async Authorization Functions (Token Balance Check)
// ============================================================================

export type AuthMethod = 'whitelist' | 'token_balance';

export interface AuthorizationResult {
  isAuthorized: boolean;
  authMethod: AuthMethod | null;
}

export interface AuthorizedPool {
  poolAddress: string;
  authMethod: AuthMethod;
}

/**
 * Get token balance for a wallet
 * @param connection - Solana RPC connection
 * @param walletAddress - The wallet's public key
 * @param mintAddress - The token mint address
 * @param decimals - The token's decimal places
 * @returns Token balance in whole tokens (not lamports)
 */
export async function getTokenBalance(
  connection: Connection,
  walletAddress: string,
  mintAddress: string,
  decimals: number
): Promise<number> {
  try {
    const wallet = new PublicKey(walletAddress);
    const mint = new PublicKey(mintAddress);
    const ata = await getAssociatedTokenAddress(mint, wallet);
    const account = await getAccount(connection, ata);
    return Number(account.amount) / Math.pow(10, decimals);
  } catch {
    // Account doesn't exist or error fetching = 0 balance
    return 0;
  }
}

/**
 * Check if a wallet meets the minimum token balance for a pool
 * @param connection - Solana RPC connection
 * @param walletAddress - The wallet's public key
 * @param poolAddress - The DAMM pool address
 * @returns true if wallet has sufficient balance
 */
export async function hasMinimumTokenBalance(
  connection: Connection,
  walletAddress: string,
  poolAddress: string
): Promise<boolean> {
  const poolMetadata = POOL_METADATA[poolAddress];
  if (!poolMetadata || poolMetadata.minTokenBalance === undefined) {
    return false; // No minimum balance configured = token auth not available
  }

  const balance = await getTokenBalance(
    connection,
    walletAddress,
    poolMetadata.baseMint,
    poolMetadata.baseDecimals
  );

  return balance >= poolMetadata.minTokenBalance;
}

/**
 * Check if a wallet is authorized for a specific pool (async version)
 * Checks whitelist first (fast), then token balance if not whitelisted
 * @param connection - Solana RPC connection
 * @param walletAddress - The wallet's public key
 * @param poolAddress - The DAMM pool address
 * @returns Authorization result with method used
 */
export async function isWalletAuthorizedForPoolAsync(
  connection: Connection,
  walletAddress: string,
  poolAddress: string
): Promise<AuthorizationResult> {
  // Check whitelist first (fast, no RPC call)
  if (isWalletAuthorizedForPool(walletAddress, poolAddress)) {
    return { isAuthorized: true, authMethod: 'whitelist' };
  }

  // Check token balance
  const hasBalance = await hasMinimumTokenBalance(connection, walletAddress, poolAddress);
  if (hasBalance) {
    return { isAuthorized: true, authMethod: 'token_balance' };
  }

  return { isAuthorized: false, authMethod: null };
}

/**
 * Get all pools a wallet is authorized for (async version)
 * @param connection - Solana RPC connection
 * @param walletAddress - The wallet's public key
 * @returns Array of authorized pools with auth method
 */
export async function getAuthorizedPoolsAsync(
  connection: Connection,
  walletAddress: string
): Promise<AuthorizedPool[]> {
  const authorizedPools: AuthorizedPool[] = [];

  // Check each pool
  for (const poolAddress of Object.keys(POOL_METADATA)) {
    const result = await isWalletAuthorizedForPoolAsync(connection, walletAddress, poolAddress);
    if (result.isAuthorized && result.authMethod) {
      authorizedPools.push({ poolAddress, authMethod: result.authMethod });
    }
  }

  return authorizedPools;
}
