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

import { useState, useEffect, useCallback } from 'react';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';

interface WalletBalances {
  sol: number;
  baseToken: number; // Dynamic token balance (ZC, OOGWAY, etc.)
  loading: boolean;
  error: string | null;
}

interface UseWalletBalancesParams {
  walletAddress: string | null;
  baseMint?: string | null; // Token mint address
  baseDecimals?: number; // Token decimals (default 6)
}

export function useWalletBalances({
  walletAddress,
  baseMint,
  baseDecimals = 6,
}: UseWalletBalancesParams): WalletBalances {
  const [balances, setBalances] = useState<WalletBalances>({
    sol: 0,
    baseToken: 0,
    loading: false,
    error: null,
  });

  const fetchBalances = useCallback(async (address: string) => {
    setBalances(prev => ({ ...prev, loading: true, error: null }));

    try {
      // Use Helius RPC with API key if available, otherwise fall back to other options
      const heliusApiKey = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
      const rpcUrl = heliusApiKey
        ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
        : process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com';
      const connection = new Connection(rpcUrl, 'confirmed');
      const pubKey = new PublicKey(address);

      // Fetch SOL balance
      const solBalance = await connection.getBalance(pubKey);
      const solAmount = solBalance / LAMPORTS_PER_SOL;

      // Fetch base token balance (if baseMint provided)
      let baseTokenAmount = 0;
      if (baseMint) {
        try {
          const tokenMint = new PublicKey(baseMint);
          const tokenATA = await getAssociatedTokenAddress(
            tokenMint,
            pubKey
          );

          const tokenAccount = await getAccount(connection, tokenATA);
          // Use dynamic decimals
          baseTokenAmount = Number(tokenAccount.amount) / Math.pow(10, baseDecimals);
        } catch {
          // Token account might not exist if user has 0 balance - this is normal
        }
      }

      setBalances({
        sol: solAmount,
        baseToken: baseTokenAmount,
        loading: false,
        error: null,
      });
    } catch (error) {
      setBalances({
        sol: 0,
        baseToken: 0,
        loading: false,
        error: error instanceof Error ? error.message : 'Failed to fetch balances',
      });
    }
  }, [baseMint, baseDecimals]);

  useEffect(() => {
    if (!walletAddress) {
      setBalances({
        sol: 0,
        baseToken: 0,
        loading: false,
        error: null,
      });
      return;
    }

    // Initial fetch
    fetchBalances(walletAddress);

    // Set up WebSocket subscriptions for real-time updates
    const heliusApiKey = process.env.NEXT_PUBLIC_HELIUS_API_KEY;
    const rpcUrl = heliusApiKey
      ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`
      : process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');
    const pubKey = new PublicKey(walletAddress);

    // Subscribe to account changes for SOL balance
    const solSubscriptionId = connection.onAccountChange(
      pubKey,
      () => {
        // Refetch balances when account changes
        fetchBalances(walletAddress);
      },
      'confirmed'
    );

    // Subscribe to base token account changes (if baseMint provided)
    let tokenSubscriptionId: number | null = null;
    if (baseMint) {
      (async () => {
        try {
          const tokenMint = new PublicKey(baseMint);
          const tokenATA = await getAssociatedTokenAddress(tokenMint, pubKey);

          tokenSubscriptionId = connection.onAccountChange(
            tokenATA,
            () => {
              // Refetch balances when token account changes
              fetchBalances(walletAddress);
            },
            'confirmed'
          );
        } catch {
          // Could not subscribe to token account changes - this is normal if account doesn't exist
        }
      })();
    }

    // Also refresh every 30 seconds as fallback
    const interval = setInterval(() => fetchBalances(walletAddress), 30000);

    // Cleanup
    return () => {
      connection.removeAccountChangeListener(solSubscriptionId);
      if (tokenSubscriptionId !== null) {
        connection.removeAccountChangeListener(tokenSubscriptionId);
      }
      clearInterval(interval);
    };
  }, [walletAddress, baseMint, fetchBalances]);

  return balances;
}
