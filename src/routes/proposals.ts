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
import { requireApiKey } from '../middleware/auth';
import { attachModerator, requireModeratorId, getModerator } from '../middleware/validation';
import { Transaction, PublicKey, Connection } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';
import BN from 'bn.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { ExecutionStatus } from '../../app/types/execution.interface';
import { PersistenceService } from '../../app/services/persistence.service';
import { RouterService } from '@app/services/router.service';
import { LoggerService } from '../../app/services/logger.service';
import { getPoolsForWallet, isWalletWhitelisted, POOL_METADATA } from '../config/whitelist';

const routerService = RouterService.getInstance();
const logger = new LoggerService('api').createChild('proposals');

// DAMM Configuration
const DAMM_WITHDRAWAL_PERCENTAGE = 12;

// Type definition for creating a proposal
export interface CreateProposalRequest {
  title: string;
  description?: string;
  proposalLength: number;
  creatorWallet: string; // Creator's wallet address for whitelist verification
  creatorSignature?: string; // Base58-encoded Ed25519 signature on attestation message
  attestationMessage?: string; // JSON attestation message signed by creator
  transaction?: string; // Base64-encoded serialized transaction
  spotPoolAddress?: string; // Optional Meteora pool address for spot market
  totalSupply?: number; // Total supply of conditional tokens (defaults to 1 billion)
  twap?: {
    initialTwapValue: number;
    twapMaxObservationChangePerUpdate: number | null;
    twapStartDelay: number;
    passThresholdBps: number;
    minUpdateInterval: number;
  };
  amm?: {
    initialBaseAmount: string;
    initialQuoteAmount: string;
  };
}

// Response types
export interface ProposalInfo {
  id: number;
  title: string;
  description?: string;
  status: string;
  createdAt: number;
  finalizedAt: number;
  passThresholdBps: number;
}

export interface ProposalsResponse {
  moderatorId: number;
  proposals: ProposalInfo[];
}

const router = Router();

// Apply moderator middleware to all routes (default moderator is 1)
router.use(attachModerator);

