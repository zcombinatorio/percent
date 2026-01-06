#!/usr/bin/env ts-node
/**
 * Conditional vs Spot Arbitrage Script
 *
 * ============================================================================
 * HOW CONDITIONAL MARKETS WORK
 * ============================================================================
 *
 * This protocol has TWO types of tokens and TWO types of pools:
 *
 * REAL TOKENS (trade on spot pool):
 *   - real SOL: Native SOL
 *   - real TOKEN: The base token (e.g., SURF)
 *   - Spot pool: real TOKEN / real SOL
 *
 * CONDITIONAL TOKENS (trade on conditional pools):
 *   - cond_SOL₀, cond_SOL₁, ..., cond_SOLₙ: Conditional SOL for each outcome
 *   - cond_TOKEN₀, cond_TOKEN₁, ..., cond_TOKENₙ: Conditional base tokens
 *   - Conditional pool i: cond_TOKENᵢ / cond_SOLᵢ
 *
 * THE VAULT (split/merge operations):
 *   - Base vault split:  1 real TOKEN → 1 cond_TOKEN₀ + 1 cond_TOKEN₁ + ... + 1 cond_TOKENₙ
 *   - Quote vault split: 1 real SOL   → 1 cond_SOL₀   + 1 cond_SOL₁   + ... + 1 cond_SOLₙ
 *   - Merge (either):    1 of EACH conditional → 1 real token
 *
 * KEY INSIGHT: You can only merge MIN(cond₀, cond₁, ..., condₙ) real tokens
 * because you need equal amounts of each conditional to merge.
 *
 * ============================================================================
 * ARBITRAGE OPPORTUNITIES
 * ============================================================================
 *
 * ABOVE (all conditionals priced above spot):
 *   1. Buy real TOKEN with real SOL (spot pool)
 *   2. Split real TOKEN → cond_TOKEN in each market (base vault)
 *   3. Sell cond_TOKEN for cond_SOL in each conditional pool
 *   4. Merge cond_SOL → real SOL (quote vault)
 *   Profit if: MIN(cond_SOL received) > real SOL spent
 *
 * BELOW (all conditionals priced below spot):
 *   1. Split real SOL → cond_SOL in each market (quote vault)
 *   2. Buy cond_TOKEN with cond_SOL in each conditional pool
 *   3. Merge cond_TOKEN → real TOKEN (base vault)
 *   4. Sell real TOKEN for real SOL (spot pool)
 *   Profit if: real SOL received > real SOL spent
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
const MIN_PROFIT_BPS = 0;      // 0% minimum profit threshold
const MAX_SLIPPAGE_BPS = 500;    // 5% max slippage
const DRY_RUN = false;            // Simulate only by default
const MAX_TRADE_SOL = 10;        // Maximum SOL to use (safety cap)

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
    position?: string;
    positionNft?: string;
  }>;
  vaultPDA: string;
  createdAt: number;    // Unix timestamp
  finalizedAt: number;  // Unix timestamp (when voting ends)
}

interface TWAPData {
  twaps: number[];        // Current TWAP values (as decimals, e.g., 0.45 = 45%)
  aggregations: number[]; // Cumulative aggregation values
  timestamp: string;
}

type OpportunityType = 'ABOVE' | 'BELOW' | 'NONE';

interface ArbitrageOpportunity {
  type: OpportunityType;
  spotPrice: Decimal;
  conditionalPrices: Decimal[];
  premiums: number[];  // % difference from spot for each conditional
  minPremium: number;
  maxPremium: number;
  estimatedProfitBps: number;
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
  console.log(`Fetching proposal data from: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch proposal: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<ProposalData>;
}

interface TWAPResponse {
  data: Array<{
    twaps: string[];
    aggregations: string[];
    timestamp: string;
  }>;
}

async function fetchTWAPData(moderatorId: number, proposalId: number): Promise<TWAPData | null> {
  const url = `${API_BASE_URL}/api/history/${proposalId}/twap?moderatorId=${moderatorId}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const data = await response.json() as TWAPResponse;
    if (data.data && data.data.length > 0) {
      const latest = data.data[0];
      return {
        twaps: (latest.twaps || []).map((t: string) => parseFloat(t)),
        aggregations: (latest.aggregations || []).map((a: string) => parseFloat(a)),
        timestamp: latest.timestamp
      };
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

function detectOpportunity(
  spotPrice: Decimal,
  conditionalPrices: Decimal[],
  feeBps: number = 50  // 0.5% per swap
): ArbitrageOpportunity {
  // Calculate premium/discount for each conditional vs spot
  const premiums = conditionalPrices.map(price => {
    return price.minus(spotPrice).div(spotPrice).mul(100).toNumber();
  });

  const allAbove = premiums.every(p => p > 0);
  const allBelow = premiums.every(p => p < 0);

  let type: OpportunityType = 'NONE';
  if (allAbove) type = 'ABOVE';
  else if (allBelow) type = 'BELOW';

  const minPremium = Math.min(...premiums);
  const maxPremium = Math.max(...premiums);

  // Estimate profit after fees
  let estimatedProfitBps = 0;
  if (type === 'ABOVE') {
    const numSwaps = conditionalPrices.length + 1;
    const totalFeeBps = feeBps * numSwaps;
    estimatedProfitBps = Math.round(minPremium * 100) - totalFeeBps;
  } else if (type === 'BELOW') {
    const numSwaps = conditionalPrices.length + 1;
    const totalFeeBps = feeBps * numSwaps;
    estimatedProfitBps = Math.round(Math.abs(maxPremium) * 100) - totalFeeBps;
  }

  return {
    type,
    spotPrice,
    conditionalPrices,
    premiums,
    minPremium,
    maxPremium,
    estimatedProfitBps
  };
}

function formatPrice(price: Decimal, decimals: number = 9): string {
  return price.toFixed(decimals);
}

function formatPremium(premium: number): string {
  const sign = premium >= 0 ? '+' : '';
  return `${sign}${premium.toFixed(2)}%`;
}

/**
 * Calculate expected final TWAP using the same formula as the UI (ModeToggle.tsx).
 *
 * Formula: expectedFinal = currentTwap × elapsed% + spotPrice × remaining%
 *
 * This calculates what the TWAP will be at the END of the voting period,
 * assuming the current spot price is maintained for the remaining time.
 *
 * @param currentTwap - The current TWAP value (in SOL)
 * @param spotPrice - The current spot price (in SOL)
 * @param timeElapsedPercent - How much of the voting period has elapsed (0.0 to 1.0)
 */
