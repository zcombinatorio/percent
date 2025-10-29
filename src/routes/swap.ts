import { Router } from 'express';
import { requireModeratorId, getProposalId, getModerator } from '../middleware/validation';
import { PublicKey, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { IAMM } from '../../app/types/amm.interface';
import { HistoryService } from '../../app/services/history.service';
import { LoggerService } from '@app/services/logger.service';
import { Decimal } from 'decimal.js';

const router = Router();
const logger = new LoggerService('api').createChild('swap');

// Apply requireModeratorId to all swap routes - no fallback allowed
router.use(requireModeratorId);

/**
 * Helper function to get AMM from proposal
 * @param moderatorId - The moderator ID
 * @param proposalId - The proposal ID
 * @param market - Either 'pass' or 'fail' to select the AMM
 * @returns The requested AMM instance
 */
async function getAMM(moderatorId: number, proposalId: number, market: string): Promise<IAMM> {
  const moderator = getModerator(moderatorId);

  // Get proposal from database (always fresh data)
  const proposal = await moderator.getProposal(proposalId);

  if (!proposal) {
    throw new Error('Proposal not found');
  }

  // Use the proposal's getAMMs() method which handles initialization checks
  const [pAMM, fAMM] = proposal.getAMMs();

  if (market === 'pass') {
    return pAMM;
  } else if (market === 'fail') {
    return fAMM;
  } else {
    throw new Error('Invalid market type. Must be "pass" or "fail"');
  }
}

/**
 * Build a swap transaction for the specified AMM
 * POST /:id/buildSwapTx
 * 
 * Body:
 * - user: string - User's public key who is swapping tokens
 * - market: string - Market to swap in ('pass' or 'fail')
 * - isBaseToQuote: boolean - Direction of swap (true: base->quote, false: quote->base)
 * - amountIn: string - Amount of input tokens to swap (as string to preserve precision)
 * - slippageBps?: number - Optional slippage tolerance in basis points (default: 50 = 0.5%)
 */
router.post('/:id/buildSwapTx', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const proposalId = getProposalId(req);

    // Validate request body
    const { user, market, isBaseToQuote, amountIn, slippageBps } = req.body;

    if (!user || !market || isBaseToQuote === undefined || amountIn === undefined) {
      logger.warn('[POST /:id/buildSwapTx] Missing required fields', {
        proposalId,
        receivedFields: Object.keys(req.body)
      });
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['user', 'market', 'isBaseToQuote', 'amountIn'],
        optional: ['slippageBps']
      });
    }

    // Validate market is valid
    if (market !== 'pass' && market !== 'fail') {
      logger.warn('[POST /:id/buildSwapTx] Invalid market', {
        proposalId,
        market
      });
      return res.status(400).json({
        error: 'Invalid market: must be "pass" or "fail"'
      });
    }

    // Validate isBaseToQuote is boolean
    if (typeof isBaseToQuote !== 'boolean') {
      logger.warn('[POST /:id/buildSwapTx] Invalid isBaseToQuote type', {
        proposalId,
        isBaseToQuote,
        type: typeof isBaseToQuote
      });
      return res.status(400).json({
        error: 'Invalid field type: isBaseToQuote must be a boolean'
      });
    }

    // Validate slippageBps if provided
    if (slippageBps !== undefined && (typeof slippageBps !== 'number' || slippageBps < 0)) {
      logger.warn('[POST /:id/buildSwapTx] Invalid slippageBps', {
        proposalId,
        slippageBps
      });
      return res.status(400).json({
        error: 'Invalid slippageBps: must be a positive number'
      });
    }

    // Get the appropriate AMM
    const amm = await getAMM(moderatorId, proposalId, market);

    // Convert values
    const userPubkey = new PublicKey(user);
    const amountInBN = new BN(amountIn);

    // Get quote to know expected output amount
    const quote = await amm.getQuote(isBaseToQuote, amountInBN, slippageBps);

    // Build the swap transaction
    const transaction = await amm.buildSwapTx(
      userPubkey,
      isBaseToQuote,
      amountInBN,
      slippageBps
    );

    logger.info('[POST /:id/buildSwapTx] Swap transaction built', {
      proposalId,
      market,
      user,
      isBaseToQuote,
      amountIn: amountIn.toString(),
      expectedAmountOut: quote.swapOutAmount.toString()
    });

    res.json({
      transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      expectedAmountOut: quote.swapOutAmount.toString(),
      message: 'Swap transaction built successfully. User must sign before execution.'
    });
  } catch (error) {
    logger.error('[POST /:id/buildSwapTx] Failed to build swap transaction', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id,
      market: req.body.market
    });
    next(error);
  }
});

