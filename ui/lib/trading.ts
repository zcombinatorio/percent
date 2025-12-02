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

import { Transaction } from '@solana/web3.js';
import toast from 'react-hot-toast';
import { buildApiUrl, withModeratorId } from './api-utils';
import { transformUserBalances } from './api-adapter';
import type { RawUserBalancesResponse } from '@/types/api';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// SOL mint address (quote token)
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_DECIMALS = 9;

export interface OpenPositionConfig {
  proposalId: number;
  market: number;  // Which AMM market to trade on (0-3 for quantum markets)
  inputToken: 'sol' | 'baseToken';  // Which conditional token we're selling
  inputAmount: string;  // Amount of conditional tokens to sell
  userAddress: string;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  baseDecimals?: number;  // Decimals for the base token (default 6)
  moderatorId?: number;  // Moderator ID for multi-moderator support
}

/**
 * Execute a swap on a specific market (Pass or Fail AMM)
 * Swaps conditional tokens: e.g., Pass-ZC → Pass-SOL or Fail-SOL → Fail-ZC
 */
export async function openPosition(config: OpenPositionConfig): Promise<void> {
  const { proposalId, market, inputToken, inputAmount, userAddress, signTransaction, baseDecimals = 6, moderatorId } = config;

  // Determine swap direction based on inputToken
  // inputToken 'baseToken' means we're selling base conditional for quote (SOL conditional)
  // inputToken 'sol' means we're selling quote (SOL conditional) for base conditional
  const isBaseToQuote = inputToken === 'baseToken';

  const toastId = toast.loading(`Swapping ${market}-${inputToken.toUpperCase()}...`);

  try {
    // Convert decimal amount to smallest units using dynamic decimals
    const decimals = inputToken === 'baseToken' ? baseDecimals : SOL_DECIMALS;
    const amountInSmallestUnits = Math.floor(parseFloat(inputAmount) * Math.pow(10, decimals)).toString();

    // Execute the swap on the selected market
    await executeMarketSwap(
      proposalId,
      market,
      isBaseToQuote,
      amountInSmallestUnits,
      userAddress,
      signTransaction,
      moderatorId
    );

    // Success message
    const outputToken = inputToken === 'baseToken' ? 'SOL' : 'BASE';
    toast.success(
      `Successfully swapped ${market}-${inputToken.toUpperCase()} → ${market}-${outputToken}!`,
      { id: toastId, duration: 5000 }
    );

  } catch (error) {
    console.error('Error executing swap:', error);
    toast.error(
      `Failed to execute swap: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { id: toastId }
    );
    throw error;
  }
}

/**
 * Get user balances for a proposal
 */
async function getUserBalances(proposalId: number, userAddress: string, moderatorId?: number): Promise<any> {
  const balancesResponse = await fetch(
    buildApiUrl(API_BASE_URL, `/api/vaults/${proposalId}/getUserBalances`, { user: userAddress }, moderatorId)
  );

  if (balancesResponse.ok) {
    const rawBalances: RawUserBalancesResponse = await balancesResponse.json();
    // Transform to add passConditional/failConditional named fields
    return transformUserBalances(rawBalances);
  }

  return null;
}

/**
 * Claim winnings from a finished proposal
 * Claims from BOTH vaults (base and quote) for the winning market
 * For N-ary quantum markets (2-4 options)
 */
export async function claimWinnings(config: {
  proposalId: number;
  winningMarketIndex: number;  // Which market won (from proposal.winningMarketIndex)
  userAddress: string;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  moderatorId?: number;
}): Promise<void> {
  const { proposalId, winningMarketIndex, userAddress, signTransaction, moderatorId } = config;

  const toastId = toast.loading('Claiming winnings from both vaults...');

  try {
    // Get user balances to determine which vaults have claimable tokens
    const balances = await getUserBalances(proposalId, userAddress, moderatorId);
    if (!balances) {
      throw new Error('Failed to get user balances');
    }

    // Check if user has winning tokens in the winning market index
    // Use conditionalBalances array for N-ary quantum markets
    const hasBaseTokens = parseFloat(balances.base.conditionalBalances[winningMarketIndex] || '0') > 0;
    const hasQuoteTokens = parseFloat(balances.quote.conditionalBalances[winningMarketIndex] || '0') > 0;

    const vaultsToRedeem: ('base' | 'quote')[] = [];
    if (hasBaseTokens) vaultsToRedeem.push('base');
    if (hasQuoteTokens) vaultsToRedeem.push('quote');

    if (vaultsToRedeem.length === 0) {
      throw new Error('No winning tokens to claim');
    }

    // Redeem from each vault that has tokens
    for (const vaultType of vaultsToRedeem) {
      // Build redeem transaction
      const redeemResponse = await fetch(
        buildApiUrl(API_BASE_URL, `/api/vaults/${proposalId}/${vaultType}/buildRedeemWinningTokensTx`, undefined, moderatorId),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            user: userAddress
          })
        }
      );

      if (!redeemResponse.ok) {
        const error = await redeemResponse.json();
        throw new Error(`Failed to build ${vaultType} redeem transaction: ${error.message || JSON.stringify(error)}`);
      }

      const redeemData = await redeemResponse.json();

      // Sign the transaction
      const redeemTx = Transaction.from(Buffer.from(redeemData.transaction, 'base64'));
      const signedRedeemTx = await signTransaction(redeemTx);

      // Execute the signed redeem transaction
      const executeRedeemResponse = await fetch(
        buildApiUrl(API_BASE_URL, `/api/vaults/${proposalId}/${vaultType}/executeRedeemWinningTokensTx`, undefined, moderatorId),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            transaction: Buffer.from(signedRedeemTx.serialize({ requireAllSignatures: false })).toString('base64')
          })
        }
      );

      if (!executeRedeemResponse.ok) {
        const error = await executeRedeemResponse.json();
        throw new Error(`Failed to execute ${vaultType} redeem transaction: ${error.message || JSON.stringify(error)}`);
      }
    }

    toast.success(
      `Winnings claimed successfully from ${vaultsToRedeem.length} vault${vaultsToRedeem.length > 1 ? 's' : ''}!`,
      { id: toastId, duration: 5000 }
    );

    return;
    
  } catch (error) {
    console.error('Error claiming winnings:', error);
    toast.error(
      `Failed to claim winnings: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { id: toastId }
    );
    throw error;
  }
}

