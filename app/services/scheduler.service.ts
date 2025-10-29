import { ISchedulerService, IScheduledTask, ScheduledTaskType } from '../types/scheduler.interface';
import { IRouterService } from '../types/router.interface';
import { HistoryService } from './history.service';
import { LoggerService } from './logger.service';
import { SolPriceService } from './sol-price.service';
import { AMMState } from '../types/amm.interface';
import { Decimal } from 'decimal.js';
import { Connection, PublicKey } from '@solana/web3.js';
import { CpAmm, getPriceFromSqrtPrice } from '@meteora-ag/cp-amm-sdk';

/**
 * Scheduler service for managing automatic TWAP cranking and proposal finalization
 * Handles periodic tasks for active proposals across multiple moderators
 */
export class SchedulerService implements ISchedulerService {
  private tasks: Map<string, IScheduledTask> = new Map();
  private static instance: SchedulerService;
  private logger: LoggerService;

  private constructor() {
    this.logger = new LoggerService('router').createChild('scheduler');
  }

  /**
   * Gets the singleton instance of the scheduler service
   */
  static getInstance(): SchedulerService {
    if (!SchedulerService.instance) {
      SchedulerService.instance = new SchedulerService();
    }
    return SchedulerService.instance;
  }

  /**
   * Gets the router service for accessing moderators
   * @returns The router service instance
   */
  private getRouter(): IRouterService {
    // Dynamic import to avoid circular dependency with router service
    const { RouterService } = require('./router.service');
    return RouterService.getInstance();
  }

  /**
   * Schedules automatic TWAP cranking for a proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID to crank TWAP for
   * @param intervalMs - Interval between cranks in milliseconds (default: 60000 = 1 minute)
   */
  scheduleTWAPCranking(moderatorId: number, proposalId: number, intervalMs: number = 60000): void {
    const taskId = `twap-${moderatorId}-${proposalId}`;

    if (this.tasks.has(taskId)) {
      this.logger.debug(`TWAP cranking already scheduled for moderator #${moderatorId} proposal #${proposalId}`);
      return;
    }

    const task: IScheduledTask = {
      id: taskId,
      type: ScheduledTaskType.TWAPCrank,
      moderatorId,
      proposalId,
      interval: intervalMs,
      nextRunTime: Date.now() + intervalMs
    };

    // Start the periodic task
    task.timer = setInterval(async () => {
      await this.crankTWAPForProposal(moderatorId, proposalId);
    }, intervalMs);

    this.tasks.set(taskId, task);
    this.logger.info('Scheduled TWAP cranking', {
      moderatorId,
      proposalId,
      intervalMs,
      taskId
    });
  }
  
  /**
   * Schedules automatic price recording for a proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID to record prices for
   * @param intervalMs - Interval between recordings in milliseconds (default: 60000 = 1 minute)
   */
  schedulePriceRecording(moderatorId: number, proposalId: number, intervalMs: number = 60000): void {
    const taskId = `price-${moderatorId}-${proposalId}`;

    if (this.tasks.has(taskId)) {
      this.logger.info(`Price recording already scheduled for moderator #${moderatorId} proposal #${proposalId}`);
      return;
    }

    const task: IScheduledTask = {
      id: taskId,
      type: ScheduledTaskType.PriceRecord,
      moderatorId,
      proposalId,
      interval: intervalMs,
      nextRunTime: Date.now() + intervalMs
    };

    // Start the periodic task
    task.timer = setInterval(async () => {
      await this.recordPricesForProposal(moderatorId, proposalId);
    }, intervalMs);

    this.tasks.set(taskId, task);
    this.logger.info('Scheduled price recording', {
      moderatorId,
      proposalId,
      intervalMs,
      taskId
    });
  }

