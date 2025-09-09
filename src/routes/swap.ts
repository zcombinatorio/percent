import { Router } from 'express';
import { requireApiKey } from '../middleware/auth';
import { getModerator } from '../services/moderator.service';
import { PublicKey, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { IAMM } from '../../app/types/amm.interface';

const router = Router();

/**
 * Helper function to get AMM from proposal
 * @param proposalId - The proposal ID
 * @param market - Either 'pass' or 'fail' to select the AMM
 * @returns The requested AMM instance
 */
function getAMM(proposalId: number, market: string): IAMM {
  const moderator = getModerator();
  
  if (proposalId < 0 || proposalId >= moderator.proposals.length) {
    throw new Error('Proposal not found');
  }
  
  const proposal = moderator.proposals[proposalId];
  
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
 * POST /:id/:market/buildSwapTx
 * 
 * Body:
 * - user: string - User's public key who is swapping tokens
 * - isBaseToQuote: boolean - Direction of swap (true: base->quote, false: quote->base)
 * - amountIn: string - Amount of input tokens to swap (as string to preserve precision)
 * - slippageBps?: number - Optional slippage tolerance in basis points (default: 50 = 0.5%)
 */
router.post('/:id/:market/buildSwapTx', requireApiKey, async (req, res, next) => {
  try {
    const proposalId = parseInt(req.params.id);
    const market = req.params.market;
    
    // Validate request body
    const { user, isBaseToQuote, amountIn, slippageBps } = req.body;
    
    if (!user || isBaseToQuote === undefined || amountIn === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['user', 'isBaseToQuote', 'amountIn'],
        optional: ['slippageBps']
      });
    }
    
    // Validate isBaseToQuote is boolean
    if (typeof isBaseToQuote !== 'boolean') {
      return res.status(400).json({ 
        error: 'Invalid field type: isBaseToQuote must be a boolean'
      });
    }
    
    // Validate slippageBps if provided
    if (slippageBps !== undefined && (typeof slippageBps !== 'number' || slippageBps < 0)) {
      return res.status(400).json({ 
        error: 'Invalid slippageBps: must be a positive number'
      });
    }
    
    // Get the appropriate AMM
    const amm = getAMM(proposalId, market);
    
    // Convert values
    const userPubkey = new PublicKey(user);
    const amountInBN = new BN(amountIn);
    
    // Build the swap transaction
    const transaction = await amm.buildSwapTx(
      userPubkey,
      isBaseToQuote,
      amountInBN,
      slippageBps
    );
    
    res.json({
      transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      message: 'Swap transaction built successfully. User must sign before execution.'
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Execute a pre-signed swap transaction
 * POST /:id/:market/executeSwapTx
 * 
 * Body:
 * - transaction: string - Base64 encoded signed transaction
 */
router.post('/:id/:market/executeSwapTx', requireApiKey, async (req, res, next) => {
  try {
    const proposalId = parseInt(req.params.id);
    const market = req.params.market;
    
    // Validate request body
    const { transaction } = req.body;
    if (!transaction) {
      return res.status(400).json({ 
        error: 'Missing required field: transaction'
      });
    }
    
    // Get the appropriate AMM
    const amm = getAMM(proposalId, market);
    
    // Deserialize the transaction
    const tx = Transaction.from(Buffer.from(transaction, 'base64'));
    
    // Execute the swap
    const signature = await amm.executeSwapTx(tx);
    
    res.json({
      signature,
      status: 'success',
      message: `Swap executed successfully on ${market} market`
    });
  } catch (error) {
    next(error);
  }
});


/**
 * Get current price from the specified AMM
 * GET /:id/:market/price
 * 
 * Returns the current price as base/quote ratio
 */
router.get('/:id/:market/price', async (req, res, next) => {
  try {
    const proposalId = parseInt(req.params.id);
    const market = req.params.market;
    
    // Get the appropriate AMM
    const amm = getAMM(proposalId, market);
    
    // Fetch current price
    const price = await amm.fetchPrice();
    
    res.json({
      proposalId,
      market,
      price: price.toString(),
      baseMint: amm.baseMint.toString(),
      quoteMint: amm.quoteMint.toString()
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get AMM pool information
 * GET /:id/:market/info
 * 
 * Returns pool address and position information if available
 */
router.get('/:id/:market/info', async (req, res, next) => {
  try {
    const proposalId = parseInt(req.params.id);
    const market = req.params.market;
    
    // Get the appropriate AMM
    const amm = getAMM(proposalId, market);
    
    res.json({
      proposalId,
      market,
      state: amm.state,
      isFinalized: amm.isFinalized,
      baseMint: amm.baseMint.toString(),
      quoteMint: amm.quoteMint.toString(),
      baseDecimals: amm.baseDecimals,
      quoteDecimals: amm.quoteDecimals,
      pool: amm.pool?.toString() || null,
      position: amm.position?.toString() || null,
      positionNft: amm.positionNft?.toString() || null
    });
  } catch (error) {
    next(error);
  }
});

export default router;