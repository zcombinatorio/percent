import { BN } from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import { Decimal } from "decimal.js";

/**
 * Enum representing the operational state of the AMM
 */
export enum AMMState {
  Uninitialized = 'Uninitialized', // AMM not yet initialized
  Trading = 'Trading',              // AMM is active and can perform swaps
  Finalized = 'Finalized'           // AMM has removed liquidity and is closed
}

/**
 * Interface for Automated Market Maker (AMM) in the protocol
 * Manages liquidity pools for conditional token trading
 */
export interface IAMM {
  readonly baseMint: PublicKey;       // Base token mint address (immutable)
  readonly quoteMint: PublicKey;      // Quote token mint address (immutable)
  readonly baseDecimals: number;      // Decimals for base token (immutable)
  readonly quoteDecimals: number;     // Decimals for quote token (immutable)
  readonly state: AMMState;           // Current operational state (readonly)
  readonly isFinalized: boolean;      // Whether the AMM has been finalized
  pool?: PublicKey;                   // Pool address (set after initialization)
  position?: PublicKey;               // Position account address
  positionNft?: PublicKey;            // Position NFT mint address
  
  /**
   * Initializes the AMM pool with initial liquidity
   * Creates pool, position, and deposits initial tokens
   * @param initialBaseTokenAmount - Initial base token amount to deposit
   * @param initialQuoteAmount - Initial quote token amount to deposit
   */
  initialize(
    initialBaseTokenAmount: BN,
    initialQuoteAmount: BN
  ): Promise<void>;
  
  /**
   * Fetches the current price from the pool
   * @returns Current price as base/quote ratio
   * @throws Error if pool is uninitialized or finalized
   */
  fetchPrice(): Promise<Decimal>;
  
  /**
   * Fetches the current liquidity from the pool
   * @returns Current liquidity as BN
   * @throws Error if pool is uninitialized or finalized
   */
  fetchLiquidity(): Promise<BN>;
  
  /**
   * Removes all liquidity and closes the position
   * Sets AMM state to finalized, preventing further operations
   * @throws Error if already finalized or pool uninitialized
   */
  removeLiquidity(): Promise<void>;
  
  /**
   * Builds a transaction for swapping tokens on the AMM
   * @param user - User's public key who is swapping tokens
   * @param isBaseToQuote - Direction of swap (true: base->quote, false: quote->base)
   * @param amountIn - Amount of input tokens to swap
   * @param slippageBps - Slippage tolerance in basis points (default: 50 = 0.5%)
   * @returns Transaction with blockhash and fee payer set, ready for user signature
   * @throws Error if pool is finalized or uninitialized
   */
  buildSwapTx(
    user: PublicKey,
    isBaseToQuote: boolean,
    amountIn: BN,
    slippageBps?: number
  ): Promise<Transaction>;
  
  /**
   * Executes a pre-signed swap transaction
   * @param tx - Transaction already signed by user
   * @returns Transaction signature
   * @throws Error if transaction execution fails
   */
  executeSwapTx(tx: Transaction): Promise<string>;
}