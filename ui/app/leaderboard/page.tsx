'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePrivyWallet } from '@/hooks/usePrivyWallet';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { usePot } from '@/hooks/usePot';
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
  const { entries: leaderboardEntries, totalVolume, loading: leaderboardLoading, error: leaderboardError } = useLeaderboard();

  // Fetch pot data
  const { potSol, loading: potLoading } = usePot();

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

              {/* Pot Display */}
              <div className="inline-flex items-center gap-3 bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 mb-4">
                <span className="text-sm font-medium leading-none" style={{ color: '#6B6E71' }}>
                  Total Pot
                </span>
                <div className="relative group flex items-center">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="cursor-help"
                    style={{ color: '#6B6E71' }}
                  >
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-max max-w-xs z-10">
                    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg py-2 px-3 shadow-lg">
                      <p className="text-xs" style={{ color: '#E9E9E3' }}>
                        Reward to be distributed to the top 10 traders equally
                      </p>
                    </div>
                  </div>
                </div>
                <span className="text-xl font-medium leading-none" style={{ color: '#E9E9E3' }}>
                  {potLoading ? (
                    <span className="text-sm" style={{ color: '#6B6E71' }}>Loading...</span>
                  ) : (
                    `${potSol.toFixed(4)} SOL`
                  )}
                </span>
              </div>

              {/* Error state */}
              {leaderboardError && (
                <div className="bg-[#121212] border border-red-900/20 rounded-[9px] py-4 px-5 mb-4">
                  <p className="text-red-400 text-sm">Failed to load leaderboard: {leaderboardError}</p>
                </div>
              )}

              {/* Leaderboard Table Card */}
              <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5">
                <LeaderboardTable entries={leaderboardEntries} totalVolume={totalVolume} loading={leaderboardLoading} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
