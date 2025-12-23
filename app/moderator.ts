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

import { Keypair, PublicKey } from '@solana/web3.js';
import { IModerator, IModeratorConfig, IModeratorInfo, ProposalStatus, ICreateProposalParams } from './types/moderator.interface';
import { IExecutionConfig, PriorityFeeMode, Commitment } from './types/execution.interface';
import { IProposal, IProposalConfig } from './types/proposal.interface';
import { Proposal } from './proposal';
import { SchedulerService } from './services/scheduler.service';
import { PersistenceService } from './services/persistence.service';
import { ExecutionService } from './services/execution.service';
import { LoggerService } from './services/logger.service';
import { DammService } from './services/damm.service';
import { DlmmService } from './services/dlmm.service';
import { FeeService } from './services/fee.service';
import { POOL_METADATA } from '../src/config/whitelist';
import { normalizeWithdrawConfirmResponse, calculateMarketPriceFromAmounts } from './utils/pool-api.utils';
//import { BlockEngineUrl, JitoService } from '@slateos/jito';

/**
 * Moderator class that manages governance proposals for the protocol
 * Handles creation, finalization, and execution of proposals
 */
export class Moderator implements IModerator {
  public id: number;                                       // Moderator ID
  public protocolName?: string;                            // Protocol name (optional)
  public config: IModeratorConfig;                         // Configuration parameters for the moderator
  public scheduler: SchedulerService;                     // Scheduler for automatic tasks
  public persistenceService: PersistenceService;          // Database persistence service
  private executionService: ExecutionService;              // Execution service for transactions
  private dammService: DammService;                        // DAMM pool interaction service
  private dlmmService: DlmmService;                        // DLMM pool interaction service
  private feeService: FeeService;                          // Fee collection service
  private logger: LoggerService;                           // Logger service for this moderator
  //private jitoService?: JitoService;                       // Jito service @deprecated

  /**
   * Creates a new Moderator instance
   * @param id - Moderator ID
   * @param protocolName - Name of the protocol (optional)
   * @param config - Configuration object containing all necessary parameters
   */
  constructor(id: number, protocolName: string | undefined, config: IModeratorConfig) {
    this.id = id;
    this.protocolName = protocolName;
    this.config = config;

    // Create connection from config
    const commitment: Commitment = config.commitment || Commitment.Confirmed;

    this.scheduler = SchedulerService.getInstance();

    // Initialize logger with a category based on moderator ID
    this.logger = new LoggerService(`moderator-${id}`);

    // Initialize persistence service with logger
    this.persistenceService = new PersistenceService(id, this.logger.createChild('persistence'));

    // Initialize execution service with default config
    const executionConfig: IExecutionConfig = {
      rpcEndpoint: this.config.rpcEndpoint,
      commitment: commitment,
      maxRetries: 3,
      skipPreflight: false,
      priorityFeeMode: PriorityFeeMode.Dynamic
    };

    this.logger.info('Moderator initialized', {
      moderatorId: id,
      protocolName: protocolName,
    });

    this.executionService = new ExecutionService(executionConfig, this.logger);
    this.dammService = new DammService(this.logger.createChild('damm'));
    this.dlmmService = new DlmmService(this.logger.createChild('dlmm'));
    this.feeService = new FeeService(this.executionService, this.logger.createChild('fee'));

    /** @deprecated */
    // if (this.config.jitoUuid) {
    //   this.jitoService = new JitoService(BlockEngineUrl.MAINNET, this.config.jitoUuid);
    // }
  }

  /**
   * Get the appropriate authority keypair for a given pool
   * @param poolAddress - DAMM pool address (optional)
   * @returns Authority keypair for the pool, or default if not mapped
   */
  getAuthorityForPool(poolAddress?: string): Keypair {
    // If no pool-specific authorities configured, use default
    if (!this.config.poolAuthorities) {
      return this.config.defaultAuthority;
    }

    // If poolAddress not provided or not mapped, use default
    if (!poolAddress || !this.config.poolAuthorities.has(poolAddress)) {
      return this.config.defaultAuthority;
    }

    // Return pool-specific authority
    return this.config.poolAuthorities.get(poolAddress)!;
  }

