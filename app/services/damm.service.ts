import { Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { LoggerService } from './logger.service';

const API_URL = process.env.DAMM_API_URL || 'https://api.zcombinator.io';

export interface DammDepositBuildResponse {
  success: boolean;
  transaction: string;
  requestId: string;
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  isTokenBNativeSOL: boolean;
  instructionsCount: number;
  amounts: {
    tokenA: string;
    tokenB: string;
    liquidityDelta: string;
  };
  message: string;
}

export interface DammDepositConfirmResponse {
  success: boolean;
  signature: string;
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  amounts: {
    tokenA: string;
    tokenB: string;
    liquidityDelta: string;
  };
  message: string;
}

/**
 * Service for interacting with DAMM pool API
 */
export class DammService {
  private logger: LoggerService;

  constructor(logger: LoggerService) {
    this.logger = logger;
  }

  /**
   * Step 1: Build DAMM deposit transaction
   * @param tokenAAmount - Token A amount in UI units
   * @param tokenBAmount - Token B amount in UI units
   * @param poolAddress - Optional DAMM pool address (defaults to ZC-SOL pool if not provided)
   * @returns Unsigned transaction and metadata
   */
  async buildDammDeposit(
    tokenAAmount: number,
    tokenBAmount: number,
    poolAddress?: string
  ): Promise<DammDepositBuildResponse> {
    try {
      this.logger.info('Building DAMM deposit transaction', {
        tokenAAmount,
        tokenBAmount,
        poolAddress: poolAddress || 'default'
      });

      const requestBody: Record<string, unknown> = {
        tokenAAmount,
        tokenBAmount,
      };
      if (poolAddress) {
        requestBody.poolAddress = poolAddress;
      }

      const response = await fetch(`${API_URL}/damm/deposit/build`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const error = await response.json() as { error?: string };
        throw new Error(error.error || `Deposit build failed: ${response.statusText}`);
      }

      const data = await response.json() as DammDepositBuildResponse;
      this.logger.info('Built DAMM deposit transaction', {
        tokenAAmount,
        tokenBAmount,
        requestId: data.requestId
      });

      return data;
    } catch (error) {
      this.logger.error('Failed to build DAMM deposit', {
        tokenAAmount,
        tokenBAmount,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Step 2: Confirm DAMM deposit transaction
   * @param signedTransaction - Base58 encoded signed transaction
   * @param requestId - Request ID from build step
   * @returns Transaction signature and amounts
   */
  async confirmDammDeposit(
    signedTransaction: string,
    requestId: string
  ): Promise<DammDepositConfirmResponse> {
    try {
      const response = await fetch(`${API_URL}/damm/deposit/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          signedTransaction,
          requestId,
        }),
      });

      if (!response.ok) {
        const error = await response.json() as { error?: string };
        throw new Error(error.error || `Deposit confirm failed: ${response.statusText}`);
      }

      const data = await response.json() as DammDepositConfirmResponse;
      this.logger.info('Confirmed DAMM deposit transaction', {
        requestId,
        signature: data.signature
      });

      return data;
    } catch (error) {
      this.logger.error('Failed to confirm DAMM deposit', {
        requestId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Complete deposit flow: build → sign → confirm
   * @param tokenAAmount - Token A amount in UI units
   * @param tokenBAmount - Token B amount in UI units
   * @param signTransaction - Function to sign transaction (from wallet/keypair)
   * @param poolAddress - Optional DAMM pool address (defaults to ZC-SOL pool if not provided)
   * @returns Deposit result with amounts
   */
  async depositToDammPool(
    tokenAAmount: number,
    tokenBAmount: number,
    signTransaction: (transaction: Transaction) => Promise<Transaction>,
    poolAddress?: string
  ): Promise<DammDepositConfirmResponse> {
    try {
      // Step 1: Build unsigned transaction
      const buildData = await this.buildDammDeposit(tokenAAmount, tokenBAmount, poolAddress);

      // Step 2: Deserialize and sign transaction
      const transactionBuffer = bs58.decode(buildData.transaction);
      const transaction = Transaction.from(transactionBuffer);

      const signedTransaction = await signTransaction(transaction);

      // Step 3: Serialize signed transaction
      const signedTransactionBase58 = bs58.encode(
        signedTransaction.serialize({ requireAllSignatures: false })
      );

      // Step 4: Confirm deposit
      const confirmData = await this.confirmDammDeposit(signedTransactionBase58, buildData.requestId);

      this.logger.info('Completed DAMM deposit', {
        tokenAAmount,
        tokenBAmount,
        signature: confirmData.signature
      });

      return confirmData;
    } catch (error) {
      this.logger.error('Failed to complete DAMM deposit', {
        tokenAAmount,
        tokenBAmount,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
