'use client';

import { useRouter } from 'next/navigation';
import { usePrivyWallet } from '@/hooks/usePrivyWallet';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useLeaderboard } from '@/hooks/useLeaderboard';
import { usePot } from '@/hooks/usePot';
import Header from '@/components/Header';
import { LeaderboardTable } from '@/components/LeaderboardTable';
import { useTokenContext } from '@/providers/TokenContext';

export default function LeaderboardPage() {
  const router = useRouter();
  const { tokenSlug, poolAddress, baseMint, baseDecimals, tokenSymbol, moderatorId, icon } = useTokenContext();
  const { ready, authenticated, user, walletAddress, login } = usePrivyWallet();

  // Fetch wallet balances for current token
  const { sol: solBalance, baseToken: baseTokenBalance } = useWalletBalances({
    walletAddress,
    baseMint,
    baseDecimals,
  });

  // Check if user has any wallet balance
  const hasWalletBalance = solBalance > 0 || baseTokenBalance > 0;

  // Fetch leaderboard data
  const { entries: leaderboardEntries, totalVolume, loading: leaderboardLoading, error: leaderboardError } = useLeaderboard(moderatorId || undefined, baseMint || undefined);

  // Fetch pot data
  const { potSol, loading: potLoading } = usePot(moderatorId ?? undefined);

  return (
    <div className="flex h-screen" style={{ backgroundColor: '#0a0a0a' }}>
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <Header
          walletAddress={walletAddress}
          authenticated={authenticated}
          solBalance={solBalance}
          baseTokenBalance={baseTokenBalance}
          hasWalletBalance={hasWalletBalance}
          login={login}
          isPassMode={true}
          tokenSlug={tokenSlug}
          tokenSymbol={tokenSymbol}
          tokenIcon={icon}
          poolAddress={poolAddress}
        />

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex justify-center overflow-y-auto">
            <div className="w-full max-w-[1332px] 2xl:max-w-[1512px] pt-8 pb-8">
              <div className="mb-6">
                <h2 className="text-2xl font-medium" style={{ color: '#E9E9E3' }}>
                  Rankings
                </h2>
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