  /**
   * Returns a JSON object with all moderator configuration and state information
   * @returns Object containing moderator info
   */
  async info(): Promise<IModeratorInfo> {
    const info: IModeratorInfo = {
      id: this.id,
      protocolName: this.protocolName,
      proposalIdCounter: await this.getProposalIdCounter(),
      baseToken: {
        mint: this.config.baseMint.toBase58(),
        decimals: this.config.baseDecimals
      },
      quoteToken: {
        mint: this.config.quoteMint.toBase58(),
        decimals: this.config.quoteDecimals
      },
      authority: this.config.defaultAuthority.publicKey.toBase58(),
      dammWithdrawalPercentage: this.config.dammWithdrawalPercentage,
    };

    return info;
  }

  /**
   * Getter for the current proposal ID counter
   */
  async getProposalIdCounter(): Promise<number> {
    return await this.persistenceService.getProposalIdCounter();
  }
  
  /**
   * Get a proposal by ID from database (always fresh data)
   * @param id - Proposal ID
   * @returns Promise resolving to proposal or null if not found
   */
  async getProposal(id: number): Promise<IProposal | null> {
    return await this.persistenceService.loadProposal(id);
  }
  
  /**
   * Save a proposal to the database
   * @param proposal - The proposal to save
   */
  async saveProposal(proposal: IProposal): Promise<void> {
    await this.persistenceService.saveProposal(proposal);
  }

