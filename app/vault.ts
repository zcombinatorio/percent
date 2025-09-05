import { PublicKey, Keypair, Connection, Transaction } from '@solana/web3.js';
import { 
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';
import { 
  IVault, 
  IVaultConfig, 
  ITokenBalance, 
  VaultType, 
  TokenType,
  IEscrowInfo
} from './types/vault.interface';
import { SPLTokenService, AuthorityType } from './services/spl-token.service';
import { ISPLTokenService, ITokenAccountInfo } from './types/spl-token.interface';
import { ExecutionService } from './services/execution.service';
import { IExecutionService, IExecutionConfig } from './types/execution.interface';

/**
 * Vault implementation for managing conditional tokens in prediction markets
 * 
 * Handles the lifecycle of conditional tokens:
 * 1. Split: Regular tokens → Conditional tokens (1:1 exchange)
 * 2. Trade: Users trade conditional tokens on AMMs
 * 3. Finalize: Determine winning/losing vault based on proposal outcome
 * 4. Redeem: Winners exchange conditional tokens → Regular tokens (1:1)
 * 
 * Security features:
 * - Escrow accounts hold regular tokens during active trading
 * - Losing vaults have mint authority revoked after finalization
 * - All operations require proper signatures (user + authority)
 */
export class Vault implements IVault {
  public readonly proposalId: number;
  public readonly vaultType: VaultType;
  public readonly baseMint: PublicKey;
  public readonly quoteMint: PublicKey;
  private _conditionalBaseMint!: PublicKey;
  private _conditionalQuoteMint!: PublicKey;
  private _baseEscrow!: PublicKey;
  private _quoteEscrow!: PublicKey;
  private _isFinalized: boolean = false;
  private _isWinningVault: boolean = false;

  // Public readonly getters
  get conditionalBaseMint(): PublicKey { return this._conditionalBaseMint; }
  get conditionalQuoteMint(): PublicKey { return this._conditionalQuoteMint; }
  get baseEscrow(): PublicKey { return this._baseEscrow; }
  get quoteEscrow(): PublicKey { return this._quoteEscrow; }
  get isFinalized(): boolean { return this._isFinalized; }
  get isWinningVault(): boolean { return this._isWinningVault; }

  private connection: Connection;
  private authority: Keypair;
  private tokenService: ISPLTokenService;
  private executionService: IExecutionService;

  constructor(config: IVaultConfig) {
    this.proposalId = config.proposalId;
    this.vaultType = config.vaultType;
    this.baseMint = config.baseMint;
    this.quoteMint = config.quoteMint;
    this.connection = config.connection;
    this.authority = config.authority;
    
    // Initialize services with ExecutionService
    this.tokenService = new SPLTokenService(
      config.connection,
      config.connection.rpcEndpoint
    );
    
    const executionConfig: IExecutionConfig = {
      rpcEndpoint: config.connection.rpcEndpoint,
      commitment: 'confirmed',
      maxRetries: 3,
      skipPreflight: false
    };
    
    this.executionService = new ExecutionService(executionConfig);
  }

  /**
   * Initializes the vault by creating conditional token mints and escrow accounts
   * Must be called before any split/merge operations
   * Creates two conditional mints (base/quote) with matching decimals to originals
   */
  async initialize(): Promise<void> {
    // Get decimals from original mints
    const baseMintInfo = await this.connection.getParsedAccountInfo(this.baseMint);
    const quoteMintInfo = await this.connection.getParsedAccountInfo(this.quoteMint);
    
    const baseDecimals = (baseMintInfo.value?.data as any)?.parsed?.info?.decimals || 6;
    const quoteDecimals = (quoteMintInfo.value?.data as any)?.parsed?.info?.decimals || 9;

    // Create conditional token mints using ExecutionService
    this._conditionalBaseMint = await this.tokenService.createMint(
      baseDecimals,
      this.authority.publicKey,
      this.authority
    );
    
    this._conditionalQuoteMint = await this.tokenService.createMint(
      quoteDecimals,
      this.authority.publicKey,
      this.authority
    );
    
    // Create escrow accounts
    this._baseEscrow = await this.tokenService.getOrCreateAssociatedTokenAccount(
      this.baseMint,
      this.authority.publicKey,
      this.authority
    );
    
    this._quoteEscrow = await this.tokenService.getOrCreateAssociatedTokenAccount(
      this.quoteMint,
      this.authority.publicKey,
      this.authority
    );
  }

  /**
   * Builds a transaction for splitting regular tokens into conditional tokens
   * @param user - User's public key who is splitting tokens
   * @param tokenType - Type of token to split (Base or Quote)
   * @param amount - Amount to split in smallest units
   * @returns Unsigned transaction requiring user and authority signatures
   * @throws Error if vault is finalized, amount is invalid, or insufficient balance
   */
  async buildSplitTransaction(
    user: PublicKey,
    tokenType: TokenType,
    amount: bigint
  ): Promise<Transaction> {
    if (this._isFinalized) {
      throw new Error('Vault is finalized, no more splits allowed');
    }
    
    if (amount <= 0n) {
      throw new Error('Amount must be positive');
    }
    
    // Check user has sufficient regular token balance
    const userBalance = await this.getBalance(user, tokenType);
    if (amount > userBalance) {
      throw new Error(
        `Insufficient ${tokenType} balance: requested ${amount}, available ${userBalance}`
      );
    }
    
    const regularMint = tokenType === TokenType.Base ? this.baseMint : this.quoteMint;
    const conditionalMint = tokenType === TokenType.Base 
      ? this.conditionalBaseMint 
      : this.conditionalQuoteMint;
    const escrow = tokenType === TokenType.Base ? this.baseEscrow : this.quoteEscrow;
    
    const transaction = new Transaction();
    
    // Get user's token accounts
    const userRegularAccount = await getAssociatedTokenAddress(regularMint, user);
    const userConditionalAccount = await getAssociatedTokenAddress(conditionalMint, user);
    
    // Check if conditional account needs to be created
    const conditionalAccountInfo = await this.tokenService.getTokenAccountInfo(userConditionalAccount);
    if (!conditionalAccountInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          user, // payer
          userConditionalAccount,
          user, // owner
          conditionalMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );
    }
    
    // Transfer regular tokens from user to escrow (user signs)
    const transferTx = this.tokenService.buildTransferTransaction(
      userRegularAccount,
      escrow,
      amount,
      user // user must sign
    );
    transaction.add(...transferTx.instructions);
    
    // Mint conditional tokens to user (authority signs)
    const mintTx = this.tokenService.buildMintToTransaction(
      conditionalMint,
      userConditionalAccount,
      amount,
      this.authority.publicKey // authority must sign
    );
    transaction.add(...mintTx.instructions);
    
    return transaction;
  }

  /**
   * Builds a transaction for merging conditional tokens back to regular tokens
   * @param user - User's public key who is merging tokens
   * @param tokenType - Type of token to merge (Base or Quote)
   * @param amount - Amount to merge in smallest units
   * @returns Unsigned transaction requiring user and authority signatures
   * @throws Error if insufficient balance or trying to merge from losing vault after finalization
   */
  async buildMergeTransaction(
    user: PublicKey,
    tokenType: TokenType,
    amount: bigint
  ): Promise<Transaction> {
    if (this._isFinalized && !this._isWinningVault) {
      throw new Error('Cannot merge from losing vault after finalization');
    }
    
    if (amount <= 0n) {
      throw new Error('Amount must be positive');
    }
    
    // Check user has sufficient conditional token balance
    const userBalance = await this.getConditionalBalance(user, tokenType);
    if (amount > userBalance) {
      throw new Error(
        `Insufficient conditional ${tokenType} balance: requested ${amount}, available ${userBalance}`
      );
    }
    
    const regularMint = tokenType === TokenType.Base ? this.baseMint : this.quoteMint;
    const conditionalMint = tokenType === TokenType.Base 
      ? this.conditionalBaseMint 
      : this.conditionalQuoteMint;
    const escrow = tokenType === TokenType.Base ? this.baseEscrow : this.quoteEscrow;
    
    const transaction = new Transaction();
    
    // Get user's token accounts
    const userRegularAccount = await getAssociatedTokenAddress(regularMint, user);
    const userConditionalAccount = await getAssociatedTokenAddress(conditionalMint, user);
    
    // Burn conditional tokens from user (user signs)
    const burnTx = this.tokenService.buildBurnTransaction(
      conditionalMint,
      userConditionalAccount,
      amount,
      user // user must sign
    );
    transaction.add(...burnTx.instructions);
    
    // Transfer regular tokens from escrow to user (authority signs)
    const transferTx = this.tokenService.buildTransferTransaction(
      escrow,
      userRegularAccount,
      amount,
      this.authority.publicKey // authority must sign
    );
    transaction.add(...transferTx.instructions);
    
    // Optionally close account if balance is 0
    const balance = await this.tokenService.getBalance(userConditionalAccount);
    if (balance === amount) {
      const closeTx = this.tokenService.buildCloseAccountTransaction(
        userConditionalAccount,
        user, // rent goes back to user
        user // user must sign
      );
      transaction.add(...closeTx.instructions);
    }
    
    return transaction;
  }

  /**
   * Executes a pre-signed split transaction
   * @param transaction - Transaction already signed by user
   * @returns Transaction signature
   * @throws Error if transaction execution fails
   * 
   * Note: In production, user signs first, then this method adds authority signature
   */
  async executeSplitTransaction(transaction: Transaction): Promise<string> {
    // Add authority signature to the user-signed transaction
    const result = await this.executionService.executeTransaction(
      transaction,
      this.authority,
      this.proposalId
    );
    
    if (result.status === 'failed') {
      throw new Error(`Split transaction failed: ${result.error}`);
    }
    
    return result.signature;
  }

  /**
   * Executes a pre-signed merge transaction
   * @param transaction - Transaction already signed by user
   * @returns Transaction signature
   * @throws Error if transaction execution fails
   * 
   * Note: In production, user signs first, then this method adds authority signature
   */
  async executeMergeTransaction(transaction: Transaction): Promise<string> {
    // Add authority signature to the user-signed transaction
    const result = await this.executionService.executeTransaction(
      transaction,
      this.authority,
      this.proposalId
    );
    
    if (result.status === 'failed') {
      throw new Error(`Merge transaction failed: ${result.error}`);
    }
    
    return result.signature;
  }

  /**
   * Gets regular token balance for a user
   * @param user - User's public key
   * @param tokenType - Type of token (Base or Quote)
   * @returns Balance in smallest units
   */
  async getBalance(user: PublicKey, tokenType: TokenType): Promise<bigint> {
    const mint = tokenType === TokenType.Base ? this.baseMint : this.quoteMint;
    const userAccount = await getAssociatedTokenAddress(mint, user);
    return this.tokenService.getBalance(userAccount);
  }

  /**
   * Gets conditional token balance for a user
   * @param user - User's public key
   * @param tokenType - Type of conditional token (Base or Quote)
   * @returns Balance in smallest units
   */
  async getConditionalBalance(user: PublicKey, tokenType: TokenType): Promise<bigint> {
    const mint = tokenType === TokenType.Base 
      ? this.conditionalBaseMint 
      : this.conditionalQuoteMint;
    const userAccount = await getAssociatedTokenAddress(mint, user);
    return this.tokenService.getBalance(userAccount);
  }

  /**
   * Gets all token balances for a user in a single call
   * @param user - User's public key
   * @returns Complete balance snapshot for all token types
   */
  async getUserBalances(user: PublicKey): Promise<ITokenBalance> {
    const [base, quote, conditionalBase, conditionalQuote] = await Promise.all([
      this.getBalance(user, TokenType.Base),
      this.getBalance(user, TokenType.Quote),
      this.getConditionalBalance(user, TokenType.Base),
      this.getConditionalBalance(user, TokenType.Quote)
    ]);
    
    return {
      base,
      quote,
      conditionalBase,
      conditionalQuote
    };
  }

  /**
   * Gets total supply of regular tokens held in escrow
   * @param tokenType - Type of token (Base or Quote)
   * @returns Total supply in smallest units
   */
  async getTotalSupply(tokenType: TokenType): Promise<bigint> {
    const escrow = tokenType === TokenType.Base ? this.baseEscrow : this.quoteEscrow;
    return this.tokenService.getBalance(escrow);
  }

  /**
   * Gets total supply of conditional tokens issued
   * @param tokenType - Type of conditional token (Base or Quote)
   * @returns Total supply in smallest units
   */
  async getConditionalTotalSupply(tokenType: TokenType): Promise<bigint> {
    const mint = tokenType === TokenType.Base 
      ? this.conditionalBaseMint 
      : this.conditionalQuoteMint;
    return this.tokenService.getTotalSupply(mint);
  }

  /**
   * Finalizes the vault when proposal ends, determining winner/loser status
   * @param winningVault - Whether this vault represents winning outcome
   * @throws Error if vault is already finalized
   * 
   * Effects:
   * - Sets finalized flag preventing new splits
   * - For losing vaults: Revokes mint authority on conditional tokens
   * - For winning vaults: Keeps mint authority for redemptions
   */
  async finalize(winningVault: boolean): Promise<void> {
    if (this._isFinalized) {
      throw new Error('Vault is already finalized');
    }
    
    this._isFinalized = true;
    this._isWinningVault = winningVault;
    
    // If losing vault, revoke mint authority to prevent new conditional tokens
    if (!winningVault) {
      try {
        // Revoke mint authority for base conditional tokens
        await this.tokenService.setAuthority(
          this.conditionalBaseMint,
          null, // null revokes the authority
          AuthorityType.MintTokens,
          this.authority
        );
        
        // Revoke mint authority for quote conditional tokens
        await this.tokenService.setAuthority(
          this.conditionalQuoteMint,
          null, // null revokes the authority
          AuthorityType.MintTokens,
          this.authority
        );
      } catch (error) {
        console.error(`Failed to revoke mint authority for vault ${this.vaultType}:`, error);
        // Continue even if revocation fails - vault is still finalized
      }
    }
  }

  /**
   * Builds a transaction to redeem ALL winning conditional tokens for regular tokens
   * Automatically processes both base and quote tokens in a single transaction
   * @param user - User's public key
   * @returns Unsigned transaction requiring user and authority signatures
   * @throws Error if vault not finalized, not winning vault, or no tokens to redeem
   */
  async buildRedeemWinningTokensTransaction(user: PublicKey): Promise<Transaction> {
    if (!this._isFinalized) {
      throw new Error('Cannot redeem before vault finalization');
    }
    
    if (!this._isWinningVault) {
      throw new Error('Cannot redeem from losing vault');
    }
    
    // Get user's conditional token balances
    const baseBalance = await this.getConditionalBalance(user, TokenType.Base);
    const quoteBalance = await this.getConditionalBalance(user, TokenType.Quote);
    
    if (baseBalance === 0n && quoteBalance === 0n) {
      throw new Error('No winning tokens to redeem');
    }
    
    const transaction = new Transaction();
    
    // Process base tokens if any
    if (baseBalance > 0n) {
      const userBaseRegularAccount = await getAssociatedTokenAddress(this.baseMint, user);
      const userBaseConditionalAccount = await getAssociatedTokenAddress(this.conditionalBaseMint, user);
      
      // Burn all conditional base tokens
      const burnBaseTx = this.tokenService.buildBurnTransaction(
        this.conditionalBaseMint,
        userBaseConditionalAccount,
        baseBalance,
        user
      );
      transaction.add(...burnBaseTx.instructions);
      
      // Transfer regular base tokens from escrow
      const transferBaseTx = this.tokenService.buildTransferTransaction(
        this.baseEscrow,
        userBaseRegularAccount,
        baseBalance,
        this.authority.publicKey
      );
      transaction.add(...transferBaseTx.instructions);
      
      // Close the empty conditional account
      const closeBaseTx = this.tokenService.buildCloseAccountTransaction(
        userBaseConditionalAccount,
        user,
        user
      );
      transaction.add(...closeBaseTx.instructions);
    }
    
    // Process quote tokens if any
    if (quoteBalance > 0n) {
      const userQuoteRegularAccount = await getAssociatedTokenAddress(this.quoteMint, user);
      const userQuoteConditionalAccount = await getAssociatedTokenAddress(this.conditionalQuoteMint, user);
      
      // Burn all conditional quote tokens
      const burnQuoteTx = this.tokenService.buildBurnTransaction(
        this.conditionalQuoteMint,
        userQuoteConditionalAccount,
        quoteBalance,
        user
      );
      transaction.add(...burnQuoteTx.instructions);
      
      // Transfer regular quote tokens from escrow
      const transferQuoteTx = this.tokenService.buildTransferTransaction(
        this.quoteEscrow,
        userQuoteRegularAccount,
        quoteBalance,
        this.authority.publicKey
      );
      transaction.add(...transferQuoteTx.instructions);
      
      // Close the empty conditional account
      const closeQuoteTx = this.tokenService.buildCloseAccountTransaction(
        userQuoteConditionalAccount,
        user,
        user
      );
      transaction.add(...closeQuoteTx.instructions);
    }
    
    return transaction;
  }

  /**
   * Executes a pre-signed redeem winning tokens transaction
   * @param transaction - Transaction already signed by user
   * @returns Transaction signature
   * @throws Error if transaction execution fails
   */
  async executeRedeemWinningTokensTransaction(transaction: Transaction): Promise<string> {
    // Add authority signature to the user-signed transaction
    const result = await this.executionService.executeTransaction(
      transaction,
      this.authority,
      this.proposalId
    );
    
    if (result.status === 'failed') {
      throw new Error(`Redeem winning tokens transaction failed: ${result.error}`);
    }
    
    return result.signature;
  }

  /**
   * Builds transaction to close empty token accounts and recover SOL rent
   * @param user - User's public key
   * @returns Transaction to close empty accounts (requires user signature)
   * 
   * Note: Only includes instructions for accounts with zero balance
   */
  async buildCloseEmptyAccountsTransaction(user: PublicKey): Promise<Transaction> {
    const transaction = new Transaction();
    
    // Check conditional token accounts
    const baseAccount = await getAssociatedTokenAddress(this.conditionalBaseMint, user);
    const quoteAccount = await getAssociatedTokenAddress(this.conditionalQuoteMint, user);
    
    const baseBalance = await this.tokenService.getBalance(baseAccount);
    if (baseBalance === 0n) {
      const closeTx = this.tokenService.buildCloseAccountTransaction(
        baseAccount,
        user,  // rent destination
        user   // owner who must sign
      );
      transaction.add(...closeTx.instructions);
    }
    
    const quoteBalance = await this.tokenService.getBalance(quoteAccount);
    if (quoteBalance === 0n) {
      const closeTx = this.tokenService.buildCloseAccountTransaction(
        quoteAccount,
        user,  // rent destination  
        user   // owner who must sign
      );
      transaction.add(...closeTx.instructions);
    }
    
    return transaction;
  }

  /**
   * Executes a pre-signed close empty accounts transaction
   * @param transaction - Transaction already signed by user
   * @returns Transaction signature
   * @throws Error if transaction execution fails
   * 
   * Note: User must sign the transaction as they own the token accounts
   */
  async executeCloseEmptyAccountsTransaction(transaction: Transaction): Promise<string> {
    // Transaction should already be signed by user
    // No authority signature needed for closing user's accounts
    const result = await this.executionService.executeTransaction(
      transaction,
      this.authority,  // Just for execution service, not signing
      this.proposalId
    );
    
    if (result.status === 'failed') {
      throw new Error(`Close accounts transaction failed: ${result.error}`);
    }
    
    return result.signature;
  }

  /**
   * Gets escrow and conditional mint information
   * @returns Escrow accounts and conditional token mints
   */
  getEscrowInfo(): IEscrowInfo {
    return {
      baseEscrow: this.baseEscrow,
      quoteEscrow: this.quoteEscrow,
      conditionalBaseMint: this.conditionalBaseMint,
      conditionalQuoteMint: this.conditionalQuoteMint
    };
  }
}