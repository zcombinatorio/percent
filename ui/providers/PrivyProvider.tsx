'use client';

import React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || 'YOUR-PRIVY-APP-ID';

// RPC URLs from environment
const MAINNET_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com';
const MAINNET_WS_URL = MAINNET_RPC_URL.replace('https://', 'wss://').replace('http://', 'ws://');

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
          theme: '#0a0a0a',
          accentColor: '#DDDDD7',
          logo: '/combinator-icon.svg',
          walletChainType: 'solana-only', // Show only Solana options
        },
        // Login methods - email, social, and wallet logins
        loginMethods: ['email', 'google', 'twitter', 'wallet'],
        // Embedded wallets configuration - Solana specific
        embeddedWallets: {
          createOnLogin: 'off', // Turn off automatic EVM wallet creation
          requireUserPasswordOnCreate: false,
          // Solana-specific configuration
          solana: {
            createOnLogin: 'users-without-wallets', // Only create if no external wallet linked
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
              rpc: createSolanaRpc(MAINNET_RPC_URL),
              rpcSubscriptions: createSolanaRpcSubscriptions(MAINNET_WS_URL),
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