  /**
   * Creates a new governance proposal
   * @param params - Parameters for creating the proposal including AMM configuration
   * @returns The newly created proposal object
   * @throws Error if proposal creation fails
   */
  async createProposal(params: ICreateProposalParams): Promise<IProposal> {
    const proposalIdCounter = await this.getProposalIdCounter() + 1;
    try {
      this.logger.info('Creating proposal');

      // Select appropriate authority based on pool address
      const authority = this.getAuthorityForPool(params.spotPoolAddress);

      // Build DAMM withdrawal callback if withdrawal data is provided
      // Withdrawal metadata is stored after proposal save to satisfy FK constraint
      let withdrawalMetadata: {
        requestId: string;
        signature: string;
        percentage: number;
        tokenA: string;
        tokenB: string;
        spotPrice: number;
        poolAddress: string;
      } | undefined;

      let confirmDammWithdrawal: (() => Promise<void>) | undefined;
      if (params.dammWithdrawal) {
        const withdrawal = params.dammWithdrawal;
        const poolType = withdrawal.poolType || 'damm'; // Default to DAMM for backwards compatibility
        confirmDammWithdrawal = async () => {
          this.logger.info('Confirming withdrawal', {
            requestId: withdrawal.requestId,
            poolAddress: withdrawal.poolAddress,
            poolType,
            withdrawn: withdrawal.withdrawn,
            transferred: withdrawal.transferred,
            redeposited: withdrawal.redeposited,
            transactionCount: withdrawal.signedTransactions?.length || 1,
          });

          // Route to correct confirm endpoint based on pool type
          const apiUrl = process.env.DAMM_API_URL || 'https://api.zcombinator.io';
          const confirmEndpoint = poolType === 'dlmm'
            ? `${apiUrl}/dlmm/withdraw/confirm`
            : `${apiUrl}/damm/withdraw/confirm`;

          // Build request body based on pool type
          // DLMM uses signedTransactions (array), DAMM uses signedTransaction (single)
          const requestBody = poolType === 'dlmm' && withdrawal.signedTransactions
            ? {
                signedTransactions: withdrawal.signedTransactions,
                requestId: withdrawal.requestId,
              }
            : {
                signedTransaction: withdrawal.signedTransaction,
                requestId: withdrawal.requestId,
              };

          const withdrawConfirmResponse = await fetch(
            confirmEndpoint,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(requestBody),
            }
          );

          if (!withdrawConfirmResponse.ok) {
            const error = (await withdrawConfirmResponse.json()) as { error?: string };
            throw new Error(
              `${poolType.toUpperCase()} withdrawal confirm failed: ${error.error || withdrawConfirmResponse.statusText}`
            );
          }

          // Parse and normalize the API response using explicit pool-type branching
          // DLMM returns tokenX/Y + signatures array, DAMM returns tokenA/B + single signature
          const withdrawConfirmDataRaw = await withdrawConfirmResponse.json();
          const normalizedConfirm = normalizeWithdrawConfirmResponse(withdrawConfirmDataRaw, poolType);

          // Calculate spot price from confirmed amounts (ground truth)
          const spotPrice = calculateMarketPriceFromAmounts(
            normalizedConfirm.amounts.tokenA,
            normalizedConfirm.amounts.tokenB,
            this.config.baseDecimals,
            this.config.quoteDecimals
          );

          this.logger.info('Confirmed withdrawal', {
            signature: normalizedConfirm.signature,
            allSignatures: normalizedConfirm.allSignatures,
            spotPrice,
            transferred: normalizedConfirm.amounts,
            poolType,
          });

          // Store withdrawal data in memory - will be persisted after proposal save
          withdrawalMetadata = {
            requestId: withdrawal.requestId,
            signature: normalizedConfirm.signature,
            percentage: withdrawal.withdrawalPercentage,
            tokenA: normalizedConfirm.amounts.tokenA,
            tokenB: normalizedConfirm.amounts.tokenB,
            spotPrice,
            poolAddress: withdrawal.poolAddress,
          };

          this.logger.info('Withdrawal confirmed, metadata will be stored after proposal save', {
            proposalId: proposalIdCounter,
            withdrawalSignature: normalizedConfirm.signature,
            poolType,
          });
        };
      }

      // Create proposal config from moderator config and params
      const proposalConfig: IProposalConfig = {
        id: proposalIdCounter,
        moderatorId: this.id,
        title: params.title,
        description: params.description,
        market_labels: params.market_labels,
        markets: params.markets,
        createdAt: Date.now(),
        proposalLength: params.proposalLength,
        baseMint: this.config.baseMint,
        quoteMint: this.config.quoteMint,
        baseDecimals: this.config.baseDecimals,
        quoteDecimals: this.config.quoteDecimals,
        authority: authority,
        executionService: this.executionService,
        spotPoolAddress: params.spotPoolAddress,
        totalSupply: params.totalSupply,
        twap: params.twap,
        ammConfig: params.amm,
        logger: this.logger.createChild(`proposal-${proposalIdCounter}`),
        confirmDammWithdrawal,
      };

      // Create new proposal with config object
      const proposal = new Proposal(proposalConfig);

      // Initialize the proposal
      await proposal.initialize();
      
      // Save to database FIRST (database is source of truth)
      await this.saveProposal(proposal);
      await this.persistenceService.saveModeratorState(proposalIdCounter, this.config);

      // Now store withdrawal metadata (after proposal exists to satisfy FK constraint)
      if (withdrawalMetadata) {
        await this.persistenceService.storeWithdrawalMetadata(
          proposalIdCounter,
          withdrawalMetadata.requestId,
          withdrawalMetadata.signature,
          withdrawalMetadata.percentage,
          withdrawalMetadata.tokenA,
          withdrawalMetadata.tokenB,
          withdrawalMetadata.spotPrice,
          withdrawalMetadata.poolAddress
        );
        this.logger.info('Stored withdrawal metadata', {
          proposalId: proposalIdCounter,
          withdrawalSignature: withdrawalMetadata.signature,
        });
      }

      this.logger.info('Proposal initialized and saved');
      
      // Schedule automatic TWAP cranking (every minute)
      this.scheduler.scheduleTWAPCranking(this.id, proposalIdCounter, params.twap.minUpdateInterval);

      // Also schedule price recording for this proposal
      this.scheduler.schedulePriceRecording(this.id, proposalIdCounter, 5000); // 5 seconds

      // Schedule spot price recording if spot pool address is provided
      if (params.spotPoolAddress) {
        this.scheduler.scheduleSpotPriceRecording(this.id, proposalIdCounter, params.spotPoolAddress, 60000); // 1 minute
        this.logger.info('Scheduled spot price recording', { spotPoolAddress: params.spotPoolAddress });
      }

      // Schedule automatic finalization 1 second after the proposal's end time
      // This buffer ensures all TWAP data is collected and attempts to avoid race conditions
      this.scheduler.scheduleProposalFinalization(this.id, proposalIdCounter, proposal.finalizedAt + 1000);
      this.logger.info('Scheduled proposal finalization', { finalizedAt: proposal.finalizedAt });

      return proposal;
    } catch (error) {
      this.logger.error('Failed to create proposal', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Increment proposal ID counter even if proposal creation fails
      await this.persistenceService.saveModeratorState(proposalIdCounter + 1, this.config);
      throw error;
    }
  }

