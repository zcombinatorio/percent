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

import { Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountIdempotentInstruction, createTransferInstruction, TOKEN_PROGRAM_ID, NATIVE_MINT, getAccount } from '@solana/spl-token';
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

    /** @deprecated */
    // if (this.config.jitoUuid) {
    //   this.jitoService = new JitoService(BlockEngineUrl.MAINNET, this.config.jitoUuid);
    // }
  }

  /**
   * Get the authority keypair for a specific pool
   * @param poolAddress - DAMM pool address (required)
   * @returns Authority keypair for the pool
   * @throws Error if poolAddress is not provided or not configured
   */
  getAuthorityForPool(poolAddress: string): Keypair {
    if (!poolAddress) {
      throw new Error('Pool address is required - no fallback to database authority');
    }

    if (!this.config.poolAuthorities) {
      throw new Error(
        `No pool authorities configured. Set MANAGER_PRIVATE_KEY_<TICKER> environment variable for pool ${poolAddress}`
      );
    }

    const authority = this.config.poolAuthorities.get(poolAddress);
    if (!authority) {
      throw new Error(
        `No authority configured for pool ${poolAddress}. Set MANAGER_PRIVATE_KEY_<TICKER> environment variable`
      );
    }

    return authority;
  }

  /**
   * Returns a JSON object with all moderator configuration and state information
   * @returns Object containing moderator info
   */
  async info(): Promise<IModeratorInfo> {
    // Build pool authorities map from env vars (not from DB)
    const poolAuthorities: Record<string, string> = {};
    if (this.config.poolAuthorities) {
      for (const [poolAddress, keypair] of this.config.poolAuthorities) {
        poolAuthorities[poolAddress] = keypair.publicKey.toBase58();
      }
    }

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
      poolAuthorities,
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

      // Require spotPoolAddress for authority lookup - no fallback to database
      if (!params.spotPoolAddress) {
        throw new Error('spotPoolAddress is required to determine authority keypair');
      }

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

      // Get authority for this pool
      const authority = this.getAuthorityForPool(metadata.poolAddress);

      // Create transaction signer from authority keypair with validation
      const signTransaction = async (transaction: Transaction) => {
        // Validate fee payer matches authority wallet
        if (!transaction.feePayer?.equals(authority.publicKey)) {
          const error = `Fee payer mismatch: expected ${authority.publicKey.toBase58()}, got ${transaction.feePayer?.toBase58()}`;
          this.logger.error('Transaction validation failed', { proposalId, error });
          throw new Error(error);
        }

        this.logger.debug('Transaction validated, signing with authority', {
          proposalId,
          feePayer: transaction.feePayer.toBase58(),
          authority: authority.publicKey.toBase58(),
          poolAddress: metadata.poolAddress,
          poolType
        });

        transaction.partialSign(authority);
        return transaction;
      };

      // Step 1: Get LP owner address from pool config
      let lpOwnerAddress: string;
      if (poolType === 'dlmm') {
        const poolConfig = await this.dlmmService.getPoolConfig(metadata.poolAddress);
        lpOwnerAddress = poolConfig.lpOwnerAddress;
      } else {
        const poolConfig = await this.dammService.getPoolConfig(metadata.poolAddress);
        lpOwnerAddress = poolConfig.lpOwnerAddress;
      }

      this.logger.info('Fetched LP owner address', {
        proposalId,
        lpOwnerAddress,
        poolAddress: metadata.poolAddress
      });

      // Step 2: Transfer tokens from authority to LP owner
      const lpOwnerPubkey = new PublicKey(lpOwnerAddress);
      const tokenAMint = new PublicKey(poolMetadata.baseMint);
      const tokenBMint = new PublicKey(poolMetadata.quoteMint);

      await this.transferTokensToLpOwner(
        authority,
        lpOwnerPubkey,
        tokenAMint,
        tokenBMint,
        proposalId
      );

      // Step 3: Call cleanup swap and deposit (swap → deposit 0,0)
      this.logger.info('Attempting cleanup swap and deposit', {
        proposalId,
        poolAddress: metadata.poolAddress,
        poolType
      });

      let confirmedAmounts: { tokenA: string; tokenB: string };
      let depositSignature: string;

      if (poolType === 'dlmm') {
        const depositResult = await this.dlmmService.cleanupSwapAndDeposit(
          metadata.poolAddress,
          signTransaction
        );
        if (depositResult) {
          confirmedAmounts = {
            tokenA: depositResult.deposited.tokenX,
            tokenB: depositResult.deposited.tokenY
          };
          depositSignature = depositResult.signature;
        } else {
          confirmedAmounts = { tokenA: '0', tokenB: '0' };
          depositSignature = 'no-deposit-needed';
        }
      } else {
        const depositResult = await this.dammService.cleanupSwapAndDeposit(
          metadata.poolAddress,
          signTransaction
        );
        if (depositResult) {
          confirmedAmounts = {
            tokenA: depositResult.deposited.tokenA,
            tokenB: depositResult.deposited.tokenB
          };
          depositSignature = depositResult.signature;
        } else {
          confirmedAmounts = { tokenA: '0', tokenB: '0' };
          depositSignature = 'no-deposit-needed';
        }
      }

      // Mark as deposited in database
      await this.persistenceService.markWithdrawalDeposited(
        proposalId,
        depositSignature,
        confirmedAmounts.tokenA,
        confirmedAmounts.tokenB
      );

      this.logger.info('Deposit-back completed successfully', {
        proposalId,
        depositSignature,
        poolType,
        confirmedDeposit: confirmedAmounts
      });
    } catch (error) {
      // Log error but don't fail the finalization
      this.logger.error('Failed to complete deposit-back', {
        proposalId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  /**
   * Transfers tokens from authority to LP owner wallet
   * Fetches actual wallet balances and transfers the full amount
   * Creates ATAs if needed and handles native SOL transfers properly
   *
   * IMPORTANT: When tokenA or tokenB is native SOL (NATIVE_MINT), the withdrawal
   * process transfers native SOL (not WSOL) to the manager. The deposit cleanup
   * mode also expects native SOL in the LP owner's wallet. So we must transfer
   * native SOL via SystemProgram.transfer, not SPL token transfer.
   */
  private async transferTokensToLpOwner(
    authority: Keypair,
    lpOwner: PublicKey,
    tokenAMint: PublicKey,
    tokenBMint: PublicKey,
    proposalId: number
  ): Promise<void> {
    // Skip transfer if authority and LP owner are the same address
    // This happens when the pool's LP owner and manager wallet are configured to be the same
    if (authority.publicKey.equals(lpOwner)) {
      this.logger.info('Authority and LP owner are same address, skipping transfer', { proposalId });
      return;
    }

    const isTokenANativeSOL = tokenAMint.equals(NATIVE_MINT);
    const isTokenBNativeSOL = tokenBMint.equals(NATIVE_MINT);
    const connection = this.executionService.connection;

    // Reserve SOL for transaction fees + rent for new accounts (0.125 SOL)
    const SOL_FEE_RESERVE = 125_000_000n;

    // Fetch actual token balances from authority wallet
    let tokenAAmount = 0n;
    let tokenBAmount = 0n;

    // Get tokenA balance
    if (isTokenANativeSOL) {
      const solBalance = await connection.getBalance(authority.publicKey);
      tokenAAmount = BigInt(Math.max(0, solBalance)) - SOL_FEE_RESERVE;
      if (tokenAAmount < 0n) tokenAAmount = 0n;
    } else {
      try {
        const authorityTokenA = await getAssociatedTokenAddress(tokenAMint, authority.publicKey);
        const tokenAAccount = await getAccount(connection, authorityTokenA);
        tokenAAmount = tokenAAccount.amount;
      } catch {
        // Account doesn't exist or has 0 balance
        tokenAAmount = 0n;
      }
    }

    // Get tokenB balance
    if (isTokenBNativeSOL) {
      const solBalance = await connection.getBalance(authority.publicKey);
      // If tokenA is also SOL, we already accounted for the balance above
      // This case shouldn't happen (both tokens being SOL), but handle it
      if (!isTokenANativeSOL) {
        tokenBAmount = BigInt(Math.max(0, solBalance)) - SOL_FEE_RESERVE;
        if (tokenBAmount < 0n) tokenBAmount = 0n;
      }
    } else {
      try {
        const authorityTokenB = await getAssociatedTokenAddress(tokenBMint, authority.publicKey);
        const tokenBAccount = await getAccount(connection, authorityTokenB);
        tokenBAmount = tokenBAccount.amount;
      } catch {
        // Account doesn't exist or has 0 balance
        tokenBAmount = 0n;
      }
    }

    this.logger.info('Transferring tokens to LP owner (actual balances)', {
      proposalId,
      lpOwner: lpOwner.toBase58(),
      tokenAMint: tokenAMint.toBase58(),
      tokenBMint: tokenBMint.toBase58(),
      tokenAAmount: tokenAAmount.toString(),
      tokenBAmount: tokenBAmount.toString(),
      isTokenANativeSOL,
      isTokenBNativeSOL
    });

    // Check if there's anything to transfer
    if (tokenAAmount === 0n && tokenBAmount === 0n) {
      this.logger.info('No tokens to transfer from authority wallet', { proposalId });
      return;
    }

    const transaction = new Transaction();

    // Transfer tokenA
    if (tokenAAmount > 0n) {
      if (isTokenANativeSOL) {
        // TokenA is native SOL - transfer via SystemProgram
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: lpOwner,
            lamports: tokenAAmount
          })
        );
      } else {
        // TokenA is a regular SPL token
        const authorityTokenA = await getAssociatedTokenAddress(tokenAMint, authority.publicKey);
        const lpOwnerTokenA = await getAssociatedTokenAddress(tokenAMint, lpOwner);

        // Create LP owner's ATA if needed
        transaction.add(
          createAssociatedTokenAccountIdempotentInstruction(
            authority.publicKey,
            lpOwnerTokenA,
            lpOwner,
            tokenAMint
          )
        );

        // Transfer tokenA
        transaction.add(
          createTransferInstruction(
            authorityTokenA,
            lpOwnerTokenA,
            authority.publicKey,
            tokenAAmount,
            [],
            TOKEN_PROGRAM_ID
          )
        );
      }
    }

    // Transfer tokenB
    if (tokenBAmount > 0n) {
      if (isTokenBNativeSOL) {
        // TokenB is native SOL - transfer via SystemProgram
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: authority.publicKey,
            toPubkey: lpOwner,
            lamports: tokenBAmount
          })
        );
      } else {
        // TokenB is a regular SPL token
        const authorityTokenB = await getAssociatedTokenAddress(tokenBMint, authority.publicKey);
        const lpOwnerTokenB = await getAssociatedTokenAddress(tokenBMint, lpOwner);

        // Create LP owner's ATA if needed
        transaction.add(
          createAssociatedTokenAccountIdempotentInstruction(
            authority.publicKey,
            lpOwnerTokenB,
            lpOwner,
            tokenBMint
          )
        );

        // Transfer tokenB
        transaction.add(
          createTransferInstruction(
            authorityTokenB,
            lpOwnerTokenB,
            authority.publicKey,
            tokenBAmount,
            [],
            TOKEN_PROGRAM_ID
          )
        );
      }
    }

    // Execute the transfer transaction
    const result = await this.executionService.executeTx(transaction, authority);

    if (result.status === 'failed') {
      throw new Error(`Transfer transaction failed: ${result.error}`);
    }

    this.logger.info('Tokens transferred to LP owner successfully', {
      proposalId,
      signature: result.signature,
      tokenAAmount: tokenAAmount.toString(),
      tokenBAmount: tokenBAmount.toString(),
      isTokenANativeSOL,
      isTokenBNativeSOL
    });
  }
}
