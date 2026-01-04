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
import { getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { PersistenceService } from '../../app/services/persistence.service';
import { RouterService } from '@app/services/router.service';
import { LoggerService } from '../../app/services/logger.service';
import { ProposalStatus } from '../../app/types/moderator.interface';
import { POOL_METADATA, getAuthorizedPoolsAsync, AuthMethod } from '../config/whitelist';
import { VaultType } from '@zcomb/vault-sdk';
import { normalizeWithdrawBuildResponse, calculateMarketPriceFromAmounts } from '../../app/utils/pool-api.utils';
import { getPool } from '../../app/utils/database';
import { initStakingVaultService, StakingVaultService } from '../../app/services/staking-vault.service';

// Staking vault constants for slash amount calculation
const STAKING_PROGRAM_ID = new PublicKey("47rZ1jgK7zU6XAgffAfXkDX1JkiiRi4HRPBytossWR12");
const ZC_TOKEN_MINT = new PublicKey("GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC");

const routerService = RouterService.getInstance();
const logger = new LoggerService('api').createChild('proposals');

// Initialize Solana connection for token balance checks
const rpcUrl = process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const authConnection = new Connection(rpcUrl, 'confirmed');

// Initialize staking vault service for slash execution
let stakingVaultService: StakingVaultService | null = null;
try {
  stakingVaultService = initStakingVaultService(authConnection);
  if (stakingVaultService) {
    logger.info('StakingVaultService initialized for slash execution');
  }
} catch (error) {
  logger.warn('Failed to initialize StakingVaultService', {
    error: error instanceof Error ? error.message : String(error)
  });
}

// Type definition for creating a proposal
export interface CreateProposalRequest {
  title: string;
  description?: string;
  markets?: number; // Number of markets (2-4)
  market_labels?: string[]; // Optional labels for each market
  proposalLength: number;
  creatorWallet: string; // Creator's wallet address for whitelist verification
  creatorSignature?: string; // Base58-encoded Ed25519 signature on attestation message
  attestationMessage?: string; // JSON attestation message signed by creator
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
  markets: number;
  marketLabels?: string[];
}

export interface ProposalsResponse {
  moderatorId: number;
  proposals: ProposalInfo[];
}

const router = Router();

// Apply moderator middleware to all routes (default moderator is 1)
router.use(attachModerator);

// Production moderator IDs for /all endpoint
const PRODUCTION_MODERATOR_IDS = [2, 6]; // ZC, SURF

/**
 * GET /api/proposals/all
 * Returns all proposals from production pools (ZC, SURF)
 * No authentication required - public read-only endpoint
 * Uses lightweight query that doesn't require authority keys
 */
router.get('/all', async (_req, res, next) => {
  try {
    logger.info('[GET /all] Fetching all proposals from production pools');

    const allProposals: Array<{
      id: number;
      title: string;
      description?: string;
      status: string;
      winningMarketIndex?: number;
      winningMarketLabel?: string;
      createdAt: number;
      finalizedAt: number;
      passThresholdBps: number;
      markets: number;
      marketLabels?: string[];
      totalSupply?: number;
      baseDecimals: number;
      quoteDecimals: number;
      poolAddress: string | null;
      poolName: string;
      moderatorId: number;
      tokenTicker: string;
      tokenIcon: string | null;
    }> = [];

    // Fetch proposal summaries from each production moderator (lightweight, no deserialization)
    for (const modId of PRODUCTION_MODERATOR_IDS) {
      const persistenceService = new PersistenceService(modId, logger.createChild('persistence'));
      const proposals = await persistenceService.loadProposalSummaries();

      for (const p of proposals) {
        const poolAddress = p.spotPoolAddress || null;
        const poolMeta = poolAddress ? POOL_METADATA[poolAddress] : null;

        allProposals.push({
          id: p.id,
          title: p.title,
          description: p.description,
          status: p.status,
          winningMarketIndex: p.winningMarketIndex,
          winningMarketLabel: p.winningMarketLabel,
          createdAt: p.createdAt,
          finalizedAt: p.finalizedAt,
          passThresholdBps: p.passThresholdBps,
          markets: p.markets,
          marketLabels: p.marketLabels,
          totalSupply: p.totalSupply,
          baseDecimals: p.baseDecimals,
          quoteDecimals: p.quoteDecimals,
          poolAddress,
          poolName: poolMeta?.ticker || 'unknown',
          moderatorId: modId,
          tokenTicker: poolMeta?.ticker?.toUpperCase() || 'UNKNOWN',
          tokenIcon: poolMeta?.icon || null,
        });
      }
    }

    // Sort by creation time (newest first)
    allProposals.sort((a, b) => b.createdAt - a.createdAt);

    logger.info('[GET /all] Fetched all proposals successfully', {
      count: allProposals.length,
      moderatorIds: PRODUCTION_MODERATOR_IDS
    });

    res.json({
      proposals: allProposals,
    });
  } catch (error) {
    logger.error('[GET /all] Failed to fetch all proposals', {
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const { poolAddress } = req.query;
    const persistenceService = new PersistenceService(moderatorId, logger.createChild('persistence'));

    logger.info('[GET /] Fetching proposals', { moderatorId, poolAddress: poolAddress || 'all' });

    const proposals = await persistenceService.loadAllProposals();

    // Filter by pool address if provided
    const filteredProposals = poolAddress && typeof poolAddress === 'string'
    ? proposals.filter(p => p.config.spotPoolAddress === poolAddress)
    : proposals;

    const publicProposals = proposals.map(p => {
      const statusInfo = p.getStatus();
      return {
        id: p.config.id,
        title: p.config.title,
        description: p.config.description,
        status: statusInfo.status,
        winningMarketIndex: statusInfo.winningMarketIndex,
        winningMarketLabel: statusInfo.winningMarketLabel,
        createdAt: p.config.createdAt,
        finalizedAt: p.finalizedAt,
        passThresholdBps: p.config.twap.passThresholdBps,
        markets: p.config.markets,
        marketLabels: p.config.market_labels,
        totalSupply: p.config.totalSupply,
        baseDecimals: p.config.baseDecimals,
        quoteDecimals: p.config.quoteDecimals,
        poolAddress: p.config.spotPoolAddress || null,
        poolName: p.config.spotPoolAddress? (POOL_METADATA[p.config.spotPoolAddress]?.ticker || 'unknown') : 'unknown',
        vaultPDA: p.deriveVaultPDA(VaultType.Base).toBase58(),
      };
    });

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
    const proposal = await persistenceService.loadProposal(id);

    if (!proposal) {
      logger.warn('[GET /:id] Proposal not found', {
        proposalId: id,
        moderatorId
      });
      return res.status(404).json({ error: 'Proposal not found' });
    }

    const statusInfo = proposal.getStatus();
    const serialized = proposal.serialize();

    const response = {
      moderatorId,
      id: proposal.config.id,
      title: proposal.config.title,
      description: proposal.config.description,
      status: statusInfo.status,
      winningMarketIndex: statusInfo.winningMarketIndex,
      winningMarketLabel: statusInfo.winningMarketLabel,
      winningBaseConditionalMint: statusInfo.winningBaseConditionalMint?.toString() ?? null,
      winningQuoteConditionalMint: statusInfo.winningQuoteConditionalMint?.toString() ?? null,
      createdAt: proposal.config.createdAt,
      finalizedAt: proposal.finalizedAt,
      proposalLength: proposal.config.proposalLength,
      baseMint: proposal.config.baseMint.toString(),
      quoteMint: proposal.config.quoteMint.toString(),
      spotPoolAddress: proposal.config.spotPoolAddress,
      totalSupply: proposal.config.totalSupply,
      baseDecimals: proposal.config.baseDecimals,
      quoteDecimals: proposal.config.quoteDecimals,
      markets: proposal.config.markets,
      marketLabels: proposal.config.market_labels,
      ammConfig: serialized.ammConfig,
      ammData: serialized.AMMData,
      twapOracleState: serialized.twapOracleData,
      vaultPDA: proposal.deriveVaultPDA(VaultType.Base).toBase58(),
    };

    logger.info('[GET /:id] Fetched proposal details', {
      proposalId: id,
      moderatorId,
      status: statusInfo.status
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

    // Check for existing active proposal (only one allowed per moderator/pool at a time)
    const persistenceService = new PersistenceService(moderatorId, logger.createChild('persistence'));
    const existingProposals = await persistenceService.loadAllProposals();
    const activeProposal = existingProposals.find(p => p.getStatus().status === ProposalStatus.Pending);

    if (activeProposal) {
      logger.warn('[POST /] Active proposal already exists', {
        moderatorId,
        activeProposalId: activeProposal.config.id,
        activeProposalTitle: activeProposal.config.title,
      });
      return res.status(409).json({
        error: 'An active proposal already exists for this pool',
        activeProposal: {
          id: activeProposal.config.id,
          title: activeProposal.config.title,
          createdAt: activeProposal.config.createdAt,
        },
      });
    }

    // Validate required fields - title, description, proposalLength, creatorWallet required
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

    // Step 0: Validate authorization (whitelist OR token balance) and get pool address
    const creatorWallet = body.creatorWallet;
    const spotPoolAddress = body.spotPoolAddress as string | undefined;

    // Get authorized pools (checks both whitelist and token balance)
    const authorizedPools = await getAuthorizedPoolsAsync(authConnection, creatorWallet);

    if (authorizedPools.length === 0) {
      logger.warn('[POST /] Creator wallet not authorized', {
        creatorWallet,
        moderatorId
      });
      return res.status(403).json({
        error: 'Creator wallet is not authorized to create decision markets. You need to be whitelisted or hold the minimum required token balance.',
        wallet: creatorWallet
      });
    }

    // Use pool from request body if provided, otherwise default to first authorized
    let poolAddress: string;
    let authMethod: AuthMethod;
    if (spotPoolAddress) {
      // Validate wallet is authorized for the requested pool
      const poolAuth = authorizedPools.find(p => p.poolAddress === spotPoolAddress);
      if (!poolAuth) {
        logger.warn('[POST /] Wallet not authorized for requested pool', {
          creatorWallet,
          requestedPool: spotPoolAddress,
          authorizedPools: authorizedPools.map(p => p.poolAddress)
        });
        return res.status(403).json({
          error: 'Wallet not authorized for requested pool',
          wallet: creatorWallet,
          requestedPool: spotPoolAddress,
          authorizedPools: authorizedPools.map(p => p.poolAddress)
        });
      }
      poolAddress = spotPoolAddress;
      authMethod = poolAuth.authMethod;
    } else {
      // Backward compatibility: use first authorized pool
      poolAddress = authorizedPools[0].poolAddress;
      authMethod = authorizedPools[0].authMethod;
    }

    const poolMetadata = POOL_METADATA[poolAddress];

    if (!poolMetadata) {
      logger.error('[POST /] Pool metadata not configured', { poolAddress });
      return res.status(500).json({
        error: 'Pool metadata not configured',
        poolAddress
      });
    }

    logger.info('[POST /] Authorization validation passed', {
      creatorWallet,
      poolAddress,
      poolName: poolMetadata?.ticker || 'Unknown',
      requestedPool: spotPoolAddress || 'not specified',
      authMethod
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

    // Validate markets count
    if (body.markets && (body.markets < 2 || body.markets > 8)) {
      logger.warn('[POST /] Invalid markets count', {
        markets: body.markets,
        moderatorId
      });
      return res.status(400).json({
        error: 'Invalid markets count: must be between 2 and 8'
      });
    }

    // Get withdrawal percentage from pool config
    const withdrawalPercentage = poolMetadata.withdrawalPercentage;

    // Step 1: Build withdrawal transaction (confirmation happens in Proposal.initialize())
    // Route to correct endpoint based on pool type (DAMM vs DLMM)
    const poolType = poolMetadata.poolType;
    const apiUrl = process.env.DAMM_API_URL || 'https://api.zcombinator.io';
    const withdrawEndpoint = poolType === 'dlmm'
      ? `${apiUrl}/dlmm/withdraw/build`
      : `${apiUrl}/damm/withdraw/build`;

    logger.info('[POST /] Building withdrawal transaction', {
      moderatorId,
      percentage: withdrawalPercentage,
      poolAddress,
      poolType
    });

    const withdrawBuildResponse = await fetch(withdrawEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        withdrawalPercentage,
        poolAddress
      })
    });

    if (!withdrawBuildResponse.ok) {
      const error = await withdrawBuildResponse.json() as { error?: string };
      throw new Error(`${poolType.toUpperCase()} withdrawal build failed: ${error.error || withdrawBuildResponse.statusText}`);
    }

    // Parse and normalize the API response using explicit pool-type branching
    // DLMM returns tokenX/Y, DAMM returns tokenA/B - normalized to tokenA/B internally
    const withdrawBuildDataRaw = await withdrawBuildResponse.json();
    const withdrawBuildData = normalizeWithdrawBuildResponse(withdrawBuildDataRaw, poolType);

    logger.info('[POST /] Built withdrawal transaction(s)', {
      requestId: withdrawBuildData.requestId,
      marketPrice: withdrawBuildData.marketPrice,
      withdrawn: withdrawBuildData.withdrawn,
      transferred: withdrawBuildData.transferred,
      redeposited: withdrawBuildData.redeposited,
      poolType,
      transactionCount: withdrawBuildData.transactions?.length || 1
    });

    // Sign the transaction(s) with pool-specific authority keypair
    const poolAuthority = moderator.getAuthorityForPool(poolAddress);
    let signedTxBase58: string | undefined;
    let signedTxsBase58: string[] | undefined;

    if (poolType === 'dlmm' && withdrawBuildData.transactions) {
      // DLMM: Sign all transactions in the array
      signedTxsBase58 = withdrawBuildData.transactions.map(txBase58 => {
        const transactionBuffer = bs58.decode(txBase58);
        const unsignedTx = Transaction.from(transactionBuffer);
        unsignedTx.sign(poolAuthority);
        return bs58.encode(unsignedTx.serialize({ requireAllSignatures: false }));
      });
      logger.info('[POST /] Signed DLMM transactions', { count: signedTxsBase58.length });
    } else if (withdrawBuildData.transaction) {
      // DAMM: Sign single transaction
      const transactionBuffer = bs58.decode(withdrawBuildData.transaction);
      const unsignedTx = Transaction.from(transactionBuffer);
      unsignedTx.sign(poolAuthority);
      signedTxBase58 = bs58.encode(unsignedTx.serialize({ requireAllSignatures: false }));
    } else {
      throw new Error('No transaction(s) returned from withdrawal build');
    }

    // Use transferred amounts for initial liquidity (what manager receives at market price)
    const initialBaseAmount = withdrawBuildData.transferred.tokenA;
    const initialQuoteAmount = withdrawBuildData.transferred.tokenB;

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

    // Step 3: Calculate AMM price from transferred amounts
    // Both DAMM and DLMM use the same calculation - amounts are the ground truth
    // (DLMM withdrawal already adjusts amounts to match Jupiter market price)
    const ammPrice = calculateMarketPriceFromAmounts(
      initialBaseAmount,
      initialQuoteAmount,
      poolMetadata.baseDecimals,
      poolMetadata.quoteDecimals
    );
    logger.info('[POST /] Calculated AMM price from amounts', { ammPrice, poolType });

    // TEST OVERRIDE: Force test pool proposals to 1 minute for testing
    const TESTSURF_POOL = 'EC7MUufEpZcRZyXTFt16MMNLjJVnj9Vkku4UwdZ713Hx'; // DLMM
    const SURFTEST_POOL = 'PS3rPSb49GnAkmh3tec1RQizgNSb1hUwPsYHGGuAy5r'; // DAMM
    const isTestPool = poolAddress === TESTSURF_POOL || poolAddress === SURFTEST_POOL;
    const effectiveProposalLength = isTestPool ? 60 : body.proposalLength;

    // Create the proposal with DAMM withdrawal data (confirmation happens in initialize())
    const proposal = await moderator.createProposal({
      title: body.title,
      description: body.description,
      markets: body.markets || 2,
      market_labels: body.market_labels || ["Fail", "Pass"],
      proposalLength: effectiveProposalLength,
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
      },
      dammWithdrawal: {
        requestId: withdrawBuildData.requestId,
        signedTransaction: signedTxBase58,       // DAMM single tx
        signedTransactions: signedTxsBase58,     // DLMM multi tx
        withdrawalPercentage,
        withdrawn: withdrawBuildData.withdrawn,
        transferred: withdrawBuildData.transferred,
        redeposited: withdrawBuildData.redeposited,
        poolAddress,
        poolType,
      }
    });

    logger.info('[POST /] Created new proposal with DAMM withdrawal', {
      proposalId: proposal.config.id,
      moderatorId,
      title: body.title,
      proposalLength: effectiveProposalLength,
      requestedProposalLength: body.proposalLength,
      totalSupply,
      ammPrice
    });

    res.status(201).json({
      moderatorId,
      id: proposal.config.id,
      title: proposal.config.title,
      description: proposal.config.description,
      status: proposal.getStatus().status,
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

    // Check if this is a slash proposal and record the slash if applicable
    try {
      await recordSlashIfApplicable(moderatorId, id, proposal);
    } catch (slashError) {
      // Log but don't fail the finalization if slash recording fails
      logger.error('[POST /:id/finalize] Failed to record slash', {
        proposalId: id,
        error: slashError instanceof Error ? slashError.message : String(slashError)
      });
    }

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

/**
 * Helper function to record a slash if the finalized proposal is a slash proposal
 * with a winning outcome other than "No"
 */
async function recordSlashIfApplicable(
  moderatorId: number,
  proposalId: number,
  proposal: { config: { title: string; market_labels?: string[] }; getStatus: () => { winningMarketIndex?: number | null; winningMarketLabel?: string | null } }
): Promise<void> {
  const title = proposal.config.title;

  // Check if this is a slash proposal (contains "slash" and a Solana address)
  if (!title.toLowerCase().includes('slash')) {
    return; // Not a slash proposal
  }

  // Extract Solana wallet address (32-44 base58 characters)
  const walletMatch = title.match(/([A-Za-z0-9]{32,44})/);
  if (!walletMatch) {
    logger.info('[recordSlash] Slash keyword found but no wallet address in title', { proposalId, title });
    return;
  }

  const targetWallet = walletMatch[1];
  const statusInfo = proposal.getStatus();

  // Get the winning market label
  const winningLabel = statusInfo.winningMarketLabel;
  if (!winningLabel) {
    logger.info('[recordSlash] No winning label found', { proposalId, moderatorId });
    return;
  }

  // Check if the winning outcome is "No" - if so, no slash occurs
  if (winningLabel.toLowerCase() === 'no') {
    logger.info('[recordSlash] Slash proposal resolved to No - no slash recorded', {
      proposalId,
      moderatorId,
      targetWallet
    });
    return;
  }

  // Parse the slash percentage from the winning label (e.g., "20%", "40%", "60%", "80%", "100%")
  const percentMatch = winningLabel.match(/(\d+)%/);
  if (!percentMatch) {
    logger.warn('[recordSlash] Could not parse percentage from winning label', {
      proposalId,
      winningLabel
    });
    return;
  }

  const slashPercentage = parseInt(percentMatch[1]);

  // Query the user's shares from on-chain UserStake account
  let sharesToSlash = 0n;
  let totalUserShares = 0n;
  let txSignature: string | null = null;
  let zcAmountSlashed = 0;

  if (stakingVaultService) {
    try {
      // Get user's total shares (active + unbonding)
      totalUserShares = await stakingVaultService.getUserShares(targetWallet);

      if (totalUserShares > 0n) {
        // Calculate shares to slash based on percentage
        sharesToSlash = (totalUserShares * BigInt(slashPercentage)) / 100n;

        if (sharesToSlash > 0n) {
          // Execute on-chain slash
          logger.info('[recordSlash] Executing on-chain slash', {
            targetWallet,
            totalUserShares: totalUserShares.toString(),
            sharesToSlash: sharesToSlash.toString(),
            slashPercentage
          });

          txSignature = await stakingVaultService.slash(targetWallet, sharesToSlash);

          logger.info('[recordSlash] On-chain slash executed successfully', {
            targetWallet,
            sharesToSlash: sharesToSlash.toString(),
            txSignature
          });
        }
      } else {
        logger.info('[recordSlash] User has no shares to slash', { targetWallet });
      }
    } catch (error) {
      logger.error('[recordSlash] Failed to execute on-chain slash', {
        targetWallet,
        error: error instanceof Error ? error.message : String(error)
      });
      // Continue to record in database even if on-chain slash fails
    }
  } else {
    logger.warn('[recordSlash] StakingVaultService not available - recording without on-chain execution');
  }

  // Also calculate ZC amount for display purposes (using sZC token balance as before)
  try {
    const connection = new Connection(rpcUrl, 'confirmed');

    // Derive share mint PDA
    const [shareMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint")],
      STAKING_PROGRAM_ID
    );

    // Find user's sZC token account
    const tokenAccounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [
        { dataSize: 165 },
        { memcmp: { offset: 0, bytes: shareMint.toBase58() } },
        { memcmp: { offset: 32, bytes: targetWallet } }
      ]
    });

    if (tokenAccounts.length > 0) {
      // Parse the token account balance
      const accountData = tokenAccounts[0].account.data;
      const rawBalance = accountData.readBigUInt64LE(64);
      const stakedBalance = Number(rawBalance) / 1_000_000; // sZC has 6 decimals

      // Calculate slashed amount
      zcAmountSlashed = stakedBalance * (slashPercentage / 100);
    }
  } catch (error) {
    logger.warn('[recordSlash] Failed to fetch sZC balance for display', {
      targetWallet,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // Insert into qm_slashed table
  const pool = getPool();
  await pool.query(
    `INSERT INTO qm_slashed (moderator_id, proposal_id, target_wallet, slash_percentage, zc_amount_slashed, shares_slashed, tx_signature)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [moderatorId, proposalId, targetWallet, slashPercentage, zcAmountSlashed, sharesToSlash.toString(), txSignature]
  );

  logger.info('[recordSlash] Slash recorded successfully', {
    moderatorId,
    proposalId,
    targetWallet,
    slashPercentage,
    zcAmountSlashed,
    sharesToSlash: sharesToSlash.toString(),
    txSignature
  });
}


export default router;