/**
 * Execute a pre-signed swap transaction
 * POST /:id/executeSwapTx
 * 
 * Body:
 * - transaction: string - Base64 encoded signed transaction
 * - market: string - Market to swap in ('pass' or 'fail')
 * - user: string - User's public key (for trade logging)
 * - isBaseToQuote: boolean - Direction of swap
 * - amountIn: string - Amount of input tokens
 * - amountOut: string - Amount of output tokens (optional, can be calculated)
 */
router.post('/:id/executeSwapTx', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const proposalId = getProposalId(req);

    // Validate request body
    const { transaction, market, user, isBaseToQuote, amountIn, amountOut } = req.body;
    if (!transaction || !market || !user || isBaseToQuote === undefined || !amountIn) {
      logger.warn('[POST /:id/executeSwapTx] Missing required fields', {
        proposalId,
        receivedFields: Object.keys(req.body)
      });
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['transaction', 'market', 'user', 'isBaseToQuote', 'amountIn'],
        optional: ['amountOut']
      });
    }

    // Validate market is valid
    if (market !== 'pass' && market !== 'fail') {
      logger.warn('[POST /:id/executeSwapTx] Invalid market', {
        proposalId,
        market
      });
      return res.status(400).json({
        error: 'Invalid market: must be "pass" or "fail"'
      });
    }

    // Get the appropriate AMM
    const amm = await getAMM(moderatorId, proposalId, market);

    // Deserialize the transaction
    const tx = Transaction.from(Buffer.from(transaction, 'base64'));

    // Execute the swap
    const signature = await amm.executeSwapTx(tx);

    // Save the updated proposal state to database after the swap
    const moderator = getModerator(moderatorId);
    const updatedProposal = await moderator.getProposal(proposalId);
    if (updatedProposal) {
      await moderator.saveProposal(updatedProposal);
      logger.info('[POST /:id/executeSwapTx] Swap executed and saved', {
        proposalId,
        market,
        signature
      });
    }
    
    // Log trade to history (required parameters are now validated above)
    try {
      // Get current price for the trade
      let currentPrice: Decimal;
      try {
        currentPrice = await amm.fetchPrice();
      } catch {
        // If we can't fetch price, estimate from amounts
        if (amountOut) {
          const inAmount = new Decimal(amountIn);
          const outAmount = new Decimal(amountOut);
          currentPrice = isBaseToQuote ? outAmount.div(inAmount) : inAmount.div(outAmount);
        } else {
          currentPrice = new Decimal(0); // fallback
        }
      }
      
      // Convert raw amounts to human-readable amounts using token decimals
      const baseDecimals = amm.baseDecimals;
      const quoteDecimals = amm.quoteDecimals;
      
      // Determine which decimals to use based on trade direction
      const inputDecimals = isBaseToQuote ? baseDecimals : quoteDecimals;
      const outputDecimals = isBaseToQuote ? quoteDecimals : baseDecimals;
      
      // Convert to human-readable amounts
      const amountInDecimal = new Decimal(amountIn).div(Math.pow(10, inputDecimals));
      const amountOutDecimal = amountOut ? new Decimal(amountOut).div(Math.pow(10, outputDecimals)) : new Decimal(0);
      
      await HistoryService.recordTrade({
        moderatorId,
        proposalId,
        market: market as 'pass' | 'fail',
        userAddress: user,
        isBaseToQuote: isBaseToQuote,
        amountIn: amountInDecimal,
        amountOut: amountOutDecimal,
        price: currentPrice,
        txSignature: signature,
      });

      logger.info('[POST /:id/executeSwapTx] Trade logged to history', {
        proposalId,
        market,
        user
      });
    } catch (logError) {
      logger.error('[POST /:id/executeSwapTx] Failed to log trade to history', {
        error: logError instanceof Error ? logError.message : String(logError),
        proposalId,
        market
      });
      // Continue even if logging fails
    }

    res.json({
      signature,
      status: 'success',
      message: `Swap executed successfully on ${market} market`
    });
  } catch (error) {
    logger.error('[POST /:id/executeSwapTx] Failed to execute swap transaction', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id,
      market: req.body.market
    });
    next(error);
  }
});

