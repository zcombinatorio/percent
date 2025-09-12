import { useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export function usePrivyWallet() {
  const { ready, authenticated, user, login, logout } = usePrivy();

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