router.get('/', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const { poolAddress } = req.query;
    const persistenceService = new PersistenceService(moderatorId, logger.createChild('persistence'));

    logger.info('[GET /] Fetching proposals', { moderatorId, poolAddress: poolAddress || 'all' });

    const proposals = await persistenceService.getProposalsForFrontend();

    // Filter by pool address if provided
    const filteredProposals = poolAddress && typeof poolAddress === 'string'
      ? proposals.filter(p => p.spot_pool_address === poolAddress)
      : proposals;

    const publicProposals = filteredProposals.map(p => ({
      id: p.proposal_id,
      title: p.title,
      description: p.description,
      status: p.status,
      createdAt: new Date(p.created_at).getTime(),
      finalizedAt: new Date(p.finalized_at).getTime(),
      passThresholdBps: typeof p.twap_config === 'string'
        ? JSON.parse(p.twap_config).passThresholdBps
        : p.twap_config.passThresholdBps,
      totalSupply: p.total_supply,
      poolAddress: p.spot_pool_address || null,
      poolName: p.spot_pool_address ? (POOL_METADATA[p.spot_pool_address]?.ticker || 'unknown') : 'unknown',
    }));

    logger.info('[GET /] Fetched proposals successfully', {
      moderatorId,
      count: publicProposals.length,
      poolFilter: poolAddress || 'none'
    });

    res.json({
      moderatorId,
      proposals: publicProposals,
    });
  } catch (error) {
    logger.error('[GET /] Failed to fetch proposals', {
      error: error instanceof Error ? error.message : String(error),
      moderatorId: req.moderatorId
    });
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const moderatorId = req.moderatorId;

    if (isNaN(id) || id < 0) {
      logger.warn('[GET /:id] Invalid proposal ID', {
        providedId: req.params.id
      });
      return res.status(400).json({ error: 'Invalid proposal ID' });
    }

    const persistenceService = new PersistenceService(moderatorId, logger.createChild('persistence'));
    const proposal = await persistenceService.getProposalForFrontend(id);

    if (!proposal) {
      logger.warn('[GET /:id] Proposal not found', {
        proposalId: id,
        moderatorId
      });
      return res.status(404).json({ error: 'Proposal not found' });
    }

    const response = {
      moderatorId,
      id: proposal.id,
      description: proposal.description,
      status: proposal.status,
      createdAt: new Date(proposal.created_at).getTime(),
      finalizedAt: new Date(proposal.finalized_at).getTime(),
      proposalStatus: proposal.status,
      proposalLength: parseInt(proposal.proposal_length),
      baseMint: proposal.base_mint,
      quoteMint: proposal.quote_mint,
      spotPoolAddress: proposal.spot_pool_address,
      totalSupply: proposal.total_supply,
      ammConfig: proposal.amm_config,
      passAmmState: proposal.pass_amm_data,
      failAmmState: proposal.fail_amm_data,
      baseVaultState: proposal.base_vault_data,
      quoteVaultState: proposal.quote_vault_data,
      twapOracleState: proposal.twap_oracle_data,
    };

    logger.info('[GET /:id] Fetched proposal details', {
      proposalId: id,
      moderatorId,
      status: proposal.status
    });

    res.json(response);
  } catch (error) {
    logger.error('[GET /:id] Failed to fetch proposal', {
      proposalId: req.params.id,
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});


// For creating proposals, we should require explicit moderatorId for clarity
router.post('/', requireApiKey, requireModeratorId, async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const body = req.body as CreateProposalRequest;
    const moderator = routerService.getModerator(moderatorId);
    if (!moderator) {
      logger.warn('[POST /] Moderator not found', { moderatorId });
      return res.status(404).json({ error: 'Moderator not found' });
    }

    // Validate required fields - now only title, description, proposalLength, creatorWallet required
    if (!body.title || !body.description || !body.proposalLength || !body.creatorWallet) {
      logger.warn('[POST /] Missing required fields', {
        receivedFields: Object.keys(req.body),
        moderatorId
      });
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['title', 'description', 'proposalLength', 'creatorWallet']
      });
    }

    // Validate attestation fields (user authorization proof for withdrawal)
    if (!body.creatorSignature || !body.attestationMessage) {
      logger.warn('[POST /] Missing attestation fields', {
        receivedFields: Object.keys(req.body),
        moderatorId
      });
      return res.status(400).json({
        error: 'Missing required attestation fields',
        required: ['creatorSignature', 'attestationMessage']
      });
    }

    // Step 0: Validate whitelist and get pool address
    const creatorWallet = body.creatorWallet;
    const spotPoolAddress = body.spotPoolAddress as string | undefined;
    const authorizedPools = getPoolsForWallet(creatorWallet);

    if (authorizedPools.length === 0) {
      logger.warn('[POST /] Creator wallet not whitelisted', {
        creatorWallet,
        moderatorId
      });
      return res.status(403).json({
        error: 'Creator wallet is not authorized to create decision markets',
        wallet: creatorWallet
      });
    }

    // Use pool from request body if provided, otherwise default to first authorized
    let poolAddress: string;
    if (spotPoolAddress) {
      // Validate wallet is authorized for the requested pool
      if (!authorizedPools.includes(spotPoolAddress)) {
        logger.warn('[POST /] Wallet not authorized for requested pool', {
          creatorWallet,
          requestedPool: spotPoolAddress,
          authorizedPools
        });
        return res.status(403).json({
          error: 'Wallet not authorized for requested pool',
          wallet: creatorWallet,
          requestedPool: spotPoolAddress,
          authorizedPools
        });
      }
      poolAddress = spotPoolAddress;
    } else {
      // Backward compatibility: use first authorized pool
      poolAddress = authorizedPools[0];
    }

    const poolMetadata = POOL_METADATA[poolAddress];

    if (!poolMetadata) {
      logger.error('[POST /] Pool metadata not configured', { poolAddress });
      return res.status(500).json({
        error: 'Pool metadata not configured',
        poolAddress
      });
    }

    logger.info('[POST /] Whitelist validation passed', {
      creatorWallet,
      poolAddress,
      poolName: poolMetadata?.ticker || 'Unknown',
      requestedPool: spotPoolAddress || 'not specified'
    });

    // Validate user attestation (proves user authorized the withdrawal)
    const creatorSignature = body.creatorSignature as string;
    const attestationMessage = body.attestationMessage as string;

    let attestation: { action: string; poolAddress: string; timestamp: number; nonce: string };
    try {
      attestation = JSON.parse(attestationMessage);
    } catch (error) {
      logger.warn('[POST /] Invalid attestation format', { moderatorId });
      return res.status(400).json({
        error: 'Invalid attestation format: must be valid JSON'
      });
    }

    // Verify attestation timestamp (5-minute window to prevent replay attacks)
    const FIVE_MINUTES = 5 * 60 * 1000;
    if (Math.abs(Date.now() - attestation.timestamp) > FIVE_MINUTES) {
      logger.warn('[POST /] Attestation expired', {
        moderatorId,
        attestationAge: Math.abs(Date.now() - attestation.timestamp)
      });
      return res.status(400).json({
        error: 'Attestation expired: timestamp outside 5-minute window'
      });
    }

    // Verify attestation action matches withdrawal
    if (attestation.action !== 'withdraw') {
      logger.warn('[POST /] Invalid attestation action', {
        moderatorId,
        action: attestation.action
      });
      return res.status(400).json({
        error: 'Invalid attestation: action must be "withdraw"'
      });
    }

    // Verify attestation pool address matches request
    if (attestation.poolAddress !== poolAddress) {
      logger.warn('[POST /] Attestation pool address mismatch', {
        moderatorId,
        expected: poolAddress,
        received: attestation.poolAddress
      });
      return res.status(400).json({
        error: 'Attestation pool address mismatch'
      });
    }

    // Verify creator signature on attestation message
    const messageBytes = new TextEncoder().encode(attestationMessage);
    const signatureBytes = bs58.decode(creatorSignature);
    const creatorPubKey = new PublicKey(creatorWallet);

    const isCreatorSigValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      creatorPubKey.toBytes()
    );

    if (!isCreatorSigValid) {
      logger.warn('[POST /] Invalid creator signature on attestation', {
        moderatorId,
        creatorWallet
      });
      return res.status(403).json({
        error: 'Invalid creator signature: attestation verification failed'
      });
    }

    logger.info('[POST /] Attestation validated', {
      action: attestation.action,
      poolAddress: attestation.poolAddress,
      creatorWallet
    });

    // Get the proposal counter for this moderator
    const persistenceService = new PersistenceService(moderatorId, logger.createChild('persistence'));
    const proposalCounter = await persistenceService.getProposalIdCounter();

    // Step 1: Withdraw from DAMM pool (using whitelisted pool)
    logger.info('[POST /] Withdrawing from DAMM pool', {
      moderatorId,
      percentage: DAMM_WITHDRAWAL_PERCENTAGE,
      poolAddress
    });

    const withdrawBuildResponse = await fetch(`${process.env.DAMM_API_URL || 'https://api.zcombinator.io'}/damm/withdraw/build`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        withdrawalPercentage: DAMM_WITHDRAWAL_PERCENTAGE,
        poolAddress
      })
    });

    if (!withdrawBuildResponse.ok) {
      const error = await withdrawBuildResponse.json() as { error?: string };
      throw new Error(`DAMM withdrawal build failed: ${error.error || withdrawBuildResponse.statusText}`);
    }

    const withdrawBuildData = await withdrawBuildResponse.json() as {
      requestId: string;
      transaction: string;
      estimatedAmounts: { tokenA: string; tokenB: string };
    };
    logger.info('[POST /] Built DAMM withdrawal transaction', {
      requestId: withdrawBuildData.requestId,
      estimatedAmounts: withdrawBuildData.estimatedAmounts
    });

    // Sign the transaction with pool-specific authority keypair
    const transactionBuffer = bs58.decode(withdrawBuildData.transaction);
    const unsignedTx = Transaction.from(transactionBuffer);
    const poolAuthority = moderator.getAuthorityForPool(poolAddress);
    unsignedTx.sign(poolAuthority);
    const signedTxBase58 = bs58.encode(
      unsignedTx.serialize({ requireAllSignatures: false })
    );

    // Confirm the withdrawal (authority signature validates access)
    const withdrawConfirmResponse = await fetch(`${process.env.DAMM_API_URL || 'https://api.zcombinator.io'}/damm/withdraw/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signedTransaction: signedTxBase58,
        requestId: withdrawBuildData.requestId
      })
    });

    if (!withdrawConfirmResponse.ok) {
      const error = await withdrawConfirmResponse.json() as { error?: string };
      throw new Error(`DAMM withdrawal confirm failed: ${error.error || withdrawConfirmResponse.statusText}`);
    }

    const withdrawConfirmData = await withdrawConfirmResponse.json() as {
      signature: string;
      estimatedAmounts: { tokenA: string; tokenB: string };
    };
    logger.info('[POST /] Confirmed DAMM withdrawal', {
      signature: withdrawConfirmData.signature,
      amounts: withdrawConfirmData.estimatedAmounts
    });

    const initialBaseAmount = withdrawConfirmData.estimatedAmounts.tokenA;
    const initialQuoteAmount = withdrawConfirmData.estimatedAmounts.tokenB;

    // Step 2: Fetch total supply using pool metadata
    const heliusApiKey = process.env.HELIUS_API_KEY;
    const rpcUrl = heliusApiKey
      ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
      : moderator.config.rpcEndpoint;
    const connection = new Connection(rpcUrl, 'confirmed');
    const mintPublicKey = new PublicKey(poolMetadata.baseMint);
    const mintInfo = await getMint(connection, mintPublicKey);
    const totalSupply = Math.floor(Number(mintInfo.supply) / Math.pow(10, mintInfo.decimals));

    logger.info('[POST /] Fetched token supply', {
      totalSupply,
      decimals: mintInfo.decimals,
      tokenMint: poolMetadata.baseMint
    });

    // Step 3: Calculate AMM price from withdrawn amounts
    const baseTokens = parseInt(initialBaseAmount) / Math.pow(10, poolMetadata.baseDecimals);
    const quoteTokens = parseInt(initialQuoteAmount) / Math.pow(10, poolMetadata.quoteDecimals);
    const ammPrice = quoteTokens / baseTokens;

    logger.info('[POST /] Calculated AMM price', {
      baseTokens,
      quoteTokens,
      ammPrice
    });

    // Create the transaction - use memo program if no transaction provided
    let transaction: Transaction;
    if (body.transaction) {
      // Deserialize base64-encoded transaction
      transaction = Transaction.from(Buffer.from(body.transaction, 'base64'));
    } else {
      // Create default memo transaction
      const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
      transaction = new Transaction().add({
        programId: new PublicKey(MEMO_PROGRAM_ID),
        keys: [],
        data: Buffer.from(`Moderator ${moderatorId} Proposal #${proposalCounter}: ${body.title}`)
      });
    }

    // Create the proposal with DAMM-provided amounts
    const proposal = await moderator.createProposal({
      title: body.title,
      description: body.description,
      transaction,
      proposalLength: body.proposalLength,
      spotPoolAddress: poolAddress,
      totalSupply,
      twap: {
        initialTwapValue: ammPrice,
        twapMaxObservationChangePerUpdate: null,
        twapStartDelay: 0,
        passThresholdBps: 0,
        minUpdateInterval: 6000 // 6 seconds
      },
      amm: {
        initialBaseAmount: new BN(initialBaseAmount),
        initialQuoteAmount: new BN(initialQuoteAmount)
      }
    });

    // Store withdrawal metadata automatically
    await persistenceService.storeWithdrawalMetadata(
      proposal.config.id,
      withdrawBuildData.requestId,
      withdrawConfirmData.signature,
      DAMM_WITHDRAWAL_PERCENTAGE,
      initialBaseAmount,
      initialQuoteAmount,
      ammPrice,
      poolAddress
    );

    logger.info('[POST /] Created new proposal with DAMM withdrawal', {
      proposalId: proposal.config.id,
      moderatorId,
      title: body.title,
      proposalLength: body.proposalLength,
      totalSupply,
      ammPrice,
      withdrawalSignature: withdrawConfirmData.signature
    });

    res.status(201).json({
      moderatorId,
      id: proposal.config.id,
      title: proposal.config.title,
      description: proposal.config.description,
      status: proposal.status,
      createdAt: proposal.config.createdAt,
      finalizedAt: proposal.finalizedAt
    });
  } catch (error) {
    logger.error('[POST /] Failed to create DM', {
      error: error instanceof Error ? error.message : String(error),
      moderatorId: req.moderatorId,
      body: req.body
    });
    next(error);
  }
});

