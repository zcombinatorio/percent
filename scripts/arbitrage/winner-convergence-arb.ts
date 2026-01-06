#!/usr/bin/env ts-node
/**
 * Winner Convergence Arbitrage Script
 *
 * ============================================================================
 * OVERVIEW
 * ============================================================================
 *
 * Once a proposal winner is "guaranteed" (break-even multiplier > 2x), the
 * winning conditional token should converge to spot price since it will be
 * redeemable 1:1 for the real token post-finalization.
 *
 * This script exploits price divergence between the winner and spot:
 *
 * PREMIUM (winner priced above spot):
 *   1. Buy TOKEN with SOL on spot pool
 *   2. Split TOKEN → cond_TOKEN for each market (base vault deposit)
 *   3. Sell winner's cond_TOKEN → cond_SOL on winner's AMM
 *   4. Result: More cond_SOL than SOL spent
 *   5. After finalization: Redeem cond_SOL → real SOL
 *
 * DISCOUNT (winner priced below spot):
 *   1. Sell TOKEN for SOL on spot pool
 *   2. Split SOL → cond_SOL for each market (quote vault deposit)
 *   3. Buy winner's cond_TOKEN with cond_SOL on winner's AMM
 *   4. Result: More cond_TOKEN than TOKEN sold
 *   5. After finalization: Redeem cond_TOKEN → real TOKEN
 *
 * ============================================================================
 * KEY DIFFERENCE FROM CONDITIONAL-SPOT ARB
 * ============================================================================
 *
 * - Conditional-Spot Arb: Risk-free, requires ALL conditionals same direction
 * - Winner Convergence: Requires winner to be "guaranteed" (multiplier > 2x)
 *                       Only trades on the winner market
 *                       No withdrawal until finalization
 *
 * ============================================================================
 */

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import { VaultClient, VaultType } from '@zcomb/vault-sdk';
import { CpAmm, getPriceFromSqrtPrice, PoolState, SwapParams } from '@meteora-ag/cp-amm-sdk';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { ExecutionService } from '@app/services/execution.service';
import { Decimal } from 'decimal.js';
import * as dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// CONFIGURATION
// ============================================================================
const MODERATOR_ID = 6;
const PROPOSAL_ID = 9;
const MIN_MULTIPLIER = 2.0;     // Only execute if break-even multiplier > this
const MIN_PREMIUM_BPS = 0;      // Minimum 0% premium/discount to execute
const MAX_SLIPPAGE_BPS = 500;   // 5% max slippage
const DRY_RUN = true;           // Simulate only by default
const MAX_TRADE_SOL = 10;       // Maximum SOL to use (safety cap)

// API endpoint for fetching proposal data
const API_BASE_URL = process.env.PERCENT_API_URL || 'http://localhost:3000';

// ============================================================================
// TYPES
// ============================================================================

interface ProposalData {
  moderatorId: number;
  id: number;
  title: string;
  status: string;
  spotPoolAddress: string | null;
  baseMint: string;
  quoteMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  markets: number;
  marketLabels?: string[];
  ammData: Array<{
    baseMint: string;
    quoteMint: string;
    baseDecimals: number;
    quoteDecimals: number;
    state: string;
    pool?: string;
  }>;
  vaultPDA: string;
  createdAt: number;
  finalizedAt: number;
}

interface TWAPHistoryEntry {
  twaps: string[];
  aggregations: string[];
  timestamp: string;
}

interface TWAPResponse {
  data: TWAPHistoryEntry[];
}