  /**
   * Schedules automatic spot price recording for a proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID to record spot prices for
   * @param spotPoolAddress - The Meteora pool address for the spot market
   * @param intervalMs - Interval between recordings in milliseconds (default: 60000 = 1 minute)
   */
  scheduleSpotPriceRecording(moderatorId: number, proposalId: number, spotPoolAddress: string, intervalMs: number = 60000): void {
    const taskId = `spot-${moderatorId}-${proposalId}`;

    if (this.tasks.has(taskId)) {
      this.logger.info(`Spot price recording already scheduled for moderator #${moderatorId} proposal #${proposalId}`);
      return;
    }

    const task: IScheduledTask = {
      id: taskId,
      type: ScheduledTaskType.SpotPriceRecord,
      moderatorId,
      proposalId,
      interval: intervalMs,
      nextRunTime: Date.now() + intervalMs
    };

    // Start the periodic task
    task.timer = setInterval(async () => {
      await this.recordSpotPriceForProposal(moderatorId, proposalId, spotPoolAddress);
    }, intervalMs);

    this.tasks.set(taskId, task);
    this.logger.info('Scheduled spot price recording', {
      moderatorId,
      proposalId,
      intervalMs,
      spotPoolAddress,
      taskId
    });
  }

  /**
   * Schedules automatic finalization for a proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID to finalize
   * @param finalizeAt - Timestamp when to finalize the proposal
   */
  scheduleProposalFinalization(moderatorId: number, proposalId: number, finalizeAt: number): void {
    const taskId = `finalize-${moderatorId}-${proposalId}`;

    if (this.tasks.has(taskId)) {
      this.logger.info(`Finalization already scheduled for moderator #${moderatorId} proposal #${proposalId}`);
      return;
    }

    const delayMs = finalizeAt - Date.now();

    if (delayMs <= 0) {
      // Should finalize immediately
      this.finalizeProposal(moderatorId, proposalId);
      return;
    }

    const task: IScheduledTask = {
      id: taskId,
      type: ScheduledTaskType.ProposalFinalize,
      moderatorId,
      proposalId,
      nextRunTime: finalizeAt
    };

    // Schedule one-time finalization
    task.timer = setTimeout(async () => {
      await this.finalizeProposal(moderatorId, proposalId);
      this.tasks.delete(taskId);
    }, delayMs);

    this.tasks.set(taskId, task);
    this.logger.info('Scheduled proposal finalization', {
      moderatorId,
      proposalId,
      finalizeAt: new Date(finalizeAt).toISOString(),
      delayMs,
      taskId
    });
  }

  /**
   * Cranks TWAP for a specific proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID
   */
  private async crankTWAPForProposal(moderatorId: number, proposalId: number): Promise<void> {
    const router = this.getRouter();
    const moderator = router.getModerator(moderatorId);

    if (!moderator) {
      this.logger.error('Moderator not found, cancelling tasks', { moderatorId, proposalId });
      this.cancelProposalTasks(moderatorId, proposalId);
      return;
    }

    let proposal;
    try {
      proposal = await moderator.getProposal(proposalId);
    } catch (error) {
      this.logger.error('Failed to load proposal for TWAP cranking', {
        moderatorId,
        proposalId,
        error: error instanceof Error ? error.message : String(error)
      });
      this.cancelProposalTasks(moderatorId, proposalId);
      return; // Gracefully exit instead of throwing
    }

    if (!proposal) {
      this.logger.warn('Proposal not found, cancelling tasks', { moderatorId, proposalId });
      this.cancelProposalTasks(moderatorId, proposalId);
      return; // Gracefully exit instead of throwing
    }

    // Check if proposal has ended
    const now = Date.now();
    if (now >= proposal.finalizedAt) {
      this.logger.info(`Proposal #${proposalId} from moderator #${moderatorId} has ended, stopping TWAP cranking`);
      this.cancelTask(`twap-${moderatorId}-${proposalId}`);
      this.cancelTask(`price-${moderatorId}-${proposalId}`);
      this.cancelTask(`spot-${moderatorId}-${proposalId}`);
      return;
    }

    // Get the TWAP oracle and crank it
    const twapOracle = proposal.twapOracle;
    await twapOracle.crankTWAP();
    this.logger.info('TWAP cranked successfully', { moderatorId, proposalId });
    
    // Record TWAP data to history
    const twapData = await twapOracle.fetchTWAP();
    
    await HistoryService.recordTWAP({
      moderatorId,
      proposalId,
      passTwap: new Decimal(twapData.passTwap.toString()),
      failTwap: new Decimal(twapData.failTwap.toString()),
      passAggregation: new Decimal(twapData.passAggregation.toString()),
      failAggregation: new Decimal(twapData.failAggregation.toString()),
    });
    
    // Save updated proposal state to database
    await moderator.saveProposal(proposal);
    
    // Database is now the source of truth - no cache to invalidate
  }
  
