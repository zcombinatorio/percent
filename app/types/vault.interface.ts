import { PublicKey, Connection, Keypair, Transaction } from '@solana/web3.js';

/**
 * Vault type indicating whether this vault represents pass or fail outcome
 */
export enum VaultType {
  Pass = 'pass',
  Fail = 'fail'
}

/**
 * Token type for distinguishing between base and quote tokens
 */
export enum TokenType {
  Base = 'base',   // Primary token (e.g., USDC)
  Quote = 'quote'  // Secondary token (e.g., SOL)
}

/**
 * Complete token balance snapshot for a user
 */
export interface ITokenBalance {
  base: bigint;              // Regular base token balance
  quote: bigint;             // Regular quote token balance
  conditionalBase: bigint;   // Conditional base token balance (pToken or fToken)
  conditionalQuote: bigint;  // Conditional quote token balance (pToken or fToken)
}

/**
 * Configuration for creating a new vault
 */
export interface IVaultConfig {
  proposalId: number;        // Associated proposal ID
  vaultType: VaultType;      // Pass or Fail vault
  baseMint: PublicKey;       // SPL token mint for base token
  quoteMint: PublicKey;      // SPL token mint for quote token
  connection: Connection;    // Solana RPC connection
  authority: Keypair;        // Vault authority keypair for signing
}

/**
 * Information about vault's escrow accounts and conditional mints
 */
export interface IEscrowInfo {
  baseEscrow: PublicKey;           // Escrow account holding base tokens
  quoteEscrow: PublicKey;          // Escrow account holding quote tokens
  conditionalBaseMint: PublicKey;  // Mint for conditional base tokens
  conditionalQuoteMint: PublicKey; // Mint for conditional quote tokens
}

/**
 * Interface for vault managing 1:1 token exchange in prediction markets
 * Handles splitting regular tokens into conditional tokens and merging back
 */
export interface IVault {
  // Immutable properties
  readonly proposalId: number;              // Associated proposal ID
  readonly vaultType: VaultType;            // Pass or Fail vault type
  readonly baseMint: PublicKey;             // Original base token mint
  readonly quoteMint: PublicKey;            // Original quote token mint
  readonly conditionalBaseMint: PublicKey;  // Conditional base token mint (created on init)
  readonly conditionalQuoteMint: PublicKey; // Conditional quote token mint (created on init)
  readonly baseEscrow: PublicKey;           // Escrow holding base tokens
  readonly quoteEscrow: PublicKey;          // Escrow holding quote tokens
  readonly isFinalized: boolean;            // Whether vault has been finalized
  
  /**
   * Initializes vault by creating conditional token mints and escrow accounts
   * Must be called before any other operations
   */
  initialize(): Promise<void>;
  
  /**
   * Builds transaction for splitting regular tokens into conditional tokens
   * Validates user has sufficient regular token balance before building
   * @param user - User's public key who is splitting tokens
   * @param tokenType - Type of token to split (Base or Quote)
   * @param amount - Amount to split in smallest units
   * @returns Unsigned transaction requiring user and authority signatures
   * @throws Error if insufficient balance or vault is finalized
   */
  buildSplitTransaction(
    user: PublicKey,
    tokenType: TokenType,
    amount: bigint
  ): Promise<Transaction>;
  
  /**
   * Builds transaction for merging conditional tokens back to regular tokens
   * Validates user has sufficient conditional token balance before building
   * @param user - User's public key who is merging tokens
   * @param tokenType - Type of token to merge (Base or Quote)
   * @param amount - Amount to merge in smallest units
   * @returns Unsigned transaction requiring user and authority signatures
   * @throws Error if insufficient balance or merging from losing vault after finalization
   */
  buildMergeTransaction(
    user: PublicKey,
    tokenType: TokenType,
    amount: bigint
  ): Promise<Transaction>;
  
  /**
   * Executes a pre-signed split transaction
   * @param transaction - Transaction already signed by user
   * @returns Transaction signature
   */
  executeSplitTransaction(transaction: Transaction): Promise<string>;
  
  /**
   * Executes a pre-signed merge transaction
   * @param transaction - Transaction already signed by user
   * @returns Transaction signature
   */
  executeMergeTransaction(transaction: Transaction): Promise<string>;
  
  /**
   * Gets regular token balance for a user
   * @param user - User's public key
   * @param tokenType - Type of token (Base or Quote)
   * @returns Balance in smallest units
   */
  getBalance(user: PublicKey, tokenType: TokenType): Promise<bigint>;
  
  /**
   * Gets conditional token balance for a user
   * @param user - User's public key
   * @param tokenType - Type of conditional token (Base or Quote)
   * @returns Balance in smallest units
   */
  getConditionalBalance(user: PublicKey, tokenType: TokenType): Promise<bigint>;
  
  /**
   * Gets all token balances for a user
   * @param user - User's public key
   * @returns Complete balance snapshot
   */
  getUserBalances(user: PublicKey): Promise<ITokenBalance>;
  
  /**
   * Gets total supply of regular tokens held in escrow
   * @param tokenType - Type of token (Base or Quote)
   * @returns Total supply in smallest units
   */
  getTotalSupply(tokenType: TokenType): Promise<bigint>;
  
  /**
   * Gets total supply of conditional tokens issued
   * @param tokenType - Type of conditional token (Base or Quote)
   * @returns Total supply in smallest units
   */
  getConditionalTotalSupply(tokenType: TokenType): Promise<bigint>;
  
  /**
   * Finalizes vault when proposal ends, determining winner/loser status
   * @param winningVault - Whether this vault represents winning outcome
   */
  finalize(winningVault: boolean): Promise<void>;
  
  /**
   * Builds a transaction to redeem ALL winning conditional tokens
   * Automatically processes both base and quote tokens in a single transaction
   * @param user - User's public key
   * @returns Unsigned transaction requiring user and authority signatures
   * @throws Error if vault not finalized, not winning vault, or no tokens to redeem
   */
  buildRedeemWinningTokensTransaction(user: PublicKey): Promise<Transaction>;
  
  /**
   * Executes a pre-signed redeem winning tokens transaction
   * @param transaction - Transaction already signed by user
   * @returns Transaction signature
   */
  executeRedeemWinningTokensTransaction(transaction: Transaction): Promise<string>;
  
  /**
   * Builds transaction to close empty token accounts and recover SOL rent
   * @param user - User's public key
   * @returns Transaction to close empty accounts (requires user signature)
   */
  buildCloseEmptyAccountsTransaction(user: PublicKey): Promise<Transaction>;
  
  /**
   * Executes a pre-signed close empty accounts transaction
   * @param transaction - Transaction already signed by user
   * @returns Transaction signature
   */
  executeCloseEmptyAccountsTransaction(transaction: Transaction): Promise<string>;
  
  /**
   * Gets escrow and conditional mint information
   * @returns Escrow accounts and conditional token mints
   */
  getEscrowInfo(): IEscrowInfo;
}