function calculateExpectedFinalTWAP(
  currentTwap: number,
  spotPrice: Decimal,
  timeElapsedPercent: number
): number {
  const remainingPercent = 1 - timeElapsedPercent;
  return currentTwap * timeElapsedPercent + spotPrice.toNumber() * remainingPercent;
}

/**
 * Calculate optimal trade size for arbitrage.
 * Uses binary search to find the largest trade where post-trade prices
 * still maintain the arbitrage (all above or all below spot).
 *
 * ============================================================================
 * CONDITIONAL MARKET TOKEN MODEL
 * ============================================================================
 *
 * Each conditional pool trades CONDITIONAL tokens, not real tokens:
 *   - Conditional pools: cond_TOKEN / cond_SOL (both are conditional!)
 *   - Spot pool: real TOKEN / real SOL
 *
 * The vault provides split/merge operations:
 *   - Base vault split:  1 real TOKEN → 1 cond_TOKEN₀ + 1 cond_TOKEN₁ + ... + 1 cond_TOKENₙ
 *   - Quote vault split: 1 real SOL   → 1 cond_SOL₀   + 1 cond_SOL₁   + ... + 1 cond_SOLₙ
 *   - Merge (either vault): Need 1 of EACH conditional to get 1 real token back
 *
 * Key insight: You can only withdraw MIN(cond₀, cond₁, ..., condₙ) real tokens
 * because you need equal amounts of each conditional to merge.
 *
 * ============================================================================
 * ABOVE ARBITRAGE (all conditionals priced above spot)
 * ============================================================================
 *
 * Flow:
 *   1. Buy spot tokens with real SOL (spot pool)
 *   2. Split spot tokens via base vault → get cond_TOKEN in each market
 *   3. Sell cond_TOKEN for cond_SOL in each conditional pool
 *   4. Merge cond_SOL via quote vault → get real SOL back
 *
 * Profit = MIN(cond_SOL received across all markets) - real SOL spent
 *
 * The MIN is critical: if you receive 10, 12, 11, 10.5 cond_SOL from 4 markets,
 * you can only merge 10 real SOL (the minimum).
 *
 * ============================================================================
 * BELOW ARBITRAGE (all conditionals priced below spot)
 * ============================================================================
 *
 * Flow:
 *   1. Split real SOL via quote vault → get cond_SOL in each market
 *   2. Buy cond_TOKEN with cond_SOL in each conditional pool
 *   3. Merge cond_TOKEN via base vault → get real spot tokens back
 *   4. Sell spot tokens for real SOL (spot pool)
 *
 * Profit = real SOL from selling spot - initial real SOL spent
 *
 * Again, you can only merge MIN(cond_TOKEN) across all markets.
 */
