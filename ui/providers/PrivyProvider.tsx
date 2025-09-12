'use client';

import React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || 'YOUR-PRIVY-APP-ID';

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
          logo: '/percent-logo-big.svg',
          walletChainType: 'solana-only', // Show only Solana options
        },
        // Login methods - email and social logins
        loginMethods: ['email', 'google', 'twitter'],
        // Embedded wallets configuration - Solana specific
        embeddedWallets: {
          createOnLogin: 'off', // Turn off automatic EVM wallet creation
          requireUserPasswordOnCreate: false,
          noPromptOnSignature: false,
          // Solana-specific configuration
          solana: {
            createOnLogin: 'all-users', // Always create embedded Solana wallets
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}