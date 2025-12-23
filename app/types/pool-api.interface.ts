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

/**
 * DLMM Withdraw Build Response
 * Returns from /dlmm/withdraw/build endpoint
 * Uses tokenX/tokenY naming convention (Meteora DLMM standard)
 */
export interface DlmmWithdrawBuildResponse {
  requestId: string;
  transactions: string[];           // Array of base58-encoded transactions (DLMM may split across bins)
  transactionCount: number;
  marketPrice: number;              // Jupiter market price (tokenY per tokenX, e.g., SOL per ZC)
  withdrawn: {
    tokenX: string;                 // Total base token withdrawn from pool (raw)
    tokenY: string;                 // Total quote token withdrawn from pool (raw)
  };
  transferred: {
    tokenX: string;                 // Base token transferred to manager at market price (raw)
    tokenY: string;                 // Quote token transferred to manager at market price (raw)
  };
  redeposited: {
    tokenX: string;                 // Excess base token redeposited to pool (raw)
    tokenY: string;                 // Excess quote token redeposited to pool (raw)
  };
  poolAddress: string;
  tokenXMint: string;
  tokenYMint: string;
  tokenXDecimals: number;
  tokenYDecimals: number;
}

/**
 * DAMM Withdraw Build Response
 * Returns from /damm/withdraw/build endpoint
 * Uses tokenA/tokenB naming convention (Meteora CP-AMM standard)
 */
export interface DammWithdrawBuildResponse {
  requestId: string;
  transaction: string;              // Single base58-encoded transaction
  estimatedAmounts: {
    tokenA: string;                 // Base token amount (raw)
    tokenB: string;                 // Quote token amount (raw)
  };
  poolAddress: string;
  tokenAMint: string;
  tokenBMint: string;
  tokenADecimals: number;
  tokenBDecimals: number;
}

/**
 * DLMM Withdraw Confirm Response
 * Returns from /dlmm/withdraw/confirm endpoint
 */
export interface DlmmWithdrawConfirmResponse {
  success: boolean;
  signatures: string[];             // Array of transaction signatures
  marketPrice: number;
  withdrawn: {
    tokenX: string;
    tokenY: string;
  };
  transferred: {
    tokenX: string;
    tokenY: string;
  };
  redeposited: {
    tokenX: string;
    tokenY: string;
  };
  poolAddress: string;
}

/**
 * DAMM Withdraw Confirm Response
 * Returns from /damm/withdraw/confirm endpoint
 */
export interface DammWithdrawConfirmResponse {
  success: boolean;
  signature: string;                // Single transaction signature
  estimatedAmounts: {
    tokenA: string;
    tokenB: string;
  };
  poolAddress: string;
}

/**
 * Normalized internal format for withdrawal build data
 * Uses tokenA/tokenB (base/quote) naming convention internally
 */
export interface NormalizedWithdrawBuildData {
  requestId: string;
  transaction?: string;             // DAMM: single transaction
  transactions?: string[];          // DLMM: array of transactions
  marketPrice: number;              // Jupiter price for DLMM, calculated for DAMM
  withdrawn: {
    tokenA: string;                 // Total base token withdrawn (raw)
    tokenB: string;                 // Total quote token withdrawn (raw)
  };
  transferred: {
    tokenA: string;                 // Base token to manager (raw)
    tokenB: string;                 // Quote token to manager (raw)
  };
  redeposited: {
    tokenA: string;                 // Excess base token redeposited (raw)
    tokenB: string;                 // Excess quote token redeposited (raw)
  };
}

/**
 * Normalized internal format for withdrawal confirm data
 */
export interface NormalizedWithdrawConfirmData {
  signature: string;                // Final/primary signature
  allSignatures?: string[];         // All signatures (DLMM only)
  amounts: {
    tokenA: string;                 // Confirmed base token amount (raw)
    tokenB: string;                 // Confirmed quote token amount (raw)
  };
  marketPrice?: number;             // Market price (DLMM only)
}

/**
 * Type guard to check if response is from DLMM withdraw/build
 */
export function isDlmmWithdrawBuildResponse(
  response: unknown
): response is DlmmWithdrawBuildResponse {
  const r = response as DlmmWithdrawBuildResponse;
  return (
    typeof r === 'object' &&
    r !== null &&
    Array.isArray(r.transactions) &&
    typeof r.withdrawn === 'object' &&
    typeof r.transferred === 'object' &&
    typeof r.redeposited === 'object' &&
    'tokenX' in r.withdrawn &&
    'tokenY' in r.withdrawn
  );
}

/**
 * Type guard to check if response is from DAMM withdraw/build
 */
export function isDammWithdrawBuildResponse(
  response: unknown
): response is DammWithdrawBuildResponse {
  const r = response as DammWithdrawBuildResponse;
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.transaction === 'string' &&
    typeof r.estimatedAmounts === 'object' &&
    'tokenA' in r.estimatedAmounts &&
    'tokenB' in r.estimatedAmounts
  );
}

/**
 * Type guard to check if response is from DLMM withdraw/confirm
 */
export function isDlmmWithdrawConfirmResponse(
  response: unknown
): response is DlmmWithdrawConfirmResponse {
  const r = response as DlmmWithdrawConfirmResponse;
  return (
    typeof r === 'object' &&
    r !== null &&
    Array.isArray(r.signatures) &&
    r.signatures.length > 0 &&
    typeof r.transferred === 'object' &&
    'tokenX' in r.transferred
  );
}

/**
 * Type guard to check if response is from DAMM withdraw/confirm
 */
export function isDammWithdrawConfirmResponse(
  response: unknown
): response is DammWithdrawConfirmResponse {
  const r = response as DammWithdrawConfirmResponse;
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.signature === 'string' &&
    typeof r.estimatedAmounts === 'object' &&
    'tokenA' in r.estimatedAmounts
  );
}