/**
 * Execute a swap on a specific market (0-3 for quantum markets)
 */
async function executeMarketSwap(
  proposalId: number,
  market: number,  // Numeric market index (0-3)
  isBaseToQuote: boolean,
  amountIn: string,
  userAddress: string,
  signTransaction: (transaction: Transaction) => Promise<Transaction>,
  moderatorId?: number
): Promise<void> {

  // Build swap request (market is already numeric)
  const swapRequest = {
    user: userAddress,
    market: market,
    isBaseToQuote: isBaseToQuote,
    amountIn: amountIn,
    slippageBps: 2000 // 20% slippage for large swaps
  };

  const buildSwapResponse = await fetch(buildApiUrl(API_BASE_URL, `/api/swap/${proposalId}/buildSwapTx`, undefined, moderatorId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(swapRequest)
  });

  if (!buildSwapResponse.ok) {
    const error = await buildSwapResponse.json();
    throw new Error(`Build ${market} swap failed: ${error.message || JSON.stringify(error)}`);
  }

  const swapTxData = await buildSwapResponse.json();

  // Sign the swap transaction
  const swapTx = Transaction.from(Buffer.from(swapTxData.transaction, 'base64'));
  const signedSwapTx = await signTransaction(swapTx);

  // Execute the signed swap transaction
  const executeSwapResponse = await fetch(buildApiUrl(API_BASE_URL, `/api/swap/${proposalId}/executeSwapTx`, undefined, moderatorId), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      transaction: Buffer.from(signedSwapTx.serialize({ requireAllSignatures: false })).toString('base64'),
      market: market,
      user: userAddress,
      isBaseToQuote: isBaseToQuote,
      amountIn: amountIn,
      amountOut: swapTxData.expectedAmountOut
    })
  });
  
  if (!executeSwapResponse.ok) {
    const error = await executeSwapResponse.json();
    throw new Error(`${market} swap execution failed: ${error.message || JSON.stringify(error)}`);
  }
}