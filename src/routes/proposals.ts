import { Router } from 'express';
import { requireApiKey } from '../middleware/auth';
import { attachModerator, requireModeratorId, getModerator } from '../middleware/validation';
import { Transaction, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { ExecutionStatus } from '../../app/types/execution.interface';
import { PersistenceService } from '../../app/services/persistence.service';
import { RouterService } from '@app/services/router.service';
import { LoggerService } from '../../app/services/logger.service';

const routerService = RouterService.getInstance();
const logger = new LoggerService('api').createChild('proposals');

// Type definition for creating a proposal
export interface CreateProposalRequest {
  title: string;
  description?: string;
  proposalLength: number;
  transaction?: string; // Base64-encoded serialized transaction
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

    const proposals = await persistenceService.getProposalsForFrontend();

    const publicProposals = proposals.map(p => ({
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
    }));

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

    // Validate required fields
    if (!body.description || !body.proposalLength || !body.twap || !body.amm) {
      logger.warn('[POST /] Missing required fields', {
        receivedFields: Object.keys(req.body),
        moderatorId
      });
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['description', 'proposalLength', 'twap', 'amm']
      });
    }

    // Get the proposal counter for this moderator
    const persistenceService = new PersistenceService(moderatorId, logger.createChild('persistence'));
    const proposalCounter = await persistenceService.getProposalIdCounter();

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

    // Create the proposal
    const proposal = await moderator.createProposal({
      title: body.title,
      description: body.description,
      transaction,
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
      status: proposal.status,
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

    // Execute the proposal using the moderator's authority
    const result = await moderator.executeProposal(id, moderator.config.authority);

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