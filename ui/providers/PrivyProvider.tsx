'use client';

import React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || 'YOUR-PRIVY-APP-ID';

// Initialize Solana wallet connectors
const solanaConnectors = toSolanaWalletConnectors({
  // Disable auto-connect to prevent wallet pop-ups on page load
  shouldAutoConnect: false,
});

export default function PrivyProviderWrapper({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID || PRIVY_APP_ID === 'YOUR-PRIVY-APP-ID') {
    console.error('Privy App ID is not configured. Please set NEXT_PUBLIC_PRIVY_APP_ID in your .env.local file');
  }


  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Appearance configuration with dark theme
        appearance: {
          theme: 'dark',
          accentColor: '#f97316', // Orange color matching your UI
          logo: '/combinator-icon.svg',
          walletChainType: 'solana-only', // Show only Solana options
        },
        // Login methods - email and social logins
        loginMethods: ['email', 'google', 'twitter'],
        // Embedded wallets configuration - Solana specific
        embeddedWallets: {
          createOnLogin: 'off', // Turn off automatic EVM wallet creation
          requireUserPasswordOnCreate: false,
          // Solana-specific configuration
          solana: {
            createOnLogin: 'all-users', // Always create embedded Solana wallets
          },
        },
        // External wallets configuration - Enable Solana wallet connections
        externalWallets: {
          solana: {
            connectors: solanaConnectors,
          },
        },
        // Custom RPC configuration for Solana
        solana: {
          rpcs: {
            'solana:mainnet': {
              rpc: createSolanaRpc('https://bernie-zo3q7f-fast-mainnet.helius-rpc.com'),
              rpcSubscriptions: createSolanaRpcSubscriptions('wss://bernie-zo3q7f-fast-mainnet.helius-rpc.com'),
            },
            'solana:devnet': {
              rpc: createSolanaRpc('https://api.devnet.solana.com'),
              rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.devnet.solana.com'),
            },
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}