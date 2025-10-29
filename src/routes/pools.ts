import { Router } from 'express';
import { Connection, PublicKey } from '@solana/web3.js';
import { CpAmm, getPriceFromSqrtPrice } from '@meteora-ag/cp-amm-sdk';
import { LoggerService } from '../../app/services/logger.service';

const router = Router();
const logger = new LoggerService('api').createChild('pools');

// Get Solana connection
const getRpcUrl = () => {
  return process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
};

/**
 * Get current price from a Meteora pool
 * GET /api/pools/:poolAddress/price
 *
 * Returns:
 * - poolAddress: string
 * - price: number (quote/base)
 * - timestamp: number
 * - liquidity: string
 * - reserves: { base: string, quote: string }
 */
router.get('/:poolAddress/price', async (req, res, next) => {
  try {
    const { poolAddress } = req.params;

    if (!poolAddress) {
      logger.warn('[GET /:poolAddress/price] Missing pool address');
      return res.status(400).json({ error: 'Pool address is required' });
    }

    // Validate pool address
    let poolPubkey: PublicKey;
    try {
      poolPubkey = new PublicKey(poolAddress);
    } catch (error) {
      logger.warn('[GET /:poolAddress/price] Invalid pool address format', {
        poolAddress
      });
      return res.status(400).json({ error: 'Invalid pool address' });
    }

    logger.info('[GET /:poolAddress/price] Fetching pool price', {
      poolAddress
    });

    // Initialize connection and CP-AMM SDK
    const connection = new Connection(getRpcUrl(), 'confirmed');
    const cpAmm = new CpAmm(connection);

    // Fetch pool state
    let poolState;
    try {
      poolState = await cpAmm.fetchPoolState(poolPubkey);
    } catch (error: any) {
      if (error.message?.includes('not found') || error.message?.includes('Invariant Violation')) {
        logger.warn('[GET /:poolAddress/price] Pool not found', {
          poolAddress
        });
        return res.status(404).json({
          error: 'Pool not found',
          poolAddress
        });
      }
      throw error;
    }

    // Extract decimals (default to standard values if not provided)
    const tokenADecimal = (poolState as any).tokenADecimal ?? 6;
    const tokenBDecimal = (poolState as any).tokenBDecimal ?? 9;

    // Calculate price from sqrt price
    const priceDecimal = getPriceFromSqrtPrice(
      poolState.sqrtPrice,
      tokenADecimal,
      tokenBDecimal
    );

    const price = priceDecimal.toNumber();

    // Get reserves from vaults
    const baseReserve = (poolState as any).tokenAAmount?.toString() || '0';
    const quoteReserve = (poolState as any).tokenBAmount?.toString() || '0';

    const responseData = {
      poolAddress,
      price,
      timestamp: Date.now(),
      liquidity: poolState.liquidity.toString(),
      reserves: {
        base: baseReserve,
        quote: quoteReserve,
      },
      tokenMints: {
        base: poolState.tokenAMint.toBase58(),
        quote: poolState.tokenBMint.toBase58(),
      }
    };

    logger.info('[GET /:poolAddress/price] Pool price fetched successfully', {
      poolAddress,
      price,
      liquidity: poolState.liquidity.toString()
    });

    res.json(responseData);
  } catch (error) {
    logger.error('[GET /:poolAddress/price] Failed to fetch pool price', {
      error: error instanceof Error ? error.message : String(error),
      poolAddress: req.params.poolAddress
    });
    next(error);
  }
});

export default router;