interface ExecutionResult {
  success: boolean;
  signatures: string[];
  error?: string;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function fetchProposalData(moderatorId: number, proposalId: number): Promise<ProposalData> {
  const url = `${API_BASE_URL}/api/proposals/${proposalId}?moderatorId=${moderatorId}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch proposal: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<ProposalData>;
}

async function fetchLatestTWAP(moderatorId: number, proposalId: number): Promise<TWAPHistoryEntry | null> {
  const url = `${API_BASE_URL}/api/history/${proposalId}/twap?moderatorId=${moderatorId}`;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json() as TWAPResponse;
    if (data.data && data.data.length > 0) {
      // Data is in reverse chronological order (newest first)
      return data.data[0];
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchPoolPrice(
  cpAmm: CpAmm,
  poolAddress: string,
  baseDecimals: number,
  quoteDecimals: number
): Promise<Decimal> {
  const pool = new PublicKey(poolAddress);
  const poolState: PoolState = await cpAmm.fetchPoolState(pool);
  return getPriceFromSqrtPrice(poolState.sqrtPrice, baseDecimals, quoteDecimals);
}

/**
 * Calculate break-even multiplier for challenger to overtake leader
 * Formula: M = gap / (leaderTwap × remainingTime) + 1
 */
function calculateBreakEvenMultiplier(
  twapEntry: TWAPHistoryEntry,
  proposalEndTime: number
): { multiplier: number; leaderIdx: number; challengerIdx: number; remainingHours: number } {
  const twaps = twapEntry.twaps.map(t => parseFloat(t));
  const aggregations = twapEntry.aggregations.map(a => parseFloat(a));

  // Use CURRENT time for remaining time calculation
  const currentTime = Date.now();
  const remainingTime = Math.max(0, proposalEndTime - currentTime);
  const remainingHours = remainingTime / 1000 / 60 / 60;

  // Find leader (highest TWAP)
  let leaderIdx = 0;
  let maxTwap = twaps[0];
  for (let i = 1; i < twaps.length; i++) {
    if (twaps[i] > maxTwap) {
      maxTwap = twaps[i];
      leaderIdx = i;
    }
  }

  // Find challenger (highest aggregation among non-leaders)
  let challengerIdx = 0;
  let maxChallengerAgg = -Infinity;
  for (let i = 0; i < aggregations.length; i++) {
    if (i !== leaderIdx && aggregations[i] > maxChallengerAgg) {
      maxChallengerAgg = aggregations[i];
      challengerIdx = i;
    }
  }

  const leaderAgg = aggregations[leaderIdx];
  const gap = leaderAgg - maxChallengerAgg;
  const leaderTwap = twaps[leaderIdx];

  if (remainingTime <= 0 || leaderTwap <= 0) {
    return { multiplier: Infinity, leaderIdx, challengerIdx, remainingHours };
  }

  const multiplier = (gap / (leaderTwap * remainingTime)) + 1;
  return { multiplier, leaderIdx, challengerIdx, remainingHours };
}

function formatPrice(price: Decimal, decimals: number = 9): string {
  return price.toFixed(decimals);
}

function formatPremium(premium: number): string {
  const sign = premium >= 0 ? '+' : '';
  return `${sign}${premium.toFixed(2)}%`;
}

async function getQuoteAndBuildSwap(
  cpAmm: CpAmm,
  connection: Connection,
  poolAddress: PublicKey,
  payer: PublicKey,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amountIn: BN,
  slippageBps: number,
  baseDecimals: number,
  quoteDecimals: number
): Promise<{ tx: Transaction; expectedOut: BN }> {
  const poolState = await cpAmm.fetchPoolState(poolAddress);
  const currentSlot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(currentSlot);

  if (!blockTime) {
    throw new Error('Failed to get block time');
  }

  const quote = cpAmm.getQuote({
    inAmount: amountIn,
    inputTokenMint: inputMint,
    slippage: slippageBps / 10000,
    poolState,
    currentTime: blockTime,
    currentSlot,
    tokenADecimal: baseDecimals,
    tokenBDecimal: quoteDecimals,
  });

  const swapParams: SwapParams = {
    payer,
    pool: poolAddress,
    inputTokenMint: inputMint,
    outputTokenMint: outputMint,
    amountIn,
    minimumAmountOut: quote.minSwapOutAmount,
    tokenAVault: poolState.tokenAVault,
    tokenBVault: poolState.tokenBVault,
    tokenAMint: poolState.tokenAMint,
    tokenBMint: poolState.tokenBMint,
    tokenAProgram: TOKEN_PROGRAM_ID,
    tokenBProgram: TOKEN_PROGRAM_ID,
    referralTokenAccount: null,
  };

  const tx = await cpAmm.swap(swapParams);
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;

  return { tx, expectedOut: quote.swapOutAmount };
}

/**
 * Calculate optimal trade size that converges winner price toward spot
 */
async function calculateOptimalTradeSize(
  cpAmm: CpAmm,
  connection: Connection,
  proposal: ProposalData,
  winnerIdx: number,
  spotPrice: Decimal,
  winnerPrice: Decimal,
  isPremium: boolean,
  maxTradeLamports: BN
): Promise<{ optimalAmount: BN; expectedProfitLamports: BN }> {
  const winnerAmm = proposal.ammData[winnerIdx];
  if (!winnerAmm.pool) {
    throw new Error('Winner AMM has no pool');
  }

  const spotPool = new PublicKey(proposal.spotPoolAddress!);
  const winnerPool = new PublicKey(winnerAmm.pool);
  const baseMint = new PublicKey(proposal.baseMint);
  const quoteMint = new PublicKey(proposal.quoteMint);
  const winnerBaseMint = new PublicKey(winnerAmm.baseMint);
  const winnerQuoteMint = new PublicKey(winnerAmm.quoteMint);

  const currentSlot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(currentSlot);
  if (!blockTime) throw new Error('Failed to get block time');

  const spotPoolState = await cpAmm.fetchPoolState(spotPool);
  const winnerPoolState = await cpAmm.fetchPoolState(winnerPool);

  let optimalAmount = new BN(1_000_000);
  let bestProfit = new BN(0);

  // Try different trade sizes
  const incrementLamports = new BN(0.5 * 1e9);  // 0.5 SOL increments
  let currentSize = incrementLamports;

  console.log('\n  Calculating optimal trade size...');

  while (currentSize.lte(maxTradeLamports)) {
    try {
      let profit: BN;

      if (isPremium) {
        // PREMIUM: Buy TOKEN on spot → Split → Sell winner cond_TOKEN
        // Step 1: Buy TOKEN with SOL on spot
        const spotQuote = cpAmm.getQuote({
          inAmount: currentSize,
          inputTokenMint: quoteMint,
          slippage: MAX_SLIPPAGE_BPS / 10000,
          poolState: spotPoolState,
          currentTime: blockTime,
          currentSlot,
          tokenADecimal: proposal.baseDecimals,
          tokenBDecimal: proposal.quoteDecimals,
        });
        const tokensReceived = spotQuote.swapOutAmount;

        // Step 2: Split TOKEN → cond_TOKEN (1:1)
        // Step 3: Sell winner cond_TOKEN for cond_SOL
        const sellQuote = cpAmm.getQuote({
          inAmount: tokensReceived,
          inputTokenMint: winnerBaseMint,
          slippage: MAX_SLIPPAGE_BPS / 10000,
          poolState: winnerPoolState,
          currentTime: blockTime,
          currentSlot,
          tokenADecimal: winnerAmm.baseDecimals,
          tokenBDecimal: winnerAmm.quoteDecimals,
        });

        // Profit = cond_SOL received - SOL spent (redeemable after finalization)
        profit = sellQuote.swapOutAmount.sub(currentSize);

      } else {
        // DISCOUNT: Sell TOKEN on spot → Split SOL → Buy winner cond_TOKEN
        // For this we need to start with TOKEN, so let's think in terms of TOKEN amount
        // Actually, let's simulate: if we had X tokens worth of SOL...

        // Step 1: Figure out how much TOKEN we could sell for currentSize SOL worth
        // This is tricky because we need TOKEN first. Let's assume we have TOKEN.
        // Sell TOKEN → SOL on spot
        const solEquivalentInTokens = currentSize.mul(new BN(1e9)).div(new BN(spotPrice.mul(1e9).toFixed(0)));

        const sellSpotQuote = cpAmm.getQuote({
          inAmount: solEquivalentInTokens,
          inputTokenMint: baseMint,
          slippage: MAX_SLIPPAGE_BPS / 10000,
          poolState: spotPoolState,
          currentTime: blockTime,
          currentSlot,
          tokenADecimal: proposal.baseDecimals,
          tokenBDecimal: proposal.quoteDecimals,
        });
        const solReceived = sellSpotQuote.swapOutAmount;

        // Step 2: Split SOL → cond_SOL (1:1)
        // Step 3: Buy winner cond_TOKEN with cond_SOL
        const buyQuote = cpAmm.getQuote({
          inAmount: solReceived,
          inputTokenMint: winnerQuoteMint,
          slippage: MAX_SLIPPAGE_BPS / 10000,
          poolState: winnerPoolState,
          currentTime: blockTime,
          currentSlot,
          tokenADecimal: winnerAmm.baseDecimals,
          tokenBDecimal: winnerAmm.quoteDecimals,
        });

        // Profit in TOKEN terms = cond_TOKEN received - TOKEN sold
        // Convert to SOL terms for comparison
        const tokenProfit = buyQuote.swapOutAmount.sub(solEquivalentInTokens);
        profit = tokenProfit.mul(new BN(spotPrice.mul(1e9).toFixed(0))).div(new BN(1e9));
      }

      if (profit.gt(bestProfit)) {
        bestProfit = profit;
        optimalAmount = currentSize;
      }

      const solIn = new Decimal(currentSize.toString()).div(1e9).toFixed(2);
      const profitSol = new Decimal(profit.toString()).div(1e9).toFixed(6);
      console.log(`    ${solIn} SOL → profit: ${profitSol} SOL`);

    } catch {
      // Skip failed simulations
    }

    currentSize = currentSize.add(incrementLamports);
  }

  return { optimalAmount, expectedProfitLamports: bestProfit };
}

/**
 * Execute PREMIUM arbitrage: winner is priced above spot
 * 1. Buy TOKEN with SOL on spot
 * 2. Split TOKEN → cond_TOKEN (base vault deposit)
 * 3. Sell winner cond_TOKEN → cond_SOL
 * Result: cond_SOL > SOL spent (redeemable after finalization)
 */
async function executePremiumArbitrage(
  connection: Connection,
  cpAmm: CpAmm,
  vaultClient: VaultClient,
  signer: Keypair,
  proposal: ProposalData,
  winnerIdx: number,
  tradeAmountLamports: BN
): Promise<ExecutionResult> {
  const signatures: string[] = [];
  const vaultPDA = new PublicKey(proposal.vaultPDA);
  const spotPoolAddress = new PublicKey(proposal.spotPoolAddress!);
  const baseMint = new PublicKey(proposal.baseMint);
  const quoteMint = new PublicKey(proposal.quoteMint);
  const winnerAmm = proposal.ammData[winnerIdx];
  const winnerPool = new PublicKey(winnerAmm.pool!);
  const winnerBaseMint = new PublicKey(winnerAmm.baseMint);
  const winnerQuoteMint = new PublicKey(winnerAmm.quoteMint);

  try {
    // Step 1: Buy TOKEN with SOL on spot pool
    console.log('\n  Step 1: Buying TOKEN with SOL on spot pool...');
    const { tx: buyTx, expectedOut: tokensOut } = await getQuoteAndBuildSwap(
      cpAmm, connection, spotPoolAddress, signer.publicKey,
      quoteMint, baseMint, tradeAmountLamports, MAX_SLIPPAGE_BPS,
      proposal.baseDecimals, proposal.quoteDecimals
    );

    buyTx.sign(signer);
    const sig1 = await sendAndConfirmTransaction(connection, buyTx, [signer], { commitment: 'confirmed' });
    signatures.push(sig1);
    console.log(`    Tx: ${sig1}`);
    console.log(`    Spent ${new Decimal(tradeAmountLamports.toString()).div(1e9).toFixed(4)} SOL`);
    console.log(`    Received ${tokensOut.toString()} TOKEN`);

    // Step 2: Split TOKEN → cond_TOKEN via base vault
    console.log('\n  Step 2: Splitting TOKEN into conditional tokens (base vault deposit)...');
    const depositBuilder = await vaultClient.deposit(
      signer.publicKey, vaultPDA, VaultType.Base, tokensOut
    );
    const sig2 = await depositBuilder.rpc();
    signatures.push(sig2);
    console.log(`    Tx: ${sig2}`);
    console.log(`    Split ${tokensOut.toString()} TOKEN → cond_TOKEN for each market`);

    // Step 3: Sell winner cond_TOKEN → cond_SOL
    console.log(`\n  Step 3: Selling winner cond_TOKEN for cond_SOL (market ${winnerIdx})...`);
    const { tx: sellTx, expectedOut: condSolOut } = await getQuoteAndBuildSwap(
      cpAmm, connection, winnerPool, signer.publicKey,
      winnerBaseMint, winnerQuoteMint, tokensOut, MAX_SLIPPAGE_BPS,
      winnerAmm.baseDecimals, winnerAmm.quoteDecimals
    );

    sellTx.sign(signer);
    const sig3 = await sendAndConfirmTransaction(connection, sellTx, [signer], { commitment: 'confirmed' });
    signatures.push(sig3);
    console.log(`    Tx: ${sig3}`);
    console.log(`    Received ${condSolOut.toString()} cond_SOL_${winnerIdx}`);

    // Summary
    const profitLamports = condSolOut.sub(tradeAmountLamports);
    const profitSol = new Decimal(profitLamports.toString()).div(1e9);
    const profitPercent = profitSol.div(new Decimal(tradeAmountLamports.toString()).div(1e9)).mul(100);

    console.log('\n  Summary:');
    console.log(`    SOL spent: ${new Decimal(tradeAmountLamports.toString()).div(1e9).toFixed(6)}`);
    console.log(`    cond_SOL received: ${new Decimal(condSolOut.toString()).div(1e9).toFixed(6)}`);
    console.log(`    Profit (after redemption): ${profitSol.toFixed(6)} SOL (${profitPercent.toFixed(2)}%)`);
    console.log(`    Note: cond_SOL redeemable for real SOL after finalization`);

    return { success: true, signatures };
  } catch (error) {
    return { success: false, signatures, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Execute DISCOUNT arbitrage: winner is priced below spot
 * 1. Sell TOKEN for SOL on spot
 * 2. Split SOL → cond_SOL (quote vault deposit)
 * 3. Buy winner cond_TOKEN with cond_SOL
 * Result: cond_TOKEN > TOKEN sold (redeemable after finalization)
 */
async function executeDiscountArbitrage(
  connection: Connection,
  cpAmm: CpAmm,
  vaultClient: VaultClient,
  signer: Keypair,
  proposal: ProposalData,
  winnerIdx: number,
  tokenAmount: BN
): Promise<ExecutionResult> {
  const signatures: string[] = [];
  const vaultPDA = new PublicKey(proposal.vaultPDA);
  const spotPoolAddress = new PublicKey(proposal.spotPoolAddress!);
  const baseMint = new PublicKey(proposal.baseMint);
  const quoteMint = new PublicKey(proposal.quoteMint);
  const winnerAmm = proposal.ammData[winnerIdx];
  const winnerPool = new PublicKey(winnerAmm.pool!);
  const winnerBaseMint = new PublicKey(winnerAmm.baseMint);
  const winnerQuoteMint = new PublicKey(winnerAmm.quoteMint);

  try {
    // Step 1: Sell TOKEN for SOL on spot pool
    console.log('\n  Step 1: Selling TOKEN for SOL on spot pool...');
    const { tx: sellTx, expectedOut: solOut } = await getQuoteAndBuildSwap(
      cpAmm, connection, spotPoolAddress, signer.publicKey,
      baseMint, quoteMint, tokenAmount, MAX_SLIPPAGE_BPS,
      proposal.baseDecimals, proposal.quoteDecimals
    );

    sellTx.sign(signer);
    const sig1 = await sendAndConfirmTransaction(connection, sellTx, [signer], { commitment: 'confirmed' });
    signatures.push(sig1);
    console.log(`    Tx: ${sig1}`);
    console.log(`    Sold ${tokenAmount.toString()} TOKEN`);
    console.log(`    Received ${new Decimal(solOut.toString()).div(1e9).toFixed(6)} SOL`);

    // Step 2: Split SOL → cond_SOL via quote vault
    console.log('\n  Step 2: Splitting SOL into conditional SOL (quote vault deposit)...');
    const depositBuilder = await vaultClient.deposit(
      signer.publicKey, vaultPDA, VaultType.Quote, solOut
    );
    const sig2 = await depositBuilder.rpc();
    signatures.push(sig2);
    console.log(`    Tx: ${sig2}`);
    console.log(`    Split ${solOut.toString()} SOL → cond_SOL for each market`);

    // Step 3: Buy winner cond_TOKEN with cond_SOL
    console.log(`\n  Step 3: Buying winner cond_TOKEN with cond_SOL (market ${winnerIdx})...`);
    const { tx: buyTx, expectedOut: condTokenOut } = await getQuoteAndBuildSwap(
      cpAmm, connection, winnerPool, signer.publicKey,
      winnerQuoteMint, winnerBaseMint, solOut, MAX_SLIPPAGE_BPS,
      winnerAmm.baseDecimals, winnerAmm.quoteDecimals
    );

    buyTx.sign(signer);
    const sig3 = await sendAndConfirmTransaction(connection, buyTx, [signer], { commitment: 'confirmed' });
    signatures.push(sig3);
    console.log(`    Tx: ${sig3}`);
    console.log(`    Received ${condTokenOut.toString()} cond_TOKEN_${winnerIdx}`);

    // Summary
    const tokenProfit = condTokenOut.sub(tokenAmount);
    const profitPercent = new Decimal(tokenProfit.toString()).div(new Decimal(tokenAmount.toString())).mul(100);

    console.log('\n  Summary:');
    console.log(`    TOKEN sold: ${tokenAmount.toString()}`);
    console.log(`    cond_TOKEN received: ${condTokenOut.toString()}`);
    console.log(`    Profit (after redemption): ${tokenProfit.toString()} TOKEN (${profitPercent.toFixed(2)}%)`);
    console.log(`    Note: cond_TOKEN redeemable for real TOKEN after finalization`);

    return { success: true, signatures };
  } catch (error) {
    return { success: false, signatures, error: error instanceof Error ? error.message : String(error) };
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('=== Winner Convergence Arbitrage ===\n');
  console.log(`Proposal: ${MODERATOR_ID}/${PROPOSAL_ID}`);
  console.log(`Min Multiplier Threshold: ${MIN_MULTIPLIER}x`);
  console.log(`Min Premium/Discount: ${MIN_PREMIUM_BPS} bps (${MIN_PREMIUM_BPS / 100}%)`);
  console.log(`Max Trade Cap: ${MAX_TRADE_SOL} SOL`);
  console.log(`Dry Run: ${DRY_RUN}\n`);

  // Load wallet
  const walletKeyPath = process.env.ARB_WALLET_KEY || process.env.SOLANA_KEYPAIR_PATH;
  if (!walletKeyPath) {
    console.error('Wallet keypair not set. Set ARB_WALLET_KEY or SOLANA_KEYPAIR_PATH env var.');
    process.exit(1);
  }
  const wallet_keypair = ExecutionService.loadKeypair(walletKeyPath);
  console.log(`Wallet: ${wallet_keypair.publicKey.toBase58()}`);

  // Initialize connection
  const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  const cpAmm = new CpAmm(connection);

  // Initialize vault client
  const wallet = new Wallet(wallet_keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const vaultClient = new VaultClient(provider);

  // Fetch proposal data
  console.log('\nFetching proposal data...');
  let proposal: ProposalData;
  try {
    proposal = await fetchProposalData(MODERATOR_ID, PROPOSAL_ID);
  } catch (error) {
    console.error('Failed to fetch proposal data:', error);
    process.exit(1);
  }

  console.log(`Title: ${proposal.title}`);
  console.log(`Status: ${proposal.status}`);
  console.log(`Markets: ${proposal.markets}`);

  if (proposal.status !== 'Pending') {
    console.log(`\nProposal is not in trading state (status: ${proposal.status}). Exiting.`);
    process.exit(0);
  }

  if (!proposal.spotPoolAddress) {
    console.error('\nNo spot pool address found. Exiting.');
    process.exit(1);
  }

  // Fetch TWAP and calculate break-even multiplier
  console.log('\n--- Checking Winner Guarantee ---');
  const twapEntry = await fetchLatestTWAP(MODERATOR_ID, PROPOSAL_ID);
  if (!twapEntry) {
    console.error('Failed to fetch TWAP data. Exiting.');
    process.exit(1);
  }

  const { multiplier, leaderIdx, challengerIdx, remainingHours } = calculateBreakEvenMultiplier(twapEntry, proposal.finalizedAt);
  const leaderLabel = proposal.marketLabels?.[leaderIdx] || `Market ${leaderIdx}`;
  const challengerLabel = proposal.marketLabels?.[challengerIdx] || `Market ${challengerIdx}`;

  console.log(`Time Remaining: ${remainingHours.toFixed(2)} hours`);
  console.log(`Current Leader: ${leaderLabel} (index ${leaderIdx})`);
  console.log(`Closest Challenger: ${challengerLabel} (index ${challengerIdx})`);
  console.log(`Break-Even Multiplier: ${multiplier.toFixed(4)}x`);

  if (multiplier < MIN_MULTIPLIER) {
    console.log(`\nMultiplier ${multiplier.toFixed(4)}x < ${MIN_MULTIPLIER}x threshold.`);
    console.log('Winner not guaranteed enough. Exiting.');
    process.exit(0);
  }

  console.log(`\nMultiplier ${multiplier.toFixed(4)}x >= ${MIN_MULTIPLIER}x - Winner is effectively guaranteed!`);

  // Fetch prices
  console.log('\n--- Fetching Prices ---');
  const spotPrice = await fetchPoolPrice(cpAmm, proposal.spotPoolAddress, proposal.baseDecimals, proposal.quoteDecimals);
  console.log(`Spot Price: ${formatPrice(spotPrice)} SOL per TOKEN`);

  const winnerAmm = proposal.ammData[leaderIdx];
  if (!winnerAmm.pool || winnerAmm.state !== 'Trading') {
    console.error(`Winner market ${leaderIdx} is not trading. Exiting.`);
    process.exit(1);
  }

  const winnerPrice = await fetchPoolPrice(cpAmm, winnerAmm.pool, winnerAmm.baseDecimals, winnerAmm.quoteDecimals);
  const premiumBps = winnerPrice.minus(spotPrice).div(spotPrice).mul(10000).toNumber();
  const isPremium = premiumBps > 0;

  console.log(`Winner Price: ${formatPrice(winnerPrice)} SOL per TOKEN (${formatPremium(premiumBps / 100)} vs spot)`);

  if (Math.abs(premiumBps) < MIN_PREMIUM_BPS) {
    console.log(`\nPremium/discount ${Math.abs(premiumBps)} bps < ${MIN_PREMIUM_BPS} bps threshold.`);
    console.log('Prices already converged. No arb opportunity. Exiting.');
    process.exit(0);
  }

  // Determine trade direction
  console.log('\n--- Arbitrage Opportunity ---');
  if (isPremium) {
    console.log('Direction: PREMIUM (winner above spot)');
    console.log('Strategy: Buy TOKEN on spot → Split → Sell winner cond_TOKEN');
  } else {
    console.log('Direction: DISCOUNT (winner below spot)');
    console.log('Strategy: Sell TOKEN on spot → Split SOL → Buy winner cond_TOKEN');
  }

  // Calculate optimal trade size
  const walletBalance = await connection.getBalance(wallet_keypair.publicKey);
  const maxWalletUsage = new BN(walletBalance).mul(new BN(95)).div(new BN(100));
  const maxTradeLamports = BN.min(maxWalletUsage, new BN(MAX_TRADE_SOL * 1e9));

  console.log(`\nWallet Balance: ${new Decimal(walletBalance.toString()).div(1e9).toFixed(4)} SOL`);
  console.log(`Max Trade: ${new Decimal(maxTradeLamports.toString()).div(1e9).toFixed(4)} SOL`);

  const { optimalAmount, expectedProfitLamports } = await calculateOptimalTradeSize(
    cpAmm, connection, proposal, leaderIdx, spotPrice, winnerPrice, isPremium, maxTradeLamports
  );

  const optimalSol = new Decimal(optimalAmount.toString()).div(1e9);
  const expectedProfitSol = new Decimal(expectedProfitLamports.toString()).div(1e9);
  const profitPercent = expectedProfitSol.div(optimalSol).mul(100);

  console.log(`\nOptimal Trade Size: ${optimalSol.toFixed(4)} SOL`);
  console.log(`Expected Profit: ${expectedProfitSol.toFixed(6)} SOL (${profitPercent.toFixed(2)}%)`);

  if (expectedProfitLamports.lte(new BN(0))) {
    console.log('\nNo profitable trade found. Exiting.');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN - Not executing trades');
    console.log('Set DRY_RUN = false to execute.');
    process.exit(0);
  }

  // Execute arbitrage
  console.log('\n--- Executing Trade ---');
  let result: ExecutionResult;

  if (isPremium) {
    result = await executePremiumArbitrage(
      connection, cpAmm, vaultClient, wallet_keypair, proposal, leaderIdx, optimalAmount
    );
  } else {
    // For discount, we need TOKEN. Convert SOL amount to TOKEN amount
    const tokenAmount = optimalAmount.mul(new BN(1e9)).div(new BN(spotPrice.mul(1e9).toFixed(0)));
    result = await executeDiscountArbitrage(
      connection, cpAmm, vaultClient, wallet_keypair, proposal, leaderIdx, tokenAmount
    );
  }

  // Report results
  console.log('\n--- Results ---');
  if (result.success) {
    console.log('SUCCESS! Arbitrage executed.');
    console.log(`Transactions: ${result.signatures.length}`);
    result.signatures.forEach((sig, i) => {
      console.log(`  ${i + 1}. https://solscan.io/tx/${sig}`);
    });
  } else {
    console.log('FAILED!');
    console.log(`Error: ${result.error}`);
  }

  console.log('\nDone!');
}

main().catch(console.error);
