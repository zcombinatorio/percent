import { Router } from 'express';
import { getPoolsForWallet, isWalletWhitelisted, POOL_METADATA, getPoolByName, isWalletAuthorizedForPool } from '../config/whitelist';
import { LoggerService } from '../../app/services/logger.service';

const logger = new LoggerService('api').createChild('whitelist');
const router = Router();

/**
 * GET /api/whitelist/check
 * Check if a wallet is authorized to create decision markets
 *
 * Query params:
 *   - wallet: The wallet public key to check
 *
 * Returns:
 *   - isWhitelisted: boolean
 *   - pools: Array of pool addresses the wallet is authorized for
 *   - poolMetadata: Optional metadata about each pool
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

    const authorizedPools = getPoolsForWallet(wallet);
    const isWhitelisted = authorizedPools.length > 0;

    // Build response with pool metadata
    const poolsWithMetadata = authorizedPools.map(poolAddress => ({
      poolAddress,
      metadata: POOL_METADATA[poolAddress] || null,
    }));

    logger.info('[GET /check] Whitelist check completed', {
      wallet,
      isWhitelisted,
      poolCount: authorizedPools.length,
    });

    res.json({
      wallet,
      isWhitelisted,
      pools: authorizedPools,
      poolsWithMetadata,
    });
  } catch (error) {
    logger.error('[GET /check] Failed to check whitelist', {
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
 *   - name: The pool name/slug (e.g., 'zc', 'bangit')
 *
 * Query params (optional):
 *   - wallet: Check if this wallet is authorized for the pool
 *
 * Returns:
 *   - pool: Pool metadata object
 *   - isAuthorized: (if wallet provided) Whether wallet can create DMs for this pool
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
    if (wallet && typeof wallet === 'string') {
      isAuthorized = isWalletAuthorizedForPool(wallet, pool.poolAddress);
    }

    logger.info('[GET /pool/:name] Pool lookup completed', {
      name,
      poolAddress: pool.poolAddress,
      wallet: wallet || null,
      isAuthorized: isAuthorized ?? null,
    });

    res.json({
      pool,
      ...(isAuthorized !== undefined && { isAuthorized }),
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
