import { Router } from 'express';
import { Connection } from '@solana/web3.js';
import {
  getPoolsForWallet,
  POOL_METADATA,
  getPoolByName,
  isWalletAuthorizedForPool,
  getAuthorizedPoolsAsync,
  isWalletAuthorizedForPoolAsync,
  AuthMethod,
} from '../config/whitelist';
import { LoggerService } from '../../app/services/logger.service';

// Initialize Solana connection for token balance checks
const rpcUrl = process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const connection = new Connection(rpcUrl, 'confirmed');

const logger = new LoggerService('api').createChild('whitelist');
const router = Router();

/**
 * GET /api/whitelist/check
 * Check if a wallet is authorized to create decision markets
 * Authorization can be via whitelist OR minimum token balance
 *
 * Query params:
 *   - wallet: The wallet public key to check
 *
 * Returns:
 *   - isWhitelisted: boolean (true if authorized by any method)
 *   - pools: Array of pool addresses the wallet is authorized for
 *   - poolsWithMetadata: Pool info with authorization method
 */
router.get('/check', async (req, res, next) => {
  try {
    const { wallet } = req.query;

    if (!wallet || typeof wallet !== 'string') {
      logger.warn('[GET /check] Missing or invalid wallet parameter');
      return res.status(400).json({
        error: 'Missing required query parameter: wallet',
      });
    }

    // Validate wallet address format (basic check - 32-44 chars, base58)
    if (wallet.length < 32 || wallet.length > 44) {
      logger.warn('[GET /check] Invalid wallet address format', { wallet });
      return res.status(400).json({
        error: 'Invalid wallet address format',
      });
    }

    // Get authorized pools (checks both whitelist and token balance)
    const authorizedPools = await getAuthorizedPoolsAsync(connection, wallet);
    const isWhitelisted = authorizedPools.length > 0;

    // Build response with pool metadata and auth method
    const poolsWithMetadata = authorizedPools.map(({ poolAddress, authMethod }) => ({
      poolAddress,
      metadata: POOL_METADATA[poolAddress] || null,
      authMethod,
    }));

    logger.info('[GET /check] Authorization check completed', {
      wallet,
      isWhitelisted,
      poolCount: authorizedPools.length,
      authMethods: authorizedPools.map(p => p.authMethod),
    });

    res.json({
      wallet,
      isWhitelisted,
      pools: authorizedPools.map(p => p.poolAddress),
      poolsWithMetadata,
    });
  } catch (error) {
    logger.error('[GET /check] Failed to check authorization', {
      error: error instanceof Error ? error.message : String(error),
      wallet: req.query.wallet,
    });
    next(error);
  }
});

/**
 * GET /api/whitelist/pools
 * Get all available pools and their metadata
 *
 * Returns:
 *   - pools: Array of pool metadata objects
 */
router.get('/pools', async (req, res, next) => {
  try {
    const pools = Object.values(POOL_METADATA);

    logger.info('[GET /pools] Fetched pool list', {
      poolCount: pools.length,
    });

    res.json({
      pools,
    });
  } catch (error) {
    logger.error('[GET /pools] Failed to fetch pools', {
      error: error instanceof Error ? error.message : String(error),
    });
    next(error);
  }
});

/**
 * GET /api/whitelist/pool/:name
 * Get pool metadata by name/slug
 *
 * URL params:
 *   - name: The pool name/slug (e.g., 'zc', 'surf')
 *
 * Query params (optional):
 *   - wallet: Check if this wallet is authorized for the pool
 *
 * Returns:
 *   - pool: Pool metadata object (includes minTokenBalance if configured)
 *   - isAuthorized: (if wallet provided) Whether wallet can create DMs for this pool
 *   - authMethod: (if wallet provided) How the wallet was authorized ('whitelist' | 'token_balance')
 */
router.get('/pool/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    const { wallet } = req.query;

    const pool = getPoolByName(name);

    if (!pool) {
      logger.warn('[GET /pool/:name] Pool not found', { name });
      return res.status(404).json({
        error: 'Pool not found',
        name,
      });
    }

    let isAuthorized: boolean | undefined;
    let authMethod: AuthMethod | null | undefined;
    if (wallet && typeof wallet === 'string') {
      const result = await isWalletAuthorizedForPoolAsync(connection, wallet, pool.poolAddress);
      isAuthorized = result.isAuthorized;
      authMethod = result.authMethod;
    }

    logger.info('[GET /pool/:name] Pool lookup completed', {
      name,
      poolAddress: pool.poolAddress,
      wallet: wallet || null,
      isAuthorized: isAuthorized ?? null,
      authMethod: authMethod ?? null,
    });

    res.json({
      pool,
      ...(isAuthorized !== undefined && { isAuthorized }),
      ...(authMethod !== undefined && { authMethod }),
    });
  } catch (error) {
    logger.error('[GET /pool/:name] Failed to lookup pool', {
      error: error instanceof Error ? error.message : String(error),
      name: req.params.name,
    });
    next(error);
  }
});

export default router;