  /**
   * Records prices for a specific proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID
   */
  private async recordPricesForProposal(moderatorId: number, proposalId: number): Promise<void> {
    const router = this.getRouter();
    const moderator = router.getModerator(moderatorId);

    if (!moderator) {
      this.logger.error(`Moderator #${moderatorId} not found, cancelling tasks for proposal #${proposalId}`);
      this.cancelProposalTasks(moderatorId, proposalId);
      return;
    }

    let proposal;
    try {
      proposal = await moderator.getProposal(proposalId);
    } catch (error) {
      this.logger.error(`Failed to load proposal #${proposalId} from moderator #${moderatorId} for price recording:`, error);
      this.cancelProposalTasks(moderatorId, proposalId);
      return; // Gracefully exit instead of throwing
    }

    if (!proposal) {
      this.logger.warn(`Proposal #${proposalId} not found in moderator #${moderatorId}, cancelling tasks`);
      this.cancelProposalTasks(moderatorId, proposalId);
      return; // Gracefully exit instead of throwing
    }

    // Check if proposal has ended
    const now = Date.now();
    if (now >= proposal.finalizedAt) {
      this.logger.info(`Proposal #${proposalId} from moderator #${moderatorId} has ended, stopping price recording`);
      this.cancelTask(`price-${moderatorId}-${proposalId}`);
      this.cancelTask(`spot-${moderatorId}-${proposalId}`);
      return;
    }

    const [pAMM, fAMM] = proposal.getAMMs();
    
    // Record pass market price if AMM is trading
    if (pAMM && pAMM.state === AMMState.Trading) {
      try {
        const passPrice = await pAMM.fetchPrice();
        await HistoryService.recordPrice({
          moderatorId,
          proposalId,
          market: 'pass',
          price: passPrice,
        });
      } catch (error) {
        this.logger.error(`Failed to record pass market price for proposal #${proposalId}:`, error);
        // Continue to try recording fail price even if pass fails
      }
    }

    // Record fail market price if AMM is trading
    if (fAMM && fAMM.state === AMMState.Trading) {
      try {
        const failPrice = await fAMM.fetchPrice();
        await HistoryService.recordPrice({
          moderatorId,
          proposalId,
          market: 'fail',
          price: failPrice,
        });
      } catch (error) {
        this.logger.error(`Failed to record fail market price for proposal #${proposalId}:`, error);
        // Continue even if fail price recording fails
      }
    }

    this.logger.info(`Recorded prices for proposal #${proposalId}`);
  }

  /**
   * Records spot price for a specific proposal
   * Fetches price from Meteora spot pool and converts to market cap USD
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID
   * @param spotPoolAddress - The Meteora pool address
   */
  private async recordSpotPriceForProposal(moderatorId: number, proposalId: number, spotPoolAddress: string): Promise<void> {
    const router = this.getRouter();
    const moderator = router.getModerator(moderatorId);

    if (!moderator) {
      this.logger.error(`Moderator #${moderatorId} not found, cancelling spot price tasks for proposal #${proposalId}`);
      this.cancelTask(`spot-${moderatorId}-${proposalId}`);
      return;
    }

    let proposal;
    try {
      proposal = await moderator.getProposal(proposalId);
    } catch (error) {
      this.logger.error(`Failed to load proposal #${proposalId} from moderator #${moderatorId} for spot price recording:`, error);
      this.cancelTask(`spot-${moderatorId}-${proposalId}`);
      return;
    }

    if (!proposal) {
      this.logger.warn(`Proposal #${proposalId} not found in moderator #${moderatorId}, cancelling spot price recording`);
      this.cancelTask(`spot-${moderatorId}-${proposalId}`);
      return;
    }

    // Check if proposal has ended
    const now = Date.now();
    if (now >= proposal.finalizedAt) {
      this.logger.info(`Proposal #${proposalId} from moderator #${moderatorId} has ended, stopping spot price recording`);
      this.cancelTask(`spot-${moderatorId}-${proposalId}`);
      return;
    }

    try {
      // Get Solana connection
      const connection = new Connection(
        process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
        'confirmed'
      );

      // Fetch spot pool state
      const cpAmm = new CpAmm(connection);
      const poolPubkey = new PublicKey(spotPoolAddress);
      const poolState = await cpAmm.fetchPoolState(poolPubkey);

      // Calculate price from sqrt price
      const tokenADecimal = (poolState as any).tokenADecimal ?? 6;
      const tokenBDecimal = (poolState as any).tokenBDecimal ?? 9;
      const priceDecimal = getPriceFromSqrtPrice(
        poolState.sqrtPrice,
        tokenADecimal,
        tokenBDecimal
      );
      const spotPriceInSol = priceDecimal.toNumber();

      // Get SOL/USD price
      const solPriceService = SolPriceService.getInstance();
      const solPrice = await solPriceService.getSolPrice();

      // Convert to market cap USD: price × total supply × SOL/USD
      const totalSupply = proposal.config.totalSupply;
      const marketCapUSD = spotPriceInSol * totalSupply * solPrice;

      // Record to database
      await HistoryService.recordPrice({
        moderatorId,
        proposalId,
        market: 'spot',
        price: new Decimal(marketCapUSD),
      });

      this.logger.info(`Recorded spot price for proposal #${proposalId}: $${marketCapUSD.toFixed(2)}`);
    } catch (error) {
      this.logger.error(`Failed to record spot price for proposal #${proposalId}:`, error);
      // Don't cancel task on individual failures - might be transient network issues
    }
  }

