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

import { PoolType } from '../../src/config/pools';
import {
  DlmmWithdrawBuildResponse,
  DammWithdrawBuildResponse,
  DlmmWithdrawConfirmResponse,
  DammWithdrawConfirmResponse,
  NormalizedWithdrawBuildData,
  NormalizedWithdrawConfirmData,
  isDlmmWithdrawBuildResponse,
  isDammWithdrawBuildResponse,
  isDlmmWithdrawConfirmResponse,
  isDammWithdrawConfirmResponse,
} from '../types/pool-api.interface';

/**
 * Normalize a withdraw/build API response to internal format
 * Uses explicit branching based on pool type - no defensive fallbacks
 *
 * @param raw - Raw API response (unknown type)
 * @param poolType - Pool type ('dlmm' or 'damm')
 * @returns Normalized withdrawal build data with tokenA/tokenB naming
 * @throws Error if response doesn't match expected structure for pool type
 */
export function normalizeWithdrawBuildResponse(
  raw: unknown,
  poolType: PoolType
): NormalizedWithdrawBuildData {
  if (poolType === 'dlmm') {
    // Validate DLMM response structure
    if (!isDlmmWithdrawBuildResponse(raw)) {
      throw new Error(
        'Invalid DLMM withdraw/build response: missing required fields (transactions, withdrawn, transferred, redeposited)'
      );
    }

    const dlmm = raw as DlmmWithdrawBuildResponse;

    return {
      requestId: dlmm.requestId,
      transactions: dlmm.transactions,
      marketPrice: dlmm.marketPrice,
      // Normalize tokenX/tokenY to tokenA/tokenB (base/quote)
      withdrawn: {
        tokenA: dlmm.withdrawn.tokenX,
        tokenB: dlmm.withdrawn.tokenY,
      },
      transferred: {
        tokenA: dlmm.transferred.tokenX,
        tokenB: dlmm.transferred.tokenY,
      },
      redeposited: {
        tokenA: dlmm.redeposited.tokenX,
        tokenB: dlmm.redeposited.tokenY,
      },
    };
  } else if (poolType === 'damm') {
    // Validate DAMM response structure
    if (!isDammWithdrawBuildResponse(raw)) {
      throw new Error(
        'Invalid DAMM withdraw/build response: missing required fields (transaction, estimatedAmounts)'
      );
    }

    const damm = raw as DammWithdrawBuildResponse;

    // DAMM doesn't have market price or redeposit - use estimatedAmounts for all
    return {
      requestId: damm.requestId,
      transaction: damm.transaction,
      marketPrice: 0, // Will be calculated from amounts if needed
      // DAMM: estimatedAmounts is both withdrawn and transferred (no redeposit)
      withdrawn: {
        tokenA: damm.estimatedAmounts.tokenA,
        tokenB: damm.estimatedAmounts.tokenB,
      },
      transferred: {
        tokenA: damm.estimatedAmounts.tokenA,
        tokenB: damm.estimatedAmounts.tokenB,
      },
      redeposited: {
        tokenA: '0',
        tokenB: '0',
      },
    };
  } else {
    // Exhaustive check - TypeScript should catch this at compile time
    const _exhaustive: never = poolType;
    throw new Error(`Unknown pool type: ${_exhaustive}`);
  }
}

/**
 * Normalize a withdraw/confirm API response to internal format
 * Uses explicit branching based on pool type - no defensive fallbacks
 *
 * @param raw - Raw API response (unknown type)
 * @param poolType - Pool type ('dlmm' or 'damm')
 * @returns Normalized withdrawal confirm data with signature and amounts
 * @throws Error if response doesn't match expected structure for pool type
 */
export function normalizeWithdrawConfirmResponse(
  raw: unknown,
  poolType: PoolType
): NormalizedWithdrawConfirmData {
  if (poolType === 'dlmm') {
    // Validate DLMM response structure
    if (!isDlmmWithdrawConfirmResponse(raw)) {
      throw new Error(
        'Invalid DLMM withdraw/confirm response: missing required fields (signatures, transferred)'
      );
    }

    const dlmm = raw as DlmmWithdrawConfirmResponse;

    // For DLMM, use the last signature (transfer transaction)
    // The order is: remove liquidity txs -> redeposit tx -> transfer tx
    const finalSignature = dlmm.signatures[dlmm.signatures.length - 1];

    return {
      signature: finalSignature,
      allSignatures: dlmm.signatures,
      amounts: {
        tokenA: dlmm.transferred.tokenX,
        tokenB: dlmm.transferred.tokenY,
      },
      marketPrice: dlmm.marketPrice,
    };
  } else if (poolType === 'damm') {
    // Validate DAMM response structure
    if (!isDammWithdrawConfirmResponse(raw)) {
      throw new Error(
        'Invalid DAMM withdraw/confirm response: missing required fields (signature, estimatedAmounts)'
      );
    }

    const damm = raw as DammWithdrawConfirmResponse;

    return {
      signature: damm.signature,
      amounts: {
        tokenA: damm.estimatedAmounts.tokenA,
        tokenB: damm.estimatedAmounts.tokenB,
      },
    };
  } else {
    // Exhaustive check
    const _exhaustive: never = poolType;
    throw new Error(`Unknown pool type: ${_exhaustive}`);
  }
}

/**
 * Calculate market price from token amounts
 * Used as fallback for DAMM which doesn't provide Jupiter price
 *
 * @param tokenAAmount - Base token amount (raw string)
 * @param tokenBAmount - Quote token amount (raw string)
 * @param tokenADecimals - Base token decimals
 * @param tokenBDecimals - Quote token decimals
 * @returns Market price (tokenB per tokenA, e.g., SOL per ZC)
 */
export function calculateMarketPriceFromAmounts(
  tokenAAmount: string,
  tokenBAmount: string,
  tokenADecimals: number,
  tokenBDecimals: number
): number {
  const tokenAUI = parseInt(tokenAAmount) / Math.pow(10, tokenADecimals);
  const tokenBUI = parseInt(tokenBAmount) / Math.pow(10, tokenBDecimals);

  if (tokenAUI === 0) {
    return 0;
  }

  return tokenBUI / tokenAUI;
}