  /**
   * Finalizes a proposal after the voting period has ended
   * Determines winning market by highest TWAP
   * Uses Jito bundles on mainnet if UUID is configured
   * @param id - The ID of the proposal to finalize
   * @returns Tuple of [status, winningMarketIndex | null]
   * @throws Error if proposal with given ID doesn't exist
   */
  async finalizeProposal(id: number): Promise<[ProposalStatus, number | null]> {
    // Get proposal from cache or database
    this.logger.info('Finalizing proposal');
    const proposal = await this.getProposal(id);
    if (!proposal) {
      throw new Error(`Proposal with ID ${id} does not exist`);
    }

    const [status, winningIndex] = await proposal.finalize();
    await this.saveProposal(proposal);

    if (status == ProposalStatus.Finalized) {
      this.logger.info('Proposal finalized', { winningIndex });
      // Wait for RPC to sync after finalization
      this.logger.info('Waiting for RPC to sync after finalization', { proposalId: id });
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Handle deposit-back for proposals with DAMM withdrawals
      await this.handleDepositBack(id);
    }
    return [status, winningIndex];
  }

  /**
   * Handle automatic deposit-back to pool after proposal finalization
   * Deposits available tokens from authority wallet back to pool (DAMM or DLMM)
   * The API handles pool ratio calculation internally
   * @param proposalId - The ID of the finalized proposal
   */
  private async handleDepositBack(proposalId: number): Promise<void> {
    try {
      // Check if proposal has withdrawal metadata
      const metadata = await this.persistenceService.getWithdrawalMetadata(proposalId);

      if (!metadata) {
        // No withdrawal metadata, skip deposit-back
        return;
      }

      if (!metadata.needsDepositBack) {
        // Already deposited back
        this.logger.info('Proposal already has deposit-back completed', { proposalId });
        return;
      }

      // Get pool metadata for dynamic decimal lookup and pool type
      const poolMetadata = POOL_METADATA[metadata.poolAddress];
      if (!poolMetadata) {
        throw new Error(`Pool metadata not found for ${metadata.poolAddress}`);
      }

      const poolType = poolMetadata.poolType;

      this.logger.info('Starting deposit-back to pool', {
        proposalId,
        originalWithdrawnTokenA: metadata.tokenA,
        originalWithdrawnTokenB: metadata.tokenB,
        poolAddress: metadata.poolAddress,
        poolType
      });

      const BASE_DECIMALS = poolMetadata.baseDecimals;
      const QUOTE_DECIMALS = poolMetadata.quoteDecimals;

      this.logger.info('Using pool-specific decimals for deposit', {
        proposalId,
        poolAddress: metadata.poolAddress,
        poolType,
        baseDecimals: BASE_DECIMALS,
        quoteDecimals: QUOTE_DECIMALS
      });

      // Step 1: Create transaction signer from authority keypair with validation
      const authority = this.getAuthorityForPool(metadata.poolAddress);
      const signTransaction = async (transaction: any) => {
        // Validate fee payer matches authority wallet
        if (!transaction.feePayer?.equals(authority.publicKey)) {
          const error = `Fee payer mismatch: expected ${authority.publicKey.toBase58()}, got ${transaction.feePayer?.toBase58()}`;
          this.logger.error('Transaction validation failed', { proposalId, error });
          throw new Error(error);
        }

        this.logger.info('Transaction validated, signing with authority', {
          proposalId,
          feePayer: transaction.feePayer.toBase58(),
          authority: authority.publicKey.toBase58(),
          poolAddress: metadata.poolAddress,
          poolType
        });

        transaction.partialSign(authority);
        return transaction;
      };

      // Step 2: Execute deposit with retry logic
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 2000;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          this.logger.info(`Attempting deposit-back (${attempt}/${MAX_RETRIES})`, {
            proposalId,
            rawTokenA: metadata.tokenA,
            rawTokenB: metadata.tokenB,
            poolAddress: metadata.poolAddress,
            poolType
          });

          let depositSignature: string;
          let confirmedAmounts: { tokenA: string; tokenB: string };

          if (poolType === 'dlmm') {
            // DLMM uses raw amounts (strings)
            const depositResult = await this.dlmmService.depositToDlmmPool(
              String(metadata.tokenA),  // Raw token X amount
              String(metadata.tokenB),  // Raw token Y amount
              signTransaction,
              metadata.poolAddress
            );
            depositSignature = depositResult.signature;
            // Normalize DLMM response (tokenX/Y) to internal format (tokenA/B)
            confirmedAmounts = {
              tokenA: depositResult.amounts.tokenX,
              tokenB: depositResult.amounts.tokenY
            };
          } else {
            // DAMM uses UI amounts (numbers)
            const tokenAAmountUI = metadata.tokenA / Math.pow(10, BASE_DECIMALS);
            const tokenBAmountUI = metadata.tokenB / Math.pow(10, QUOTE_DECIMALS);

            this.logger.info('Converting to UI amounts for DAMM deposit', {
              proposalId,
              tokenAUI: tokenAAmountUI,
              tokenBUI: tokenBAmountUI
            });

            const depositResult = await this.dammService.depositToDammPool(
              tokenAAmountUI,
              tokenBAmountUI,
              signTransaction,
              metadata.poolAddress
            );
            depositSignature = depositResult.signature;
            confirmedAmounts = depositResult.amounts;
          }

          // Mark as deposited in database with actual amounts from API response
          await this.persistenceService.markWithdrawalDeposited(
            proposalId,
            depositSignature,
            confirmedAmounts.tokenA,
            confirmedAmounts.tokenB
          );

          this.logger.info('Deposit-back completed successfully', {
            proposalId,
            attempt,
            depositSignature,
            poolType,
            confirmedDeposit: confirmedAmounts
          });

          // Collect fees after successful deposit-back (non-blocking)
          // Fee = withdrawn - deposited (what remains after deposit-back)
          try {
            if (this.feeService.isEnabled) {
              const { feeTokenA, feeTokenB } = this.feeService.calculateFees(
                String(metadata.tokenA),
                String(metadata.tokenB),
                confirmedAmounts.tokenA,
                confirmedAmounts.tokenB
              );

              if (feeTokenA > 0n || feeTokenB > 0n) {
                this.logger.info('Collecting fees from decision market', {
                  proposalId,
                  feeTokenA: feeTokenA.toString(),
                  feeTokenB: feeTokenB.toString(),
                  originalWithdrawn: { tokenA: metadata.tokenA, tokenB: metadata.tokenB },
                  deposited: confirmedAmounts
                });

                const feeResult = await this.feeService.transferFees(
                  authority,
                  new PublicKey(poolMetadata.baseMint),
                  new PublicKey(poolMetadata.quoteMint),
                  feeTokenA,
                  feeTokenB
                );

                if (feeResult.success) {
                  this.logger.info('Fees collected successfully', {
                    proposalId,
                    feeTokenA: feeResult.feeTokenA,
                    feeTokenB: feeResult.feeTokenB,
                    signature: feeResult.signature
                  });
                } else {
                  this.logger.warn('Fee collection failed (non-blocking)', {
                    proposalId,
                    error: feeResult.error,
                    feeTokenA: feeResult.feeTokenA,
                    feeTokenB: feeResult.feeTokenB
                  });
                }
              } else {
                this.logger.info('No fees to collect (deposited amount equals or exceeds withdrawn)', {
                  proposalId
                });
              }
            }
          } catch (feeError) {
            // Fee collection is non-blocking - log error but don't fail
            this.logger.warn('Fee collection error (non-blocking)', {
              proposalId,
              error: feeError instanceof Error ? feeError.message : String(feeError)
            });
          }

          return; // Success, exit the method
        } catch (depositError) {
          lastError = depositError instanceof Error ? depositError : new Error(String(depositError));
          this.logger.warn(`Deposit-back attempt ${attempt}/${MAX_RETRIES} failed`, {
            proposalId,
            attempt,
            poolType,
            error: lastError.message
          });

          if (attempt < MAX_RETRIES) {
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
          }
        }
      }

      // All retries failed
      this.logger.error('All deposit-back attempts failed', {
        proposalId,
        totalAttempts: MAX_RETRIES,
        poolType,
        lastError: lastError?.message,
        note: 'Tokens remain in authority wallet, needs_deposit_back=true for manual retry'
      });
      // Don't throw - tokens are safe in authority wallet, can be retried manually
    } catch (error) {
      // Log error but don't fail the finalization
      this.logger.error('Failed to complete deposit-back', {
        proposalId,
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw - we don't want deposit-back failures to prevent finalization
    }
  }
}