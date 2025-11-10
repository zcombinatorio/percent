'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivyWallet } from '@/hooks/usePrivyWallet';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import Header from '@/components/Header';
import { LeaderboardTable } from '@/components/LeaderboardTable';

export default function LeaderboardPage() {
  const router = useRouter();
  const { ready, authenticated, user, walletAddress, login } = usePrivyWallet();
  const [navTab] = useState<'live' | 'history' | 'leaderboard'>('leaderboard');

  // Fetch wallet balances
  const { sol: solBalance, zc: zcBalance } = useWalletBalances(walletAddress);

  // Check if user has any wallet balance
  const hasWalletBalance = solBalance > 0 || zcBalance > 0;

  // Fetch leaderboard data
  const { entries: leaderboardEntries, loading: leaderboardLoading, error: leaderboardError } = useLeaderboard();

  // Handle navigation
  const handleNavTabChange = useCallback((tab: 'live' | 'history' | 'leaderboard') => {
    if (tab === 'live' || tab === 'history') {
      router.push('/');
    }
  }, [router]);

  return (
    <div className="flex h-screen" style={{ backgroundColor: '#0a0a0a' }}>
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <Header
          walletAddress={walletAddress}
          authenticated={authenticated}
          solBalance={solBalance}
          zcBalance={zcBalance}
          hasWalletBalance={hasWalletBalance}
          login={login}
          navTab={navTab}
          onNavTabChange={handleNavTabChange}
          isPassMode={true}
        />

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex justify-center overflow-y-auto">
            <div className="w-full max-w-[1332px] 2xl:max-w-[1512px] pt-8 pb-8">
              <div className="mb-6">
                <h2 className="text-2xl font-medium" style={{ color: '#E9E9E3' }}>
                  Leaderboard
                </h2>
                <p className="text-sm mt-2" style={{ color: '#6B6E71' }}>
                  Top traders by total volume across all proposals
                </p>
                {/* Debug info */}
                <p className="text-xs mt-2" style={{ color: '#6B6E71' }}>
                  Debug: {leaderboardLoading ? 'Loading...' : `${leaderboardEntries.length} entries found`}
                </p>
              </div>

              {/* Error state */}
              {leaderboardError && (
                <div className="bg-[#121212] border border-red-900/20 rounded-[9px] py-4 px-5 mb-4">
                  <p className="text-red-400 text-sm">Failed to load leaderboard: {leaderboardError}</p>
                </div>
              )}

              {/* Leaderboard Table Card */}
              <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5">
                <LeaderboardTable entries={leaderboardEntries} loading={leaderboardLoading} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