/**
 * Get quote from conditional AMM
 * GET /:id/:market/quote
 * 
 * Query params:
 * - isBaseToQuote: boolean - Direction of swap (true: base->quote, false: quote->base)
 * - amountIn: string - Amount of input tokens (as string to preserve precision)
 * - slippageBps?: number - Optional slippage tolerance in basis points (default: 50 = 0.5%)
 */
router.get('/:id/:market/quote', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const proposalId = getProposalId(req);
    const market = req.params.market;

    // Validate market
    if (market !== 'pass' && market !== 'fail') {
      logger.warn('[GET /:id/:market/quote] Invalid market', {
        proposalId,
        market
      });
      return res.status(400).json({
        error: 'Invalid market: must be "pass" or "fail"'
      });
    }

    // Validate query parameters
    const { isBaseToQuote, amountIn, slippageBps } = req.query;

    if (isBaseToQuote === undefined || !amountIn) {
      logger.warn('[GET /:id/:market/quote] Missing required query params', {
        proposalId,
        market,
        receivedParams: Object.keys(req.query)
      });
      return res.status(400).json({
        error: 'Missing required query parameters',
        required: ['isBaseToQuote', 'amountIn'],
        optional: ['slippageBps']
      });
    }

    // Parse isBaseToQuote
    const direction = isBaseToQuote === 'true';

    // Validate slippageBps if provided
    const slippage = slippageBps ? parseInt(slippageBps as string) : 50;
    if (isNaN(slippage) || slippage < 0) {
      logger.warn('[GET /:id/:market/quote] Invalid slippageBps', {
        proposalId,
        market,
        slippageBps
      });
      return res.status(400).json({
        error: 'Invalid slippageBps: must be a positive number'
      });
    }

    // Get the appropriate AMM
    const amm = await getAMM(moderatorId, proposalId, market);

    // Convert amount
    const amountInBN = new BN(amountIn as string);

    // Validate amount is greater than 0
    if (amountInBN.lte(new BN(0))) {
      return res.status(400).json({
        error: 'Amount must be greater than 0'
      });
    }

    // Get quote from AMM
    let quote;
    try {
      quote = await amm.getQuote(direction, amountInBN, slippage);
    } catch (quoteError: any) {
      // Handle specific AMM errors gracefully
      if (quoteError.message?.includes('Amount out must be greater than 0')) {
        return res.status(400).json({
          error: 'Amount too small - would result in zero output'
        });
      }
      throw quoteError;
    }

    // Determine input and output mints based on direction
    const inputMint = direction ? amm.baseMint : amm.quoteMint;
    const outputMint = direction ? amm.quoteMint : amm.baseMint;

    logger.info('[GET /:id/:market/quote] Quote fetched', {
      proposalId,
      market,
      isBaseToQuote: direction,
      amountIn: amountIn as string,
      amountOut: quote.swapOutAmount.toString()
    });

    res.json({
      proposalId,
      market: market as 'pass' | 'fail',
      isBaseToQuote: direction,
      swapInAmount: quote.swapInAmount.toString(),
      consumedInAmount: quote.consumedInAmount.toString(),
      swapOutAmount: quote.swapOutAmount.toString(),
      minSwapOutAmount: quote.minSwapOutAmount.toString(),
      totalFee: quote.totalFee.toString(),
      priceImpact: quote.priceImpact,
      slippageBps: slippage,
      inputMint: inputMint.toString(),
      outputMint: outputMint.toString()
    });
  } catch (error) {
    logger.error('[GET /:id/:market/quote] Failed to get quote', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id,
      market: req.params.market
    });
    next(error);
  }
});

export default router;