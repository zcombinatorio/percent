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

import { useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets } from '@privy-io/react-auth/solana';

export function usePrivyWallet() {
  const { ready: privyReady, authenticated, user, login, logout } = usePrivy();
  const { ready: solanaWalletsReady } = useSolanaWallets();

  // Both Privy SDK and Solana wallets must be ready for transactions
  const ready = privyReady && solanaWalletsReady;

  const walletAddress = useMemo(() => {
    if (!user) return null;
    
    // Check for embedded Solana wallet
    if (user.wallet?.address) {
      return user.wallet.address;
    }
    
    // Check linked accounts for Solana wallet
    if (user.linkedAccounts) {
      const solanaWallet = user.linkedAccounts.find(
        account => account.type === 'wallet' && account.chainType === 'solana'
      );
      if (solanaWallet && 'address' in solanaWallet) {
        return solanaWallet.address;
      }
    }
    
    return null;
  }, [user]);

  return {
    ready,
    authenticated,
    user,
    walletAddress,
    login,
    logout,
  };
}