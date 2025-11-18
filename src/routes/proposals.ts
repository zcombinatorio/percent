import { Router } from 'express';
import { requireApiKey } from '../middleware/auth';
import { attachModerator, requireModeratorId, getModerator } from '../middleware/validation';
import BN from 'bn.js';
import { PersistenceService } from '../../app/services/persistence.service';
import { RouterService } from '@app/services/router.service';
import { LoggerService } from '../../app/services/logger.service';

const routerService = RouterService.getInstance();
const logger = new LoggerService('api').createChild('proposals');

// Type definition for creating a proposal
export interface CreateProposalRequest {
  title: string;
  description?: string;
  markets: number; // Number of markets (2-4)
  market_labels?: string[]; // Optional labels for each market
  proposalLength: number;
  spotPoolAddress?: string; // Optional Meteora pool address for spot market
  totalSupply?: number; // Total supply of conditional tokens (defaults to 1 billion)
  twap: {
    initialTwapValue: number;
    twapMaxObservationChangePerUpdate: number | null;
    twapStartDelay: number;
    passThresholdBps: number;
    minUpdateInterval: number;
  };
  amm: {
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

router.get('/', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const persistenceService = new PersistenceService(moderatorId, logger.createChild('persistence'));

    logger.info('[GET /] Fetching proposals', { moderatorId });

    const proposals = await persistenceService.loadAllProposals();

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
      };
    });

    logger.info('[GET /] Fetched proposals successfully', {
      moderatorId,
      count: publicProposals.length
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
      markets: proposal.config.markets,
      marketLabels: proposal.config.market_labels,
      ammConfig: serialized.ammConfig,
      ammData: serialized.AMMData,
      baseVaultState: serialized.baseVaultData,
      quoteVaultState: serialized.quoteVaultData,
      twapOracleState: serialized.twapOracleData,
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

    // Validate required fields
    if (!body.description || !body.markets || !body.proposalLength || !body.twap || !body.amm) {
      logger.warn('[POST /] Missing required fields', {
        receivedFields: Object.keys(req.body),
        moderatorId
      });
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['description', 'markets', 'proposalLength', 'twap', 'amm']
      });
    }

    // Validate markets count
    if (body.markets < 2 || body.markets > 4) {
      logger.warn('[POST /] Invalid markets count', {
        markets: body.markets,
        moderatorId
      });
      return res.status(400).json({
        error: 'Invalid markets count: must be between 2 and 4'
      });
    }

    // Create the proposal
    const proposal = await moderator.createProposal({
      title: body.title,
      description: body.description,
      markets: body.markets,
      market_labels: body.market_labels,
      proposalLength: body.proposalLength,
      spotPoolAddress: body.spotPoolAddress,
      totalSupply: body.totalSupply || 1000000000, // Default to 1 billion tokens
      twap: {
        initialTwapValue: body.twap.initialTwapValue,
        twapMaxObservationChangePerUpdate: body.twap.twapMaxObservationChangePerUpdate,
        twapStartDelay: body.twap.twapStartDelay,
        passThresholdBps: body.twap.passThresholdBps,
        minUpdateInterval: body.twap.minUpdateInterval
      },
      amm: {
        initialBaseAmount: new BN(body.amm.initialBaseAmount),
        initialQuoteAmount: new BN(body.amm.initialQuoteAmount)
      }
    });

    logger.info('[POST /] Created new proposal', {
      proposalId: proposal.config.id,
      moderatorId,
      title: body.title,
      proposalLength: body.proposalLength,
      totalSupply: body.totalSupply || 1000000000
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
    logger.error('[POST /] Failed to create proposal', {
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

export default router;