#!/usr/bin/env ts-node
/**
 * Conditional vs Spot Arbitrage Script
 *
 * Arbitrages conditional markets against spot pools by exploiting the
 * 1:1 split/merge property: 1 spot token = 1 pass conditional + 1 fail conditional.
 *
 * Arbitrage exists when:
 * - ALL conditionals > spot price: Split spot, sell all conditionals
 * - ALL conditionals < spot price: Buy all conditionals, merge to spot
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
const MIN_PROFIT_BPS = 500;      // 5% minimum profit threshold
const MAX_SLIPPAGE_BPS = 500;    // 5% max slippage
const DRY_RUN = true;            // Simulate only by default
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
 * Calculate optimal trade size for arbitrage.
 * Uses binary search to find the largest trade where post-trade prices
 * still maintain the arbitrage (all above or all below spot).
 */
async function calculateOptimalTradeSize(
  cpAmm: CpAmm,
  connection: Connection,
  proposal: ProposalData,
  spotPrice: Decimal,
  opportunityType: 'ABOVE' | 'BELOW',
  maxTradeLamports: BN
): Promise<{ optimalAmount: BN; expectedProfitLamports: BN }> {
  const quoteMint = new PublicKey(proposal.quoteMint);

  // Binary search for optimal trade size
  let low = new BN(1_000_000);  // Min 0.001 SOL
  let high = maxTradeLamports;
  let optimalAmount = low;
  let bestProfit = new BN(0);

  // Get current slot/blocktime once
  const currentSlot = await connection.getSlot();
  const blockTime = await connection.getBlockTime(currentSlot);
  if (!blockTime) throw new Error('Failed to get block time');

  while (low.lte(high)) {
    const mid = low.add(high).div(new BN(2));

    try {
      let totalOut = new BN(0);
      let totalIn = mid;
      let stillProfitable = true;

      if (opportunityType === 'ABOVE') {
        // ABOVE: We spend SOL to buy spot, split, sell conditionals for SOL
        // Check: after selling conditionals, do we get more SOL back?

        // First, simulate buying spot tokens
        const spotPool = new PublicKey(proposal.spotPoolAddress!);
        const spotPoolState = await cpAmm.fetchPoolState(spotPool);
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

        // Then simulate selling each conditional
        for (const amm of proposal.ammData) {
          if (!amm.pool || amm.state !== 'Trading') continue;

          const poolAddress = new PublicKey(amm.pool);
          const conditionalMint = new PublicKey(amm.baseMint);
          const poolState = await cpAmm.fetchPoolState(poolAddress);

          const quote = cpAmm.getQuote({
            inAmount: spotTokensReceived,  // Sell same amount we split
            inputTokenMint: conditionalMint,
            slippage: MAX_SLIPPAGE_BPS / 10000,
            poolState,
            currentTime: blockTime,
            currentSlot,
            tokenADecimal: amm.baseDecimals,
            tokenBDecimal: amm.quoteDecimals,
          });

          totalOut = totalOut.add(quote.swapOutAmount);

          // Check if post-trade price still above spot
          const postTradePrice = new Decimal(quote.swapOutAmount.toString())
            .div(new Decimal(spotTokensReceived.toString()));
          if (postTradePrice.lte(spotPrice)) {
            stillProfitable = false;
          }
        }
      } else {
        // BELOW: We spend SOL to buy conditionals, merge to spot
        const solPerMarket = mid.div(new BN(proposal.markets));
        let minConditionalReceived = new BN(Number.MAX_SAFE_INTEGER);

        for (const amm of proposal.ammData) {
          if (!amm.pool || amm.state !== 'Trading') continue;

          const poolAddress = new PublicKey(amm.pool);
          const conditionalMint = new PublicKey(amm.baseMint);
          const poolState = await cpAmm.fetchPoolState(poolAddress);

          const quote = cpAmm.getQuote({
            inAmount: solPerMarket,
            inputTokenMint: quoteMint,
            slippage: MAX_SLIPPAGE_BPS / 10000,
            poolState,
            currentTime: blockTime,
            currentSlot,
            tokenADecimal: amm.baseDecimals,
            tokenBDecimal: amm.quoteDecimals,
          });

          if (quote.swapOutAmount.lt(minConditionalReceived)) {
            minConditionalReceived = quote.swapOutAmount;
          }

          // Check if post-trade price still below spot
          const postTradePrice = new Decimal(solPerMarket.toString())
            .div(new Decimal(quote.swapOutAmount.toString()));
          if (postTradePrice.gte(spotPrice)) {
            stillProfitable = false;
          }
        }

        // After merge, we have minConditionalReceived spot tokens
        // Value in SOL = minConditionalReceived * spotPrice
        totalOut = new BN(
          new Decimal(minConditionalReceived.toString())
            .mul(spotPrice)
            .floor()
            .toString()
        );
      }

      const profit = totalOut.sub(totalIn);

      if (stillProfitable && profit.gt(new BN(0))) {
        if (profit.gt(bestProfit)) {
          bestProfit = profit;
          optimalAmount = mid;
        }
        low = mid.add(new BN(1));
      } else {
        high = mid.sub(new BN(1));
      }
    } catch {
      // If simulation fails at this size, try smaller
      high = mid.sub(new BN(1));
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
    // Step 1: Swap SOL -> spot tokens on spot pool
    console.log('\n  Step 1: Swapping SOL -> spot tokens on spot pool...');
    const { tx: buySpotTx, expectedOut: spotTokensOut } = await getQuoteAndBuildSwap(
      cpAmm,
      connection,
      spotPoolAddress,
      signer.publicKey,
      quoteMint,  // SOL is quote
      baseMint,   // Base token is what we want
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
    console.log(`    Received ~${spotTokensOut.toString()} spot tokens`);

    // Step 2: Split spot tokens into conditionals via vault deposit
    console.log('\n  Step 2: Splitting spot tokens into conditionals...');
    const depositBuilder = await vaultClient.deposit(
      signer.publicKey,
      vaultPDA,
      VaultType.Base,
      spotTokensOut
    );
    const sig2 = await depositBuilder.rpc();
    signatures.push(sig2);
    console.log(`    Tx: ${sig2}`);
    console.log(`    Split into ${proposal.markets} conditional tokens`);

    // Step 3: Sell each conditional token for SOL
    console.log('\n  Step 3: Selling conditional tokens for SOL...');
    for (let i = 0; i < proposal.ammData.length; i++) {
      const amm = proposal.ammData[i];
      const label = proposal.marketLabels?.[i] || `Market ${i}`;

      if (!amm.pool || amm.state !== 'Trading') {
        console.log(`    ${label}: Skipping (not trading)`);
        continue;
      }

      const conditionalMint = new PublicKey(amm.baseMint);
      const poolAddress = new PublicKey(amm.pool);

      console.log(`    ${label}: Selling conditional -> SOL...`);
      const { tx: sellCondTx } = await getQuoteAndBuildSwap(
        cpAmm,
        connection,
        poolAddress,
        signer.publicKey,
        conditionalMint,  // Conditional token
        quoteMint,        // SOL
        spotTokensOut,    // Same amount we split
        MAX_SLIPPAGE_BPS,
        amm.baseDecimals,
        amm.quoteDecimals
      );

      sellCondTx.sign(signer);
      const sig = await sendAndConfirmTransaction(connection, sellCondTx, [signer], {
        commitment: 'confirmed',
      });
      signatures.push(sig);
      console.log(`      Tx: ${sig}`);
    }

    return { success: true, signatures };
  } catch (error) {
    return {
      success: false,
      signatures,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

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
  const quoteMint = new PublicKey(proposal.quoteMint);

  try {
    // Calculate SOL per market (divide among all conditional purchases)
    const solPerMarket = tradeAmountLamports.div(new BN(proposal.markets));
    let minConditionalReceived = new BN(Number.MAX_SAFE_INTEGER);

    // Step 1: Buy each conditional token with SOL
    console.log('\n  Step 1: Buying conditional tokens with SOL...');
    const conditionalAmounts: BN[] = [];

    for (let i = 0; i < proposal.ammData.length; i++) {
      const amm = proposal.ammData[i];
      const label = proposal.marketLabels?.[i] || `Market ${i}`;

      if (!amm.pool || amm.state !== 'Trading') {
        console.log(`    ${label}: Skipping (not trading)`);
        conditionalAmounts.push(new BN(0));
        continue;
      }

      const conditionalMint = new PublicKey(amm.baseMint);
      const poolAddress = new PublicKey(amm.pool);

      console.log(`    ${label}: Buying conditional with ${solPerMarket.toString()} lamports...`);
      const { tx: buyCondTx, expectedOut } = await getQuoteAndBuildSwap(
        cpAmm,
        connection,
        poolAddress,
        signer.publicKey,
        quoteMint,        // SOL
        conditionalMint,  // Conditional token
        solPerMarket,
        MAX_SLIPPAGE_BPS,
        amm.baseDecimals,
        amm.quoteDecimals
      );

      conditionalAmounts.push(expectedOut);
      if (expectedOut.lt(minConditionalReceived)) {
        minConditionalReceived = expectedOut;
      }

      buyCondTx.sign(signer);
      const sig = await sendAndConfirmTransaction(connection, buyCondTx, [signer], {
        commitment: 'confirmed',
      });
      signatures.push(sig);
      console.log(`      Tx: ${sig}`);
      console.log(`      Received ~${expectedOut.toString()} conditional tokens`);
    }

    // Step 2: Merge conditionals into spot via vault withdraw
    // We can only merge the minimum amount we have of all conditionals
    console.log('\n  Step 2: Merging conditionals into spot tokens...');
    console.log(`    Merging ${minConditionalReceived.toString()} of each conditional`);

    const withdrawBuilder = await vaultClient.withdraw(
      signer.publicKey,
      vaultPDA,
      VaultType.Base,
      minConditionalReceived
    );
    const sig2 = await withdrawBuilder.rpc();
    signatures.push(sig2);
    console.log(`    Tx: ${sig2}`);

    // Step 3: (Optional) Could sell spot for SOL here, or just hold
    console.log('\n  Step 3: Holding spot tokens (not selling back to SOL)');

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

  // Calculate optimal trade size
  console.log('\n--- Calculating Optimal Trade Size ---');
  const maxTradeLamports = new BN(MAX_TRADE_SOL * 1e9);

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
  const tradeAmountLamports = optimalAmount;

  let result: ExecutionResult;
  if (opportunity.type === 'ABOVE') {
    console.log('Executing ABOVE arbitrage (split spot, sell conditionals)...');
    result = await executeAboveArbitrage(
      connection,
      cpAmm,
      vaultClient,
      wallet_keypair,
      proposal,
      tradeAmountLamports
    );
  } else {
    console.log('Executing BELOW arbitrage (buy conditionals, merge to spot)...');
    result = await executeBelowArbitrage(
      connection,
      cpAmm,
      vaultClient,
      wallet_keypair,
      proposal,
      tradeAmountLamports
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