router.post('/:id/finalize', requireModeratorId, async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const moderator = getModerator(moderatorId);
    const id = parseInt(req.params.id);

    if (isNaN(id) || id < 0) {
      logger.warn('[POST /:id/finalize] Invalid proposal ID', {
        providedId: req.params.id
      });
      return res.status(400).json({ error: 'Invalid proposal ID' });
    }

    // Get proposal from database (always fresh data)
    const proposal = await moderator.getProposal(id);

    if (!proposal) {
      logger.warn('[POST /:id/finalize] Proposal not found', {
        proposalId: id,
        moderatorId
      });
      return res.status(404).json({ error: 'Proposal not found' });
    }

    // Finalize the proposal
    const status = await moderator.finalizeProposal(id);

    logger.info('[POST /:id/finalize] Proposal finalized', {
      proposalId: id,
      moderatorId,
      status
    });

    res.json({
      moderatorId,
      id,
      status,
      message: `Proposal #${id} finalized with status: ${status}`
    });
  } catch (error) {
    logger.error('[POST /:id/finalize] Failed to finalize proposal', {
      proposalId: req.params.id,
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

router.post('/:id/execute', requireModeratorId, async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const moderator = getModerator(moderatorId);
    const id = parseInt(req.params.id);

    if (isNaN(id) || id < 0) {
      logger.warn('[POST /:id/execute] Invalid proposal ID', {
        providedId: req.params.id
      });
      return res.status(400).json({ error: 'Invalid proposal ID' });
    }

    // Get proposal from database (always fresh data)
    const proposal = await moderator.getProposal(id);

    if (!proposal) {
      logger.warn('[POST /:id/execute] Proposal not found', {
        proposalId: id,
        moderatorId
      });
      return res.status(404).json({ error: 'Proposal not found' });
    }

    // Execute the proposal using the pool-specific authority
    const authority = moderator.getAuthorityForPool(proposal.config.spotPoolAddress);
    const result = await moderator.executeProposal(id, authority);

    logger.info('[POST /:id/execute] Proposal execution completed', {
      proposalId: id,
      moderatorId,
      status: proposal.status,
      executed: result.status === ExecutionStatus.Success,
      signature: result.signature
    });

    res.json({
      moderatorId,
      id,
      status: proposal.status,
      executed: result.status === ExecutionStatus.Success,
      signature: result.signature,
      error: result.error
    });
  } catch (error) {
    logger.error('[POST /:id/execute] Failed to execute proposal', {
      proposalId: req.params.id,
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

export default router;