async function calculateOptimalTradeSize(
  cpAmm: CpAmm,
  connection: Connection,
  proposal: ProposalData,
  _spotPrice: Decimal,  // Used for reference, actual profit calculated from quotes
  opportunityType: 'ABOVE' | 'BELOW',
  maxTradeLamports: BN
): Promise<{ optimalAmount: BN; expectedProfitLamports: BN }> {
  const quoteMint = new PublicKey(proposal.quoteMint);
  const baseMint = new PublicKey(proposal.baseMint);

  // Search for optimal trade size by sampling across the range
  // We can't use simple binary search because profit isn't monotonic with size:
  // - Small trades: high ROI but low absolute profit
  // - Medium trades: sweet spot with best absolute profit
  // - Large trades: slippage eats into profits, eventually goes negative
  let optimalAmount = new BN(1_000_000);
  let bestProfit = new BN(0);

  // Get current slot/blocktime once
  const currentSlot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(currentSlot);
  if (!blockTime) throw new Error('Failed to get block time');

  // Pre-fetch spot pool state (used in both directions)
  const spotPool = new PublicKey(proposal.spotPoolAddress!);
  const spotPoolState = await cpAmm.fetchPoolState(spotPool);

  // Generate trade sizes: 0.5, 1.0, 1.5, 2.0, ... up to maxTradeLamports (in 0.5 SOL increments)
  const tradeSizesToTry: BN[] = [];
  const incrementLamports = new BN(0.5 * 1e9);  // 0.5 SOL
  let currentSize = incrementLamports;
  while (currentSize.lte(maxTradeLamports)) {
    tradeSizesToTry.push(currentSize);
    currentSize = currentSize.add(incrementLamports);
  }

  for (const mid of tradeSizesToTry) {
    try {
      let totalOut = new BN(0);
      const totalIn = mid;

      if (opportunityType === 'ABOVE') {
        // ================================================================
        // ABOVE: Buy spot → split → sell conditionals → merge cond_SOL
        // ================================================================

        // Step 1: Buy spot tokens with real SOL
        const spotQuote = cpAmm.getQuote({
          inAmount: mid,
          inputTokenMint: quoteMint,
          slippage: MAX_SLIPPAGE_BPS / 10000,
          poolState: spotPoolState,
          currentTime: blockTime,
          currentSlot,
          tokenADecimal: proposal.baseDecimals,
          tokenBDecimal: proposal.quoteDecimals,
        });
        const spotTokensReceived = spotQuote.swapOutAmount;

        // Step 2: Split spot tokens (1:1 ratio - get spotTokensReceived of EACH conditional)
        // Step 3: Sell each conditional for conditional SOL
        // Track MINIMUM cond_SOL received - that's what we can merge back to real SOL
        let minConditionalSolReceived = new BN(Number.MAX_SAFE_INTEGER);

        for (const amm of proposal.ammData) {
          if (!amm.pool || amm.state !== 'Trading') continue;

          const poolAddress = new PublicKey(amm.pool);
          const conditionalBaseMint = new PublicKey(amm.baseMint);
          const poolState = await cpAmm.fetchPoolState(poolAddress);

          // Sell cond_TOKEN for cond_SOL
          const quote = cpAmm.getQuote({
            inAmount: spotTokensReceived,  // We have this many of each conditional
            inputTokenMint: conditionalBaseMint,
            slippage: MAX_SLIPPAGE_BPS / 10000,
            poolState,
            currentTime: blockTime,
            currentSlot,
            tokenADecimal: amm.baseDecimals,
            tokenBDecimal: amm.quoteDecimals,
          });

          // Track minimum - this is our merge bottleneck
          if (quote.swapOutAmount.lt(minConditionalSolReceived)) {
            minConditionalSolReceived = quote.swapOutAmount;
          }
        }

        // Step 4: Merge cond_SOL to real SOL - limited by minimum received
        totalOut = minConditionalSolReceived;

      } else {
        // ================================================================
        // BELOW: Split real SOL → buy conditionals → merge → sell spot
        // ================================================================

        // Step 1: Split real SOL into conditional SOL (1:1 ratio)
        // We get 'mid' amount of cond_SOL in EACH market
        const conditionalSolPerMarket = mid;

        // Step 2: Buy conditional tokens with conditional SOL in each market
        // Track MINIMUM cond_TOKEN received - that's what we can merge
        let minConditionalTokensReceived = new BN(Number.MAX_SAFE_INTEGER);

        for (const amm of proposal.ammData) {
          if (!amm.pool || amm.state !== 'Trading') continue;

          const poolAddress = new PublicKey(amm.pool);
          const conditionalQuoteMint = new PublicKey(amm.quoteMint);
          const poolState = await cpAmm.fetchPoolState(poolAddress);

          // Buy cond_TOKEN with cond_SOL
          const quote = cpAmm.getQuote({
            inAmount: conditionalSolPerMarket,
            inputTokenMint: conditionalQuoteMint,  // cond_SOL
            slippage: MAX_SLIPPAGE_BPS / 10000,
            poolState,
            currentTime: blockTime,
            currentSlot,
            tokenADecimal: amm.baseDecimals,
            tokenBDecimal: amm.quoteDecimals,
          });

          // Track minimum - this is our merge bottleneck
          if (quote.swapOutAmount.lt(minConditionalTokensReceived)) {
            minConditionalTokensReceived = quote.swapOutAmount;
          }
        }

        // Step 3: Merge conditional tokens to spot tokens
        const spotTokensFromMerge = minConditionalTokensReceived;

        // Step 4: Sell spot tokens for real SOL
        const sellSpotQuote = cpAmm.getQuote({
          inAmount: spotTokensFromMerge,
          inputTokenMint: baseMint,
          slippage: MAX_SLIPPAGE_BPS / 10000,
          poolState: spotPoolState,
          currentTime: blockTime,
          currentSlot,
          tokenADecimal: proposal.baseDecimals,
          tokenBDecimal: proposal.quoteDecimals,
        });

        totalOut = sellSpotQuote.swapOutAmount;
      }

      const profit = totalOut.sub(totalIn);
      const roi = totalIn.gt(new BN(0))
        ? new Decimal(profit.toString()).div(new Decimal(totalIn.toString())).mul(100).toNumber()
        : 0;

      // Track the trade size with the best absolute profit
      if (profit.gt(bestProfit)) {
        bestProfit = profit;
        optimalAmount = mid;
      }

      // Log each sample for debugging
      const solIn = new Decimal(mid.toString()).div(1e9).toFixed(2);
      const profitSol = new Decimal(profit.toString()).div(1e9).toFixed(6);
      console.log(`  ${solIn} SOL → profit: ${profitSol} SOL (${roi.toFixed(2)}%)`);
    } catch {
      // If simulation fails at this size, skip it
      continue;
    }
  }

  return { optimalAmount, expectedProfitLamports: bestProfit };
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
 * Execute ABOVE arbitrage: conditionals are priced above spot.
 *
 * Flow:
 *   1. Buy spot tokens with real SOL (spot pool)
 *   2. Split spot tokens via base vault → get cond_TOKEN in each market
 *   3. Sell cond_TOKEN for cond_SOL in each conditional pool
 *   4. Merge cond_SOL via quote vault → get real SOL back
 *
 * Profit = real SOL withdrawn - real SOL spent
 *
 * Example (3 markets, conditionals at ~10% premium to spot):
 *   - Spot price: 0.08 SOL per TOKEN
 *   - Conditional price: ~0.088 cond_SOL per cond_TOKEN (10% above spot)
 *
 *   Step 1: Spend 8 real SOL → buy 100 SPOT tokens
 *   Step 2: Split 100 SPOT → 100 cond_SPOT₀ + 100 cond_SPOT₁ + 100 cond_SPOT₂
 *   Step 3: Sell each conditional for cond_SOL (at the premium price):
 *           - 100 cond_SPOT₀ × 0.088 → 8.8 cond_SOL₀
 *           - 100 cond_SPOT₁ × 0.086 → 8.6 cond_SOL₁
 *           - 100 cond_SPOT₂ × 0.090 → 9.0 cond_SOL₂
 *   Step 4: Merge MIN(8.8, 8.6, 9.0) = 8.6 of each → 8.6 real SOL
 *   Profit: 8.6 - 8.0 = 0.6 SOL (7.5%)
 *
 * The key: when conditionals trade at a premium to spot, selling gives you
 * more cond_SOL per token than you paid in real SOL per token.
 */
async function executeAboveArbitrage(
  connection: Connection,
  cpAmm: CpAmm,
  vaultClient: VaultClient,
  signer: Keypair,
  proposal: ProposalData,
  tradeAmountLamports: BN
): Promise<ExecutionResult> {
  const signatures: string[] = [];
  const vaultPDA = new PublicKey(proposal.vaultPDA);
  const spotPoolAddress = new PublicKey(proposal.spotPoolAddress!);
  const baseMint = new PublicKey(proposal.baseMint);
  const quoteMint = new PublicKey(proposal.quoteMint);

  try {
    // ========================================================================
    // Step 1: Buy spot tokens with real SOL (spot pool)
    // ========================================================================
    console.log('\n  Step 1: Buying spot tokens with real SOL...');
    const { tx: buySpotTx, expectedOut: spotTokensOut } = await getQuoteAndBuildSwap(
      cpAmm,
      connection,
      spotPoolAddress,
      signer.publicKey,
      quoteMint,  // real SOL
      baseMint,   // real SPOT token
      tradeAmountLamports,
      MAX_SLIPPAGE_BPS,
      proposal.baseDecimals,
      proposal.quoteDecimals
    );

    buySpotTx.sign(signer);
    const sig1 = await sendAndConfirmTransaction(connection, buySpotTx, [signer], {
      commitment: 'confirmed',
    });
    signatures.push(sig1);
    console.log(`    Tx: ${sig1}`);
    console.log(`    Spent ${new Decimal(tradeAmountLamports.toString()).div(1e9).toFixed(4)} real SOL`);
    console.log(`    Received ${spotTokensOut.toString()} spot tokens`);

    // ========================================================================
    // Step 2: Split spot tokens into conditionals via base vault
    // Result: spotTokensOut of EACH conditional token type
    // ========================================================================
    console.log('\n  Step 2: Splitting spot tokens into conditionals (base vault deposit)...');
    const depositBuilder = await vaultClient.deposit(
      signer.publicKey,
      vaultPDA,
      VaultType.Base,
      spotTokensOut
    );
    const sig2 = await depositBuilder.rpc();
    signatures.push(sig2);
    console.log(`    Tx: ${sig2}`);
    console.log(`    Split ${spotTokensOut.toString()} SPOT → ${spotTokensOut.toString()} of EACH conditional token`);

    // ========================================================================
    // Step 3: Sell each conditional token for conditional SOL
    // Each pool trades cond_TOKEN / cond_SOL
    // Track the minimum cond_SOL received (merge bottleneck)
    // ========================================================================
    console.log('\n  Step 3: Selling conditional tokens for conditional SOL...');
    const conditionalSolAmounts: BN[] = [];

    for (let i = 0; i < proposal.ammData.length; i++) {
      const amm = proposal.ammData[i];
      const label = proposal.marketLabels?.[i] || `Market ${i}`;

      if (!amm.pool || amm.state !== 'Trading') {
        console.log(`    ${label}: Skipping (not trading)`);
        conditionalSolAmounts.push(new BN(0));
        continue;
      }

      const conditionalBaseMint = new PublicKey(amm.baseMint);
      const conditionalQuoteMint = new PublicKey(amm.quoteMint);
      const poolAddress = new PublicKey(amm.pool);

      console.log(`    ${label}: Selling cond_TOKEN → cond_SOL...`);
      const { tx: sellCondTx, expectedOut } = await getQuoteAndBuildSwap(
        cpAmm,
        connection,
        poolAddress,
        signer.publicKey,
        conditionalBaseMint,   // cond_TOKEN (selling)
        conditionalQuoteMint,  // cond_SOL (receiving)
        spotTokensOut,         // Same amount we split (1:1 ratio)
        MAX_SLIPPAGE_BPS,
        amm.baseDecimals,
        amm.quoteDecimals
      );

      conditionalSolAmounts.push(expectedOut);

      sellCondTx.sign(signer);
      const sig = await sendAndConfirmTransaction(connection, sellCondTx, [signer], {
        commitment: 'confirmed',
      });
      signatures.push(sig);
      console.log(`      Tx: ${sig}`);
      console.log(`      Received ${expectedOut.toString()} cond_SOL_${i}`);
    }

    // ========================================================================
    // Step 4: Merge conditional SOL into real SOL via quote vault
    // Can only merge MIN across all markets
    // ========================================================================
    const minCondSol = conditionalSolAmounts
      .filter(amt => amt.gt(new BN(0)))
      .reduce((min, amt) => BN.min(min, amt), conditionalSolAmounts[0]);

    console.log('\n  Step 4: Merging conditional SOL into real SOL (quote vault withdraw)...');
    console.log(`    cond_SOL amounts: [${conditionalSolAmounts.map(a => a.toString()).join(', ')}]`);
    console.log(`    Merging MIN = ${minCondSol.toString()} of each → ${minCondSol.toString()} real SOL`);

    const withdrawBuilder = await vaultClient.withdraw(
      signer.publicKey,
      vaultPDA,
      VaultType.Quote,  // Quote vault for SOL
      minCondSol
    );
    const sig4 = await withdrawBuilder.rpc();
    signatures.push(sig4);
    console.log(`    Tx: ${sig4}`);

    // Calculate profit
    const profitLamports = minCondSol.sub(tradeAmountLamports);
    const profitSol = new Decimal(profitLamports.toString()).div(1e9);
    const profitPercent = profitSol.div(new Decimal(tradeAmountLamports.toString()).div(1e9)).mul(100);

    console.log('\n  Summary:');
    console.log(`    Spent: ${new Decimal(tradeAmountLamports.toString()).div(1e9).toFixed(6)} real SOL`);
    console.log(`    Received: ${new Decimal(minCondSol.toString()).div(1e9).toFixed(6)} real SOL`);
    console.log(`    Profit: ${profitSol.toFixed(6)} SOL (${profitPercent.toFixed(2)}%)`);

    return { success: true, signatures };
  } catch (error) {
    return {
      success: false,
      signatures,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Execute BELOW arbitrage: conditionals are priced below spot.
 *
 * Flow:
 *   1. Split real SOL via quote vault → get cond_SOL in each market
 *   2. Buy cond_TOKEN with cond_SOL in each conditional pool
 *   3. Merge cond_TOKEN via base vault → get real SPOT tokens back
 *   4. Sell real SPOT tokens for real SOL (spot pool)
 *
 * Profit = real SOL from selling spot - initial real SOL spent
 *
 * Example with 3 markets (conditionals trading at 10% discount):
 *   - Deposit 10 real SOL into quote vault
 *   - Get 10 cond_SOL₀ + 10 cond_SOL₁ + 10 cond_SOL₂
 *   - Buy with 10 cond_SOL₀ → 110 cond_TOKEN₀ (10% more tokens due to discount)
 *   - Buy with 10 cond_SOL₁ → 108 cond_TOKEN₁
 *   - Buy with 10 cond_SOL₂ → 112 cond_TOKEN₂
 *   - Merge MIN(110, 108, 112) = 108 of each → 108 real SPOT tokens
 *   - Sell 108 SPOT on spot pool → 10.8 real SOL (if spot price = 0.1 SOL/token)
 *   - Profit: 10.8 - 10 = 0.8 real SOL (8%)
 *
 * The key is: when conditionals trade at a DISCOUNT to spot, buying them
 * with cond_SOL yields more tokens than the equivalent real SOL would buy.
 */
async function executeBelowArbitrage(
  connection: Connection,
  cpAmm: CpAmm,
  vaultClient: VaultClient,
  signer: Keypair,
  proposal: ProposalData,
  tradeAmountLamports: BN
): Promise<ExecutionResult> {
  const signatures: string[] = [];
  const vaultPDA = new PublicKey(proposal.vaultPDA);
  const spotPoolAddress = new PublicKey(proposal.spotPoolAddress!);
  const baseMint = new PublicKey(proposal.baseMint);
  const quoteMint = new PublicKey(proposal.quoteMint);

  try {
    // ========================================================================
    // Step 1: Split real SOL into conditional SOL via quote vault
    // Result: tradeAmountLamports of cond_SOL in EACH market
    // ========================================================================
    console.log('\n  Step 1: Splitting real SOL into conditional SOL (quote vault deposit)...');
    console.log(`    Depositing ${new Decimal(tradeAmountLamports.toString()).div(1e9).toFixed(4)} real SOL`);

    const depositBuilder = await vaultClient.deposit(
      signer.publicKey,
      vaultPDA,
      VaultType.Quote,  // Quote vault for SOL
      tradeAmountLamports
    );
    const sig1 = await depositBuilder.rpc();
    signatures.push(sig1);
    console.log(`    Tx: ${sig1}`);
    console.log(`    Split into ${tradeAmountLamports.toString()} cond_SOL in EACH market`);

    // ========================================================================
    // Step 2: Buy conditional tokens with conditional SOL in each market
    // Each pool trades cond_TOKEN / cond_SOL
    // Track minimum cond_TOKEN received (merge bottleneck)
    // ========================================================================
    console.log('\n  Step 2: Buying conditional tokens with conditional SOL...');
    const conditionalTokenAmounts: BN[] = [];

    for (let i = 0; i < proposal.ammData.length; i++) {
      const amm = proposal.ammData[i];
      const label = proposal.marketLabels?.[i] || `Market ${i}`;

      if (!amm.pool || amm.state !== 'Trading') {
        console.log(`    ${label}: Skipping (not trading)`);
        conditionalTokenAmounts.push(new BN(0));
        continue;
      }

      const conditionalBaseMint = new PublicKey(amm.baseMint);
      const conditionalQuoteMint = new PublicKey(amm.quoteMint);
      const poolAddress = new PublicKey(amm.pool);

      console.log(`    ${label}: Buying cond_TOKEN with cond_SOL...`);
      const { tx: buyCondTx, expectedOut } = await getQuoteAndBuildSwap(
        cpAmm,
        connection,
        poolAddress,
        signer.publicKey,
        conditionalQuoteMint,  // cond_SOL (spending)
        conditionalBaseMint,   // cond_TOKEN (receiving)
        tradeAmountLamports,   // Same amount we split (1:1 ratio per market)
        MAX_SLIPPAGE_BPS,
        amm.baseDecimals,
        amm.quoteDecimals
      );

      conditionalTokenAmounts.push(expectedOut);

      buyCondTx.sign(signer);
      const sig = await sendAndConfirmTransaction(connection, buyCondTx, [signer], {
        commitment: 'confirmed',
      });
      signatures.push(sig);
      console.log(`      Tx: ${sig}`);
      console.log(`      Received ${expectedOut.toString()} cond_TOKEN_${i}`);
    }

    // ========================================================================
    // Step 3: Merge conditional tokens into real SPOT tokens via base vault
    // Can only merge MIN across all markets
    // ========================================================================
    const minCondTokens = conditionalTokenAmounts
      .filter(amt => amt.gt(new BN(0)))
      .reduce((min, amt) => BN.min(min, amt), conditionalTokenAmounts[0]);

    console.log('\n  Step 3: Merging conditional tokens into real SPOT tokens (base vault withdraw)...');
    console.log(`    cond_TOKEN amounts: [${conditionalTokenAmounts.map(a => a.toString()).join(', ')}]`);
    console.log(`    Merging MIN = ${minCondTokens.toString()} of each → ${minCondTokens.toString()} real SPOT`);

    const withdrawBuilder = await vaultClient.withdraw(
      signer.publicKey,
      vaultPDA,
      VaultType.Base,  // Base vault for SPOT tokens
      minCondTokens
    );
    const sig3 = await withdrawBuilder.rpc();
    signatures.push(sig3);
    console.log(`    Tx: ${sig3}`);

    // ========================================================================
    // Step 4: Sell real SPOT tokens for real SOL (spot pool)
    // ========================================================================
    console.log('\n  Step 4: Selling real SPOT tokens for real SOL...');
    const { tx: sellSpotTx, expectedOut: solReceived } = await getQuoteAndBuildSwap(
      cpAmm,
      connection,
      spotPoolAddress,
      signer.publicKey,
      baseMint,   // real SPOT (selling)
      quoteMint,  // real SOL (receiving)
      minCondTokens,
      MAX_SLIPPAGE_BPS,
      proposal.baseDecimals,
      proposal.quoteDecimals
    );

    sellSpotTx.sign(signer);
    const sig4 = await sendAndConfirmTransaction(connection, sellSpotTx, [signer], {
      commitment: 'confirmed',
    });
    signatures.push(sig4);
    console.log(`    Tx: ${sig4}`);
    console.log(`    Received ${new Decimal(solReceived.toString()).div(1e9).toFixed(6)} real SOL`);

    // Calculate profit
    const profitLamports = solReceived.sub(tradeAmountLamports);
    const profitSol = new Decimal(profitLamports.toString()).div(1e9);
    const profitPercent = profitSol.div(new Decimal(tradeAmountLamports.toString()).div(1e9)).mul(100);

    console.log('\n  Summary:');
    console.log(`    Spent: ${new Decimal(tradeAmountLamports.toString()).div(1e9).toFixed(6)} real SOL`);
    console.log(`    Received: ${new Decimal(solReceived.toString()).div(1e9).toFixed(6)} real SOL`);
    console.log(`    Profit: ${profitSol.toFixed(6)} SOL (${profitPercent.toFixed(2)}%)`);

    return { success: true, signatures };
  } catch (error) {
    return {
      success: false,
      signatures,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('=== Conditional vs Spot Arbitrage ===\n');
  console.log(`Proposal: ${MODERATOR_ID}/${PROPOSAL_ID}`);
  console.log(`Min Profit Threshold: ${MIN_PROFIT_BPS} bps (${MIN_PROFIT_BPS / 100}%)`);
  console.log(`Max Trade Cap: ${MAX_TRADE_SOL} SOL`);
  console.log(`Dry Run: ${DRY_RUN}\n`);

  // Load wallet keypair (any wallet with SOL can execute arbitrage)
  const walletKeyPath = process.env.ARB_WALLET_KEY || process.env.SOLANA_KEYPAIR_PATH;
  if (!walletKeyPath) {
    console.error('Wallet keypair not set. Set ARB_WALLET_KEY or SOLANA_KEYPAIR_PATH env var.');
    console.error('This can be any wallet with SOL - no special authority required.');
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
    console.error('\nMake sure the os-percent API server is running.');
    process.exit(1);
  }

  console.log(`Title: ${proposal.title}`);
  console.log(`Status: ${proposal.status}`);
  console.log(`Markets: ${proposal.markets}`);
  if (proposal.marketLabels) {
    console.log(`Market Labels: ${proposal.marketLabels.join(', ')}`);
  }

  // Check if proposal is in trading state
  if (proposal.status !== 'Pending') {
    console.log(`\nProposal is not in trading state (status: ${proposal.status}). Exiting.`);
    process.exit(0);
  }

  // Check if spot pool exists
  if (!proposal.spotPoolAddress) {
    console.error('\nNo spot pool address found for this proposal. Cannot arbitrage.');
    process.exit(1);
  }

  console.log(`\nSpot Pool: ${proposal.spotPoolAddress}`);
  console.log(`Base Mint: ${proposal.baseMint}`);
  console.log(`Quote Mint: ${proposal.quoteMint}`);
  console.log(`Vault PDA: ${proposal.vaultPDA}`);

  // Fetch spot price
  console.log('\n--- Fetching Prices ---');
  let spotPrice: Decimal;
  try {
    spotPrice = await fetchPoolPrice(
      cpAmm,
      proposal.spotPoolAddress,
      proposal.baseDecimals,
      proposal.quoteDecimals
    );
    console.log(`Spot Price: ${formatPrice(spotPrice)} SOL per token`);
  } catch (error) {
    console.error('Failed to fetch spot pool price:', error);
    process.exit(1);
  }

  // Fetch conditional AMM prices
  console.log('\nConditional Market Prices (raw SOL):');
  const conditionalPrices: Decimal[] = [];
  for (let i = 0; i < proposal.ammData.length; i++) {
    const amm = proposal.ammData[i];
    const label = proposal.marketLabels?.[i] || `Market ${i}`;

    if (!amm.pool) {
      console.log(`  ${label}: No pool address (AMM not initialized)`);
      continue;
    }

    if (amm.state !== 'Trading') {
      console.log(`  ${label}: AMM not in trading state (${amm.state})`);
      continue;
    }

    try {
      const price = await fetchPoolPrice(
        cpAmm,
        amm.pool,
        amm.baseDecimals,
        amm.quoteDecimals
      );
      conditionalPrices.push(price);

      const premium = price.minus(spotPrice).div(spotPrice).mul(100).toNumber();
      console.log(`  ${label}: ${formatPrice(price)} SOL per token (${formatPremium(premium)} vs spot)`);
    } catch (error) {
      console.error(`  ${label}: Failed to fetch price -`, error);
    }
  }

  if (conditionalPrices.length !== proposal.markets) {
    console.error(`\nCould not fetch prices for all ${proposal.markets} markets. Got ${conditionalPrices.length}.`);
    process.exit(1);
  }

  // Calculate time elapsed percentage
  const now = Date.now();
  const createdAt = proposal.createdAt;
  const finalizedAt = proposal.finalizedAt;
  const totalDuration = finalizedAt - createdAt;
  const elapsed = now - createdAt;
  const timeElapsedPercent = Math.min(1, Math.max(0, elapsed / totalDuration));
  const remainingMs = Math.max(0, finalizedAt - now);
  const remainingHours = (remainingMs / (1000 * 60 * 60)).toFixed(1);

  console.log(`\n--- Voting Period ---`);
  console.log(`Time Elapsed: ${(timeElapsedPercent * 100).toFixed(1)}%`);
  console.log(`Time Remaining: ${remainingHours} hours`);

  // Fetch TWAP data (displayed right after prices for context)
  console.log('\n--- Current TWAP Values (in SOL) ---');
  const twapData = await fetchTWAPData(MODERATOR_ID, PROPOSAL_ID);
  if (twapData) {
    console.log(`Last Updated: ${twapData.timestamp}`);
    for (let i = 0; i < twapData.twaps.length; i++) {
      const label = proposal.marketLabels?.[i] || `Market ${i}`;
      const currentTwap = twapData.twaps[i];
      const currentPrice = conditionalPrices[i];

      // Calculate expected final TWAP if current price holds
      const expectedFinal = calculateExpectedFinalTWAP(currentTwap, currentPrice, timeElapsedPercent);

      console.log(`  ${label}:`);
      console.log(`    Current TWAP:       ${formatPrice(new Decimal(currentTwap), 12)} SOL`);
      console.log(`    Expected Final:     ${formatPrice(new Decimal(expectedFinal), 12)} SOL (if price holds)`);
    }
  } else {
    console.log('  No TWAP data available yet');
  }

  // Detect opportunity
  console.log('\n--- Opportunity Detection ---');
  const opportunity = detectOpportunity(spotPrice, conditionalPrices);

  if (opportunity.type === 'NONE') {
    console.log('Opportunity: NONE (mixed pricing)');
    console.log('  Some conditionals are above spot, some are below.');
    console.log('  No guaranteed arbitrage exists.');
    console.log(`  Premiums: ${opportunity.premiums.map(formatPremium).join(', ')}`);
    process.exit(0);
  }

  console.log(`Opportunity: ALL ${opportunity.type} SPOT`);
  console.log(`  Min Premium: ${formatPremium(opportunity.minPremium)}`);
  console.log(`  Max Premium: ${formatPremium(opportunity.maxPremium)}`);
  console.log(`  Est. Profit (before sizing): ${opportunity.estimatedProfitBps} bps (${(opportunity.estimatedProfitBps / 100).toFixed(2)}%)`);

  if (opportunity.estimatedProfitBps < MIN_PROFIT_BPS) {
    console.log(`\nProfit below threshold (${MIN_PROFIT_BPS} bps). Skipping execution.`);
    process.exit(0);
  }

  // Calculate optimal trade size based on wallet balance
  console.log('\n--- Calculating Optimal Trade Size ---');
  const walletBalance = await connection.getBalance(wallet_keypair.publicKey);
  const maxWalletUsage = new BN(walletBalance).mul(new BN(95)).div(new BN(100));  // 95% of balance
  const maxTradeLamports = BN.min(maxWalletUsage, new BN(MAX_TRADE_SOL * 1e9));   // Cap at MAX_TRADE_SOL
  console.log(`Wallet Balance: ${new Decimal(walletBalance.toString()).div(1e9).toFixed(4)} SOL`);
  console.log(`Max Trade (95% of balance, capped at ${MAX_TRADE_SOL} SOL): ${new Decimal(maxTradeLamports.toString()).div(1e9).toFixed(4)} SOL`);

  const { optimalAmount, expectedProfitLamports } = await calculateOptimalTradeSize(
    cpAmm,
    connection,
    proposal,
    spotPrice,
    opportunity.type as 'ABOVE' | 'BELOW',
    maxTradeLamports
  );

  const optimalSol = new Decimal(optimalAmount.toString()).div(1e9);
  const expectedProfitSol = new Decimal(expectedProfitLamports.toString()).div(1e9);
  const profitPercent = expectedProfitSol.div(optimalSol).mul(100);

  console.log(`Optimal Trade Size: ${optimalSol.toFixed(4)} SOL`);
  console.log(`Expected Profit: ${expectedProfitSol.toFixed(6)} SOL (${profitPercent.toFixed(2)}%)`);

  if (expectedProfitLamports.lte(new BN(0))) {
    console.log('\nNo profitable trade size found. Skipping execution.');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log('\nDRY RUN - Not executing trades');
    console.log('Set DRY_RUN = false to execute.');
    process.exit(0);
  }

  // Execute arbitrage
  console.log('\n--- Trade Execution ---');
  console.log(`Trade Amount: ${optimalSol.toFixed(4)} SOL`);

  let result: ExecutionResult;
  if (opportunity.type === 'ABOVE') {
    console.log('Executing ABOVE arbitrage (split spot, sell conditionals)...');
    result = await executeAboveArbitrage(
      connection,
      cpAmm,
      vaultClient,
      wallet_keypair,
      proposal,
      optimalAmount
    );
  } else {
    console.log('Executing BELOW arbitrage (buy conditionals, merge to spot)...');
    result = await executeBelowArbitrage(
      connection,
      cpAmm,
      vaultClient,
      wallet_keypair,
      proposal,
      optimalAmount
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
    console.log('FAILED! Arbitrage execution failed.');
    console.log(`Error: ${result.error}`);
    if (result.signatures.length > 0) {
      console.log(`Partial transactions executed:`);
      result.signatures.forEach((sig, i) => {
        console.log(`  ${i + 1}. https://solscan.io/tx/${sig}`);
      });
    }
  }

  console.log('\nDone!');
}

main().catch(console.error);