  /**
   * Finalizes a proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID
   */
  private async finalizeProposal(moderatorId: number, proposalId: number): Promise<void> {
    const router = this.getRouter();
    const moderator = router.getModerator(moderatorId);

    if (!moderator) {
      this.logger.error(`Moderator #${moderatorId} not found, cannot finalize proposal #${proposalId}`);
      this.cancelProposalTasks(moderatorId, proposalId);
      return;
    }

    this.logger.info('Auto-finalizing proposal', { moderatorId, proposalId });
    try {
      const status = await moderator.finalizeProposal(proposalId);
      this.logger.info('Proposal finalized successfully', {
        moderatorId,
        proposalId,
        status
      });
    } catch (error) {
      this.logger.error('Failed to finalize proposal', {
        moderatorId,
        proposalId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Cancel all tasks for this proposal regardless of finalization success
    this.cancelProposalTasks(moderatorId, proposalId);
  }

  /**
   * Helper to check if a task type uses setInterval (periodic) or setTimeout (one-time)
   * @param type - The task type to check
   * @returns true if the task is periodic (uses setInterval)
   */
  private isPeriodicTask(type: ScheduledTaskType): boolean {
    return type === ScheduledTaskType.TWAPCrank ||
           type === ScheduledTaskType.PriceRecord ||
           type === ScheduledTaskType.SpotPriceRecord;
  }

  /**
   * Cancels a scheduled task
   * @param taskId - The task ID to cancel
   */
  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) {
      if (task.timer) {
        if (this.isPeriodicTask(task.type)) {
          clearInterval(task.timer);
        } else {
          clearTimeout(task.timer);
        }
      }
      this.tasks.delete(taskId);
      this.logger.debug('Task cancelled', { taskId, type: task.type });
    }
  }

  /**
   * Cancels all tasks for a specific proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID
   */
  cancelProposalTasks(moderatorId: number, proposalId: number): void {
    this.cancelTask(`twap-${moderatorId}-${proposalId}`);
    this.cancelTask(`price-${moderatorId}-${proposalId}`);
    this.cancelTask(`spot-${moderatorId}-${proposalId}`);
    this.cancelTask(`finalize-${moderatorId}-${proposalId}`);
  }

  /**
   * Stops all scheduled tasks
   */
  stopAll(): void {
    for (const [_, task] of this.tasks.entries()) {
      if (task.timer) {
        if (this.isPeriodicTask(task.type)) {
          clearInterval(task.timer);
        } else {
          clearTimeout(task.timer);
        }
      }
    }
    const taskCount = this.tasks.size;
    this.tasks.clear();
    this.logger.info('All scheduled tasks stopped', { taskCount });
  }

  /**
   * Gets information about all active tasks
   */
  getActiveTasks(): Array<{id: string; type: string; moderatorId: number; proposalId: number; nextRunTime: number}> {
    return Array.from(this.tasks.values()).map(task => ({
      id: task.id,
      type: task.type,
      moderatorId: task.moderatorId,
      proposalId: task.proposalId,
      nextRunTime: task.nextRunTime
    }));
  }
}