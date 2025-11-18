/*
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This file is part of Z Combinator.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { Router } from 'express';
import { requireModeratorId, getModerator } from '../middleware/validation';
import { getProposalId } from '../middleware/validation';
import { PublicKey, Transaction } from '@solana/web3.js';
import { LoggerService } from '@app/services/logger.service';

const router = Router();
const logger = new LoggerService('api').createChild('vaults');

// Apply requireModeratorId to all vault routes - no fallback allowed
router.use(requireModeratorId);

// Helper function to get vault from proposal
async function getVault(moderatorId: number, proposalId: number, vaultType: string) {
  const moderator = getModerator(moderatorId);
  
  const proposal = await moderator.getProposal(proposalId);
  if (!proposal) {
    throw new Error('Proposal not found');
  }
  
  // Use the proposal's getVaults() method which handles initialization checks
  const [baseVault, quoteVault] = proposal.getVaults();
  
  if (vaultType === 'base') {
    return baseVault;
  } else if (vaultType === 'quote') {
    return quoteVault;
  } else {
    throw new Error('Invalid vault type. Must be "base" or "quote"');
  }
}


// Build split transaction
router.post('/:id/:type/buildSplitTx', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const proposalId = getProposalId(req);
    const vaultType = req.params.type;

    // Validate request body
    const { user, amount } = req.body;
    if (!user || amount === undefined) {
      logger.warn('[POST /:id/:type/buildSplitTx] Missing required fields', {
        proposalId,
        vaultType,
        receivedFields: Object.keys(req.body)
      });
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['user', 'amount']
      });
    }

    const vault = await getVault(moderatorId, proposalId, vaultType);
    const userPubkey = new PublicKey(user);
    const amountBigInt = BigInt(amount);

    // Vault handles SOL wrapping internally for mainnet quote vaults
    const transaction = await vault.buildSplitTx(userPubkey, amountBigInt);

    logger.info('[POST /:id/:type/buildSplitTx] Split transaction built', {
      proposalId,
      vaultType,
      user,
      amount: amount.toString()
    });

    res.json({
      transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      message: 'Transaction built successfully. User must sign before execution.'
    });
  } catch (error) {
    logger.error('[POST /:id/:type/buildSplitTx] Failed to build split transaction', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id,
      vaultType: req.params.type
    });
    next(error);
  }
});

// Execute split transaction
router.post('/:id/:type/executeSplitTx', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const proposalId = getProposalId(req);
    const vaultType = req.params.type;

    // Validate request body
    const { transaction } = req.body;
    if (!transaction) {
      logger.warn('[POST /:id/:type/executeSplitTx] Missing transaction', {
        proposalId,
        vaultType
      });
      return res.status(400).json({
        error: 'Missing required field: transaction'
      });
    }

    const vault = await getVault(moderatorId, proposalId, vaultType);
    const tx = Transaction.from(Buffer.from(transaction, 'base64'));

    const signature = await vault.executeSplitTx(tx);

    // Save the updated proposal state to database after the split
    const moderator = getModerator(moderatorId);
    const updatedProposal = await moderator.getProposal(proposalId);
    if (updatedProposal) {
      await moderator.saveProposal(updatedProposal);
      logger.info('[POST /:id/:type/executeSplitTx] Split executed and saved', {
        proposalId,
        vaultType,
        signature
      });
    }

    res.json({
      signature,
      status: 'success'
    });
  } catch (error) {
    logger.error('[POST /:id/:type/executeSplitTx] Failed to execute split transaction', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id,
      vaultType: req.params.type
    });
    next(error);
  }
});

// Build merge transaction
router.post('/:id/:type/buildMergeTx', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const proposalId = getProposalId(req);
    const vaultType = req.params.type;

    // Validate request body
    const { user, amount } = req.body;
    if (!user || amount === undefined) {
      logger.warn('[POST /:id/:type/buildMergeTx] Missing required fields', {
        proposalId,
        vaultType,
        receivedFields: Object.keys(req.body)
      });
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['user', 'amount']
      });
    }

    const vault = await getVault(moderatorId, proposalId, vaultType);
    const userPubkey = new PublicKey(user);
    const amountBigInt = BigInt(amount);

    // Vault handles SOL unwrapping internally for mainnet quote vaults
    const transaction = await vault.buildMergeTx(userPubkey, amountBigInt);

    logger.info('[POST /:id/:type/buildMergeTx] Merge transaction built', {
      proposalId,
      vaultType,
      user,
      amount: amount.toString()
    });

    res.json({
      transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      message: 'Transaction built successfully. User must sign before execution.'
    });
  } catch (error) {
    logger.error('[POST /:id/:type/buildMergeTx] Failed to build merge transaction', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id,
      vaultType: req.params.type
    });
    next(error);
  }
});

// Execute merge transaction
router.post('/:id/:type/executeMergeTx', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const proposalId = getProposalId(req);
    const vaultType = req.params.type;

    // Validate request body
    const { transaction } = req.body;
    if (!transaction) {
      logger.warn('[POST /:id/:type/executeMergeTx] Missing transaction', {
        proposalId,
        vaultType
      });
      return res.status(400).json({
        error: 'Missing required field: transaction'
      });
    }

    const vault = await getVault(moderatorId, proposalId, vaultType);
    const tx = Transaction.from(Buffer.from(transaction, 'base64'));

    const signature = await vault.executeMergeTx(tx);

    // Save the updated proposal state to database after the merge
    const moderator = getModerator(moderatorId);
    const updatedProposal = await moderator.getProposal(proposalId);
    if (updatedProposal) {
      await moderator.saveProposal(updatedProposal);
      logger.info('[POST /:id/:type/executeMergeTx] Merge executed and saved', {
        proposalId,
        vaultType,
        signature
      });
    }

    res.json({
      signature,
      status: 'success'
    });
  } catch (error) {
    logger.error('[POST /:id/:type/executeMergeTx] Failed to execute merge transaction', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id,
      vaultType: req.params.type
    });
    next(error);
  }
});

// Build redeem winning tokens transaction
router.post('/:id/:type/buildRedeemWinningTokensTx', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const proposalId = getProposalId(req);
    const vaultType = req.params.type;

    // Validate request body
    const { user } = req.body;
    if (!user) {
      logger.warn('[POST /:id/:type/buildRedeemWinningTokensTx] Missing user', {
        proposalId,
        vaultType
      });
      return res.status(400).json({
        error: 'Missing required field: user'
      });
    }

    const vault = await getVault(moderatorId, proposalId, vaultType);
    const userPubkey = new PublicKey(user);

    // Vault handles SOL unwrapping internally for mainnet quote vaults
    const transaction = await vault.buildRedeemWinningTokensTx(userPubkey);

    logger.info('[POST /:id/:type/buildRedeemWinningTokensTx] Redeem transaction built', {
      proposalId,
      vaultType,
      user
    });

    res.json({
      transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      message: 'Transaction built successfully. User must sign before execution.'
    });
  } catch (error) {
    logger.error('[POST /:id/:type/buildRedeemWinningTokensTx] Failed to build redeem transaction', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id,
      vaultType: req.params.type
    });
    next(error);
  }
});

// Execute redeem winning tokens transaction
router.post('/:id/:type/executeRedeemWinningTokensTx', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const proposalId = getProposalId(req);
    const vaultType = req.params.type;

    // Validate request body
    const { transaction } = req.body;
    if (!transaction) {
      logger.warn('[POST /:id/:type/executeRedeemWinningTokensTx] Missing transaction', {
        proposalId,
        vaultType
      });
      return res.status(400).json({
        error: 'Missing required field: transaction'
      });
    }

    const vault = await getVault(moderatorId, proposalId, vaultType);
    const tx = Transaction.from(Buffer.from(transaction, 'base64'));

    const signature = await vault.executeRedeemWinningTokensTx(tx);

    // Save the updated proposal state to database after the redeem
    const moderator = getModerator(moderatorId);
    const updatedProposal = await moderator.getProposal(proposalId);
    if (updatedProposal) {
      await moderator.saveProposal(updatedProposal);
      logger.info('[POST /:id/:type/executeRedeemWinningTokensTx] Redeem executed and saved', {
        proposalId,
        vaultType,
        signature
      });
    }

    res.json({
      signature,
      status: 'success'
    });
  } catch (error) {
    logger.error('[POST /:id/:type/executeRedeemWinningTokensTx] Failed to execute redeem transaction', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id,
      vaultType: req.params.type
    });
    next(error);
  }
});

// Get user balances for both vaults
router.get('/:id/getUserBalances', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const proposalId = getProposalId(req);
    const { user } = req.query;

    if (!user) {
      logger.warn('[GET /:id/getUserBalances] Missing user parameter', {
        proposalId
      });
      return res.status(400).json({
        error: 'Missing required query parameter: user'
      });
    }

    const moderator = getModerator(moderatorId);

    const proposal = await moderator.getProposal(proposalId);
    if (!proposal) {
      logger.warn('[GET /:id/getUserBalances] Proposal not found', {
        proposalId,
        moderatorId
      });
      return res.status(404).json({ error: 'Proposal not found' });
    }
    const userPubkey = new PublicKey(user as string);

    // Use getVaults() to get both vaults with proper initialization checks
    const [baseVault, quoteVault] = proposal.getVaults();

    // Get balances from both vaults in parallel
    const [baseBalances, quoteBalances] = await Promise.all([
      baseVault.getUserBalances(userPubkey),
      quoteVault.getUserBalances(userPubkey)
    ]);

    const balances = {
      proposalId,
      user: user as string,
      base: {
        regular: baseBalances.regular.toString(),
        passConditional: baseBalances.passConditional.toString(),
        failConditional: baseBalances.failConditional.toString()
      },
      quote: {
        regular: quoteBalances.regular.toString(),
        passConditional: quoteBalances.passConditional.toString(),
        failConditional: quoteBalances.failConditional.toString()
      }
    };

    logger.info('[GET /:id/getUserBalances] User balances retrieved', {
      proposalId,
      user: user as string
    });

    res.json(balances);
  } catch (error) {
    logger.error('[GET /:id/getUserBalances] Failed to get user balances', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id,
      user: req.query.user
    });
    next(error);
  }
});

export default router;