'use client';

import { ReactNode, use } from 'react';
import { TokenProvider } from '@/providers/TokenContext';

interface TokenLayoutProps {
  children: ReactNode;
  params: Promise<{ token: string }>;
}

export default function TokenLayout({ children, params }: TokenLayoutProps) {
  const { token } = use(params);

  return (
    <TokenProvider tokenSlug={token}>
      {children}
    </TokenProvider>
  );
}
