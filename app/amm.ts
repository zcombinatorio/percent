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

import { Keypair, PublicKey, Transaction} from '@solana/web3.js';
import { IAMM, AMMState, IAMMSerializedData, IAMMDeserializeConfig } from './types/amm.interface';
import { createMemoIx } from './utils/memo';
import {
  CpAmm,
  MAX_SQRT_PRICE,
  MIN_SQRT_PRICE,
  PoolFeesParams,
  PoolState,
  PositionState,
  RemoveAllLiquidityAndClosePositionParams,
  SwapParams,
  getPriceFromSqrtPrice,
  derivePositionNftAccount
} from "@meteora-ag/cp-amm-sdk";
import { IExecutionService } from './types/execution.interface';
import { BN } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Decimal } from 'decimal.js';
import { LoggerService } from '@app/services/logger.service';

/**
 * AMM class implementing automated market maker functionality
 * Uses Meteora's CP-AMM SDK for constant product pools
 * Manages liquidity provision and token swaps for conditional tokens
 */
export class AMM implements IAMM {
  public readonly baseMint: PublicKey;          // Base token mint (e.g., conditional token)
  public readonly quoteMint: PublicKey;         // Quote token mint (e.g., SOL or USDC)
  public readonly baseDecimals: number;         // Decimal precision for base token
  public readonly quoteDecimals: number;        // Decimal precision for quote token
  public authority: Keypair;                    // Authority keypair for signing transactions
  public cpAmm: CpAmm;                          // Meteora CP-AMM SDK instance
  public pool?: PublicKey;                      // Pool address (set after initialization)
  public position?: PublicKey;                  // Position account (tracks LP ownership)
  public positionNft?: PublicKey;               // NFT mint representing position ownership
  public state: AMMState = AMMState.Uninitialized;  // Current operational state
  private executionService: IExecutionService;  // Service for executing blockchain transactions
  private logger: LoggerService;

  /**
   * Whether the AMM has been finalized
   */
  get isFinalized(): boolean {
    return this.state === AMMState.Finalized;
  }

  /**
   * Creates a new AMM instance
   * @param baseMint - Public key of the base token mint
   * @param quoteMint - Public key of the quote token mint
   * @param baseDecimals - Number of decimals for base token
   * @param quoteDecimals - Number of decimals for quote token
   * @param authority - Keypair with authority to manage the AMM
   * @param executionService - Execution service for transactions
   * @param logger - Logger service for this AMM
   */
  constructor(
    baseMint: PublicKey,
    quoteMint: PublicKey,
    baseDecimals: number,
    quoteDecimals: number,
    authority: Keypair,
    executionService: IExecutionService,
    logger: LoggerService
  ) {
    this.baseMint = baseMint;
    this.quoteMint = quoteMint;
    this.baseDecimals = baseDecimals;
    this.quoteDecimals = quoteDecimals;
    this.authority = authority;
    this.executionService = executionService;
    this.cpAmm = new CpAmm(this.executionService.connection);
    this.logger = logger;
  }

  /**
   * Builds a transaction for initializing the AMM pool with initial liquidity
   * Transaction is always pre-signed with authority and position NFT keypair
   * @param initialBaseTokenAmount - Amount of base tokens to deposit initially
   * @param initialQuoteAmount - Amount of quote tokens to deposit initially
   * @returns Pre-signed transaction ready for execution
   * @throws Error if AMM is already initialized
   */
  async buildInitializeTx(
    initialBaseTokenAmount: BN,
    initialQuoteAmount: BN
  ): Promise<Transaction> {
    if (this.state !== AMMState.Uninitialized) {
      throw new Error('AMM already initialized');
    }

    // Generate keypair for position NFT (represents LP ownership)
    const positionNftKeypair = new Keypair();

    // Calculate initial price and liquidity based on deposited amounts
    const { initSqrtPrice, liquidityDelta } = this.cpAmm.preparePoolCreationParams({
      tokenAAmount: initialBaseTokenAmount,
      tokenBAmount: initialQuoteAmount,
      minSqrtPrice: MIN_SQRT_PRICE,
      maxSqrtPrice: MAX_SQRT_PRICE
    });

    // Configure pool fees (0.5% fee in quote token only)
    const poolFees: PoolFeesParams = {
      baseFee: {
        feeSchedulerMode: 0,                     // Linear fee schedule
        cliffFeeNumerator: new BN(5_000_000),    // 0.5% fee (5M / 1B)
        numberOfPeriod: 0,                       // No fee decay
        reductionFactor: new BN(0),              // No reduction
        periodFrequency: new BN(0)               // No period changes
      },
      dynamicFee: null,                          // No dynamic fees
      padding: []                                // Reserved for future use
    };

    // Build transaction to create custom pool with initial liquidity
    const {
      tx,
      pool,
      position
    } = await this.cpAmm.createCustomPool({
      payer: this.authority.publicKey,
      creator: this.authority.publicKey,
      positionNft: positionNftKeypair.publicKey,
      tokenAMint: this.baseMint,
      tokenBMint: this.quoteMint,
      tokenAAmount: initialBaseTokenAmount,
      tokenBAmount: initialQuoteAmount,
      sqrtMinPrice: MIN_SQRT_PRICE,
      sqrtMaxPrice: MAX_SQRT_PRICE,
      initSqrtPrice: initSqrtPrice,
      liquidityDelta: liquidityDelta,
      poolFees: poolFees,
      hasAlphaVault: false,                     // No alpha vault needed
      collectFeeMode: 1,                        // Collect fees in quote token only (OnlyB)
      activationPoint: null,                     // Activate immediately
      activationType: 1,                        // Activation by timestamp
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID
    });

    // Add blockhash and fee payer
    const { blockhash } = await this.executionService.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.authority.publicKey;

    // Add compute budget instructions before signing
    await this.executionService.addComputeBudgetInstructions(tx);

    // Pre-sign the transaction with authority and position NFT keypair
    tx.sign(this.authority, positionNftKeypair);

    // Store pool and position references
    this.pool = pool;
    this.position = position;
    this.positionNft = positionNftKeypair.publicKey;

    return tx;
  }

  /**
   * Initializes the AMM pool with initial liquidity
   * Creates a new constant product pool and deposits initial tokens
   * @param initialBaseTokenAmount - Amount of base tokens to deposit initially
   * @param initialQuoteAmount - Amount of quote tokens to deposit initially
   * @throws Error if pool creation fails
   */
  async initialize(
    initialBaseTokenAmount: BN,
    initialQuoteAmount: BN
  ): Promise<void> {
    // Build the pre-signed initialization transaction (also stores pool/position references)
    const transaction = await this.buildInitializeTx(
      initialBaseTokenAmount,
      initialQuoteAmount
    );

    // Execute pool creation transaction (already has all signatures)
    this.logger.debug('Executing transaction to create custom pool');
    const result = await this.executionService.executeTx(transaction);

    if (result.status === 'failed') {
      throw new Error(`Failed to create custom pool: ${result.error}`);
    }

    // Update state to Trading
    this.state = AMMState.Trading;
  }

  /**
   * Fetches the current price from the pool
   * Price represents the exchange rate between base and quote tokens
   * @returns Current price as a Decimal (base/quote ratio)
   * @throws Error if AMM is finalized or pool uninitialized
   */
  async fetchPrice(): Promise<Decimal> {
    if (this.state === AMMState.Uninitialized || !this.pool) {
      throw new Error('AMM not initialized');
    }
    
    // Fetch current pool state and convert sqrt price to regular price
    const poolState: PoolState = await this.cpAmm.fetchPoolState(this.pool);
    return getPriceFromSqrtPrice(poolState.sqrtPrice, this.baseDecimals, this.quoteDecimals);
  }

  /**
   * Fetches the current liquidity from the pool
   * @returns Current liquidity as BN
   * @throws Error if AMM is finalized or pool uninitialized
   */
  async fetchLiquidity(): Promise<BN> {
    if (this.state === AMMState.Uninitialized || !this.pool) {
      throw new Error('AMM not initialized');
    }
    
    // Fetch current pool state and return liquidity
    const poolState: PoolState = await this.cpAmm.fetchPoolState(this.pool);
    return poolState.liquidity;
  }

  /**
   * Builds a transaction for removing all liquidity from the pool
   * Transaction is always pre-signed with authority
   * @returns Pre-signed transaction ready for execution
   * @throws Error if AMM is not initialized, already finalized, or pool uninitialized
   */
  async buildRemoveLiquidityTx(): Promise<Transaction> {
    if (this.state === AMMState.Uninitialized
       || !this.pool 
       || !this.position 
       || !this.positionNft
      ) {
      throw new Error('AMM not initialized');
    }

    if (this.state === AMMState.Finalized) {
      throw new Error('AMM is already finalized');
    }

    // Fetch current pool and position states for removal operation
    const poolState: PoolState = await this.cpAmm.fetchPoolState(this.pool);
    const positionState: PositionState = await this.cpAmm.fetchPositionState(this.position);

    // Derive the position NFT account (token account holding the NFT)
    const positionNftAccount = derivePositionNftAccount(this.positionNft);

    // Configure parameters for complete liquidity removal
    const params: RemoveAllLiquidityAndClosePositionParams = {
      owner: this.authority.publicKey,
      position: this.position,
      positionNftAccount: positionNftAccount,
      positionState: positionState,
      poolState: poolState,
      tokenAAmountThreshold: new BN(0),         // Accept any amount (no slippage protection)
      tokenBAmountThreshold: new BN(0),         // Accept any amount (no slippage protection)
      currentPoint: new BN(Math.floor(Date.now() / 1000)), // Current timestamp for vesting
      vestings: []                              // No vesting accounts
    };

    // Build transaction to remove all liquidity and close position
    const tx = await this.cpAmm.removeAllLiquidityAndClosePosition(params);

    // Add blockhash and fee payer
    const { blockhash } = await this.executionService.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.authority.publicKey;

    // Add compute budget instructions before signing
    await this.executionService.addComputeBudgetInstructions(tx);

    // Pre-sign the transaction with authority
    tx.sign(this.authority);

    return tx;
  }

  /**
   * Removes all liquidity from the pool and closes the position
   * This action is irreversible and finalizes the AMM
   * @throws Error if AMM is already finalized or pool uninitialized
   */
  async removeLiquidity(): Promise<string> {
    // Build the pre-signed remove liquidity transaction
    const tx = await this.buildRemoveLiquidityTx();

    // Execute the pre-signed transaction
    this.logger.debug('Executing transaction to remove liquidity and close position');
    const result = await this.executionService.executeTx(tx);

    if (result.status === 'failed') {
      throw new Error(`Failed to remove liquidity and close position: ${result.error}`);
    }

    // Clear position references after successful closure
    delete this.position;
    delete this.positionNft;

    // Mark AMM as finalized - no further operations allowed
    this.state = AMMState.Finalized;

    return result.signature;
  }

  /**
   * Gets a quote for swapping tokens on the AMM
   * @param isBaseToQuote - Direction of swap (true: base->quote, false: quote->base)
   * @param amountIn - Amount of input tokens to swap
   * @param slippageBps - Slippage tolerance in basis points (default: 50 = 0.5%)
   * @returns Quote with expected output, fees, and price impact
   * @throws Error if pool is finalized or uninitialized
   */
  async getQuote(
    isBaseToQuote: boolean,
    amountIn: BN,
    slippageBps: number = 50
  ): Promise<{
    swapInAmount: BN;
    consumedInAmount: BN;
    swapOutAmount: BN;
    minSwapOutAmount: BN;
    totalFee: BN;
    priceImpact: number;
  }> {
    if (this.state === AMMState.Uninitialized || !this.pool) {
      throw new Error('AMM not initialized');
    }
    
    if (this.state === AMMState.Finalized) {
      throw new Error('AMM is finalized - cannot get quote');
    }
    
    // Fetch current pool state
    const poolState: PoolState = await this.cpAmm.fetchPoolState(this.pool);
    
    // Get current slot and block time for quote calculation
    const connection = this.executionService.connection;
    const currentSlot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(currentSlot);
    
    if (!blockTime) {
      throw new Error('Failed to get block time');
    }

    // Determine input and output mints based on swap direction
    const inputTokenMint = isBaseToQuote ? this.baseMint : this.quoteMint;
    
    // Get quote with slippage protection
    const quote = this.cpAmm.getQuote({
      inAmount: amountIn,
      inputTokenMint: inputTokenMint,
      slippage: slippageBps / 10000, // Convert basis points to decimal
      poolState,
      currentTime: blockTime,
      currentSlot,
      tokenADecimal: this.baseDecimals,
      tokenBDecimal: this.quoteDecimals,
    });

    // Convert priceImpact from Decimal to number
    return {
      ...quote,
      priceImpact: quote.priceImpact.toNumber()
    };
  }

  /**
   * Builds a transaction for swapping tokens on the AMM
   * @param user - User's public key who is swapping tokens
   * @param isBaseToQuote - Direction of swap (true: base->quote, false: quote->base)
   * @param amountIn - Amount of input tokens to swap
   * @param slippageBps - Slippage tolerance in basis points (default: 50 = 0.5%)
   * @returns Transaction with blockhash and fee payer set, ready for user signature
   * @throws Error if pool is finalized or uninitialized
   */
  async buildSwapTx(
    user: PublicKey,
    isBaseToQuote: boolean,
    amountIn: BN,
    slippageBps: number = 50
  ): Promise<Transaction> {
    if (this.state === AMMState.Uninitialized || !this.pool) {
      throw new Error('AMM not initialized');
    }
    
    if (this.state === AMMState.Finalized) {
      throw new Error('AMM is finalized - cannot execute swaps');
    }
    
    // Fetch current pool state
    const poolState: PoolState = await this.cpAmm.fetchPoolState(this.pool);
    
    // Get current slot and block time for quote calculation
    const connection = this.executionService.connection;
    const currentSlot = await connection.getSlot();
    const blockTime = await connection.getBlockTime(currentSlot);
    
    if (!blockTime) {
      throw new Error('Failed to get block time');
    }

    // Determine input and output mints based on swap direction
    const inputTokenMint = isBaseToQuote ? this.baseMint : this.quoteMint;
    const outputTokenMint = isBaseToQuote ? this.quoteMint : this.baseMint;
    
    // Get quote with slippage protection
    const quote = this.cpAmm.getQuote({
      inAmount: amountIn,
      inputTokenMint: inputTokenMint,
      slippage: slippageBps / 10000, // Convert basis points to decimal
      poolState,
      currentTime: blockTime,
      currentSlot,
      tokenADecimal: this.baseDecimals,
      tokenBDecimal: this.quoteDecimals,
    });

    // Prepare swap parameters with user as payer
    const swapParams: SwapParams = {
      payer: user,
      pool: this.pool,
      inputTokenMint: inputTokenMint,
      outputTokenMint: outputTokenMint,
      amountIn: amountIn,
      minimumAmountOut: quote.minSwapOutAmount,
      tokenAVault: poolState.tokenAVault,
      tokenBVault: poolState.tokenBVault,
      tokenAMint: poolState.tokenAMint,
      tokenBMint: poolState.tokenBMint,
      tokenAProgram: TOKEN_PROGRAM_ID,
      tokenBProgram: TOKEN_PROGRAM_ID,
      referralTokenAccount: null, // No referral account
    };

    // Build swap transaction
    const swapTx = await this.cpAmm.swap(swapParams);

    // Add memo for transaction identification on Solscan
    const swapDirection = isBaseToQuote ? 'base→quote' : 'quote→base';
    const memoMessage = `%[Swap] ${amountIn} ${swapDirection} | Pool: ${this.pool.toBase58().slice(0, 8)}... | ${user.toBase58()}`;
    swapTx.add(createMemoIx(memoMessage));

    // Add blockhash and fee payer so transaction can be signed
    const { blockhash } = await this.executionService.connection.getLatestBlockhash();
    swapTx.recentBlockhash = blockhash;
    swapTx.feePayer = user;

    // Add compute budget instructions (swap needs high priority)
    await this.executionService.addComputeBudgetInstructions(swapTx);

    return swapTx;
  }

  /**
   * Executes a pre-signed swap transaction
   * @param tx - Transaction already signed by user
   * @returns Transaction signature
   * @throws Error if transaction execution fails
   */
  async executeSwapTx(tx: Transaction): Promise<string> {
    if (this.state === AMMState.Uninitialized) {
      throw new Error('AMM not initialized - cannot execute swap');
    }
    
    if (this.state === AMMState.Finalized) {
      throw new Error('AMM is finalized - cannot execute swaps');
    }
    
    // Execute without adding authority signature (swaps only need user signature)
    this.logger.debug('Executing transaction to swap tokens');
    const result = await this.executionService.executeTx(tx);

    if (result.status === 'failed') {
      throw new Error(`Swap transaction failed: ${result.error}`);
    }

    return result.signature;
  }

  /**
   * Serializes the AMM state for persistence
   * @returns Serialized AMM data that can be saved to database
   */
  serialize(): IAMMSerializedData {
    return {
      // Token configuration
      baseMint: this.baseMint.toBase58(),
      quoteMint: this.quoteMint.toBase58(),
      baseDecimals: this.baseDecimals,
      quoteDecimals: this.quoteDecimals,

      // Pool state - handle optional fields
      state: this.state,
      pool: this.pool?.toBase58(),
      position: this.position?.toBase58(),
      positionNft: this.positionNft?.toBase58(),

      // Note: We don't serialize authority, cpAmm instance, or services
      // as those are reconstructed during deserialization
    };
  }

  /**
   * Deserializes AMM data and restores the AMM state
   * @param data - Serialized AMM data from database
   * @param config - Configuration for reconstructing the AMM
   * @returns Restored AMM instance
   */
  static deserialize(data: IAMMSerializedData, config: IAMMDeserializeConfig): AMM {
    // Create a new AMM instance with the provided config
    const amm = new AMM(
      new PublicKey(data.baseMint),
      new PublicKey(data.quoteMint),
      data.baseDecimals,
      data.quoteDecimals,
      config.authority,
      config.executionService,
      config.logger
    );

    // Restore the state
    amm.state = data.state;

    // Restore the pool references if they exist
    if (data.pool) {
      amm.pool = new PublicKey(data.pool);
    }
    if (data.position) {
      amm.position = new PublicKey(data.position);
    }
    if (data.positionNft) {
      amm.positionNft = new PublicKey(data.positionNft);
    }

    // The cpAmm instance is already created in the constructor
    // Authority and services are provided through config

    return amm;
  }

}