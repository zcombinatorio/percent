'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { usePrivyWallet } from '@/hooks/usePrivyWallet';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useTokenPrices } from '@/hooks/useTokenPrices';
import TradingInterface from '@/components/TradingInterface';
import Header from '@/components/Header';
import { CountdownTimer } from '@/components/CountdownTimer';
import { ChartBox } from '@/components/ChartBox';
import { ModeToggle } from '@/components/ModeToggle';
import { DepositCard } from '@/components/DepositCard';
import { useProposals } from '@/hooks/useProposals';
import { useTradeHistory } from '@/hooks/useTradeHistory';
import { useUserBalances } from '@/hooks/useUserBalances';
import { formatNumber, formatCurrency } from '@/lib/formatters';
import { getProposalContent } from '@/lib/proposalContent';
import { getEffectiveMarketCount, filterMarketData } from '@/lib/proposal-overrides';
import { useTokenContext } from '@/providers/TokenContext';

const LivePriceDisplay = dynamic(() => import('@/components/LivePriceDisplay').then(mod => mod.LivePriceDisplay), {
  ssr: false,
  loading: () => (
    <div className="bg-[#181818] rounded-lg p-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="animate-pulse">
            <div className="h-24 bg-gray-700 rounded"></div>
          </div>
        ))}
      </div>
    </div>
  )
});

export default function HomePage() {
  const router = useRouter();
  const { tokenSlug, poolAddress, baseMint, baseDecimals, tokenSymbol, moderatorId, icon, isLoading: tokenContextLoading } = useTokenContext();
  const { ready, authenticated, user, walletAddress, login } = usePrivyWallet();

  // Only fetch proposals after TokenContext has loaded to ensure correct moderatorId
  const shouldFetchProposals = !tokenContextLoading && moderatorId !== null;
  const { proposals, loading, refetch } = useProposals(
    shouldFetchProposals ? (poolAddress || undefined) : undefined,
    shouldFetchProposals ? moderatorId : undefined
  );
  const [livePrices, setLivePrices] = useState<(number | null)[]>([]);
  const [twapData, setTwapData] = useState<(number | null)[]>([]);
  const [isLiveProposalHovered, setIsLiveProposalHovered] = useState(false);
  const [isPassMode, setIsPassMode] = useState(true);

  // Fetch wallet balances for current token
  const { sol: solBalance, baseToken: baseTokenBalance, refetch: refetchWalletBalances } = useWalletBalances({
    walletAddress,
    baseMint,
    baseDecimals,
  });

  // Fetch token prices for USD conversion
  const { sol: solPrice, baseToken: baseTokenPrice } = useTokenPrices(baseMint);

  // Memoize sorted proposals for live view (sort by creation time to match backend ordering)
  const sortedProposals = useMemo(() =>
    [...proposals].sort((a, b) => b.createdAt - a.createdAt),
    [proposals]
  );

  const [selectedProposalId, setSelectedProposalId] = useState<number | null>(null);
  const [selectedMarketIndex, setSelectedMarketIndex] = useState<number>(1); // Default to index 1 (first choice)

  // Reset selected proposal when token changes to prevent stale data display
  useEffect(() => {
    setSelectedProposalId(null);
  }, [tokenSlug]);

  // Set initial selected proposal when proposals load (wait for loading to complete to avoid stale data)
  useEffect(() => {
    if (sortedProposals.length > 0 && selectedProposalId === null && !loading) {
      setSelectedProposalId(sortedProposals[0].id);
    }
  }, [sortedProposals, selectedProposalId, loading]);

  const proposal = useMemo(() =>
    proposals.find(p => p.id === selectedProposalId) || sortedProposals[0] || null,
    [selectedProposalId, proposals, sortedProposals]
  );

  // Apply market count overrides for proposals with incorrect market counts
  const effectiveMarketCount = useMemo(() =>
    proposal ? getEffectiveMarketCount(moderatorId, proposal.id, proposal.markets || 2) : 2,
    [proposal, moderatorId]
  );

  const effectiveMarketLabels = useMemo(() =>
    proposal?.marketLabels ? filterMarketData(proposal.marketLabels, moderatorId, proposal.id) : ['No', 'Yes'],
    [proposal, moderatorId]
  );

  // Fetch user balances for the selected proposal (uses client-side SDK)
  const { data: userBalances, refetch: refetchBalances } = useUserBalances(
    selectedProposalId,
    proposal?.vaultPDA ?? null,
    walletAddress
  );

  // Fetch trade history for the selected proposal
  const {
    trades,
    loading: tradesLoading,
    refetch: refetchTrades,
    getTimeAgo,
    getTokenUsed,
    calculateVolume
  } = useTradeHistory(proposal?.id || null, moderatorId ?? undefined, baseMint, tokenSymbol);


  const handleSelectProposal = useCallback((id: number) => {
    setSelectedProposalId(id);
  }, []);

  // Combined refetch callback for all balance-affecting operations
  const handleBalanceChange = useCallback(() => {
    refetchBalances();
    refetchWalletBalances();
  }, [refetchBalances, refetchWalletBalances]);

  const handleModeToggle = useCallback((newIsPassMode: boolean) => {
    setIsPassMode(newIsPassMode);
    setSelectedMarketIndex(newIsPassMode ? 1 : 0);
  }, []);

  const handleMarketIndexSelect = useCallback((index: number) => {
    setSelectedMarketIndex(index);
    // Sync mode toggle for backward compatibility (index 0 = "no", others = "yes")
    setIsPassMode(index > 0);
  }, []);

  const handleTimerEnd = useCallback(() => {
    // Wait 5 seconds after timer ends to refetch proposals
    setTimeout(() => {
      refetch();
    }, 5000);
  }, [refetch]);

  const handlePricesUpdate = useCallback((prices: (number | null)[]) => {
    console.log('[HomePage] handlePricesUpdate called with:', prices);
    setLivePrices(prices);
    console.log('[HomePage] livePrices state will be updated');
  }, []);

  const handleTwapUpdate = useCallback((twaps: (number | null)[]) => {
    console.log('TWAP update from LivePriceDisplay:', twaps);
    setTwapData(twaps);
  }, []);

  // Calculate if user has any position (N-ary market support)
  const hasPosition = useMemo(() => {
    if (!userBalances) return false;

    const hasAnyBase = userBalances.base.conditionalBalances.some(
      (b: string) => parseFloat(b || '0') > 0
    );
    const hasAnyQuote = userBalances.quote.conditionalBalances.some(
      (b: string) => parseFloat(b || '0') > 0
    );

    return hasAnyBase || hasAnyQuote;
  }, [userBalances]);

  // Check if user has any wallet balance
  const hasWalletBalance = useMemo(() => {
    return solBalance > 0 || baseTokenBalance > 0;
  }, [solBalance, baseTokenBalance]);

  // Calculate PFG percentage to match backend logic
  // Note: PFG (Pass-Fail Gap) is only meaningful for binary markets
  // For N-ary markets (3+ options), this returns null
  const pfgPercentage = useMemo(() => {
    // Match backend calculation exactly from app/twap-oracle.ts
    // twapData is now array: [0]=fail, [1]=pass, ...
    const failTwap = twapData[0];
    const passTwap = twapData[1];
    if (passTwap !== null && failTwap !== null && failTwap > 0) {
      const percentage = ((passTwap - failTwap) / failTwap) * 100;
      return percentage;
    }
    return null;
  }, [twapData]);

  // Show loading state while TokenContext or proposals are loading
  if (tokenContextLoading || loading) {
    return (
      <div className="flex h-screen bg-[#0a0a0a]">
        {/* Main content skeleton */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Loading...</div>
        </div>
      </div>
    );
  }

  if (!proposal || proposals.length === 0) {
    return (
      <div className="flex h-screen" style={{ backgroundColor: '#0a0a0a' }}>
        {/* Main Content */}
        <div className="flex-1 flex flex-col">
          {/* Header */}
          <Header
            walletAddress={walletAddress}
            authenticated={authenticated}
            solBalance={solBalance}
            baseTokenBalance={baseTokenBalance}
            hasWalletBalance={hasWalletBalance}
            login={login}
            isPassMode={isPassMode}
            tokenSlug={tokenSlug}
            tokenSymbol={tokenSymbol}
            tokenIcon={icon}
            poolAddress={poolAddress}
            baseMint={baseMint}
          />

          {/* Empty state */}
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <h2 className="text-2xl font-semibold text-gray-400 mb-2">No Proposals</h2>
              <p className="text-gray-500">Check back later for new governance proposals</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen" style={{ backgroundColor: '#0a0a0a' }}>
      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <Header
          walletAddress={walletAddress}
          authenticated={authenticated}
          solBalance={solBalance}
          baseTokenBalance={baseTokenBalance}
          hasWalletBalance={hasWalletBalance}
          login={login}
          isPassMode={isPassMode}
          tokenSlug={tokenSlug}
          tokenSymbol={tokenSymbol}
          tokenIcon={icon}
          poolAddress={poolAddress}
          baseMint={baseMint}
        />

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex justify-center overflow-y-auto">
              <div className="w-full max-w-[1332px] 2xl:max-w-[1512px] pt-8 pb-8 px-4 md:px-0">
                <div className="mb-6">
                  <h2 className="text-2xl font-medium" style={{ color: '#E9E9E3' }}>Live Quantum Market</h2>
                </div>

                {/* 2-column layout: 2/3 left, 1/3 right */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Left Column (2/3 width) */}
                  <div className="contents md:flex md:col-span-2 md:flex-col md:gap-4 md:pb-12 md:min-h-0">
                    {/* Top Row: Title/Description and Time Left */}
                    <div className="flex flex-col md:flex-row gap-4 md:items-stretch order-1">
                      {/* Title and Description */}
                      {(() => {
                        // Clean description first - remove GitHub URLs
                        let cleanedDescription = proposal.description;
                        let githubUrl = null;

                        const descriptionStr = typeof proposal.description === 'string'
                          ? proposal.description
                          : '';

                        if (descriptionStr) {
                          const githubMatch = descriptionStr.match(/(https?:\/\/github\.com\/[^\s\)\],]+)/i);
                          githubUrl = githubMatch ? githubMatch[1] : null;

                          // Remove GitHub URL from description
                          cleanedDescription = descriptionStr.replace(/(https?:\/\/github\.com\/[^\s\)\],]+)/gi, '').trim();
                        }

                        const content = getProposalContent(proposal.id, proposal.title, cleanedDescription, moderatorId?.toString());
                        const rawContent = content.content || cleanedDescription || '';

                        const cardInner = (
                          <div className="flex flex-col justify-between h-full">
                            <h1 className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] mb-6 uppercase flex items-center justify-between" style={{ color: '#DDDDD7' }}>
                              QM {tokenSlug.toUpperCase()}-{proposal.id}
                              {githubUrl && (
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                </svg>
                              )}
                            </h1>
                            <div className={`text-lg font-normal mb-2 ${!isLiveProposalHovered ? 'line-clamp-1' : ''}`} style={{ color: '#E9E9E3' }}>
                              {content.title}
                            </div>
                            <div className={`text-sm description-links ${!isLiveProposalHovered ? 'line-clamp-1' : ''}`} style={{ color: '#DDDDD7' }}>
                              {rawContent}
                            </div>
                          </div>
                        );

                        return githubUrl ? (
                          <a
                            href={githubUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex-[4] h-full"
                            onMouseEnter={() => setIsLiveProposalHovered(true)}
                            onMouseLeave={() => setIsLiveProposalHovered(false)}
                          >
                            <div className="bg-[#121212] border border-[#191919] rounded-[9px] pt-4 pb-5 px-5 hover:border-[#2A2A2A] transition-all duration-300 cursor-pointer h-full">
                              {cardInner}
                            </div>
                          </a>
                        ) : (
                          <div
                            className="flex-[4] bg-[#121212] border border-[#191919] rounded-[9px] pt-4 pb-5 px-5 transition-all duration-300"
                            onMouseEnter={() => setIsLiveProposalHovered(true)}
                            onMouseLeave={() => setIsLiveProposalHovered(false)}
                          >
                            {cardInner}
                          </div>
                        );
                      })()}

                      {/* Time Remaining */}
                      <div className="flex-1 bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300">
                        <div className="text-white flex flex-col items-center">
                          <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-6 block w-full text-left" style={{ color: '#DDDDD7' }}>TIME REMAINING</span>
                          <CountdownTimer
                            endsAt={proposal.finalizedAt}
                            onTimerEnd={handleTimerEnd}
                            isPending={proposal.status === 'Pending'}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Chart */}
                    <div className="order-4 md:order-2 md:flex-1 md:flex md:flex-col md:min-h-0">
                      <ChartBox
                        className="md:flex-1"
                        proposalId={proposal.id}
                        selectedMarketIndex={selectedMarketIndex}
                        marketLabels={effectiveMarketLabels}
                        trades={trades.filter(trade => trade.market === selectedMarketIndex)}
                        tradesLoading={tradesLoading}
                        getTimeAgo={getTimeAgo}
                        getTokenUsed={getTokenUsed}
                        calculateVolume={calculateVolume}
                        moderatorId={moderatorId ?? undefined}
                        userWalletAddress={walletAddress}
                      />
                    </div>
                  </div>

                  {/* Right Column (1/3 width) */}
                  <div className="contents md:flex md:col-span-1 md:flex-col md:gap-4 md:pb-12">
                    {/* Deposit Card */}
                    <div className="order-2 md:order-1">
                      <DepositCard
                        proposalId={proposal.id}
                        vaultPDA={proposal.vaultPDA}
                        solBalance={solBalance}
                        baseTokenBalance={baseTokenBalance}
                        userBalances={userBalances}
                        onDepositSuccess={handleBalanceChange}
                        tokenSymbol={tokenSymbol}
                        baseDecimals={baseDecimals}
                        proposalStatus={proposal.status as 'Pending' | 'Passed' | 'Failed'}
                        winningMarketIndex={proposal.winningMarketIndex}
                      />
                    </div>

                    {/* Mode Toggle */}
                    <div className="order-3 md:order-2">
                      <ModeToggle
                        marketLabels={effectiveMarketLabels}
                        marketCaps={twapData}
                        selectedIndex={selectedMarketIndex}
                        onSelect={handleMarketIndexSelect}
                        solPrice={solPrice}
                      />
                    </div>

                    {/* Trading Interface */}
                    <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300 order-5 md:order-3">
                      <div className="text-white flex flex-col items-center">
                        <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-6 block w-full text-center" style={{ color: '#DDDDD7' }}>
                          III. Trade "{effectiveMarketLabels[selectedMarketIndex]?.replace(/(https?:\/\/[^\s]+)/gi, '').trim() || `Coin ${selectedMarketIndex + 1}`}"
                        </span>
                        <div className="w-full">
                          <TradingInterface
                            proposalId={proposal.id}
                            selectedMarketIndex={selectedMarketIndex}
                            marketLabels={effectiveMarketLabels}
                            passPrice={livePrices[1] || 0.5}
                            failPrice={livePrices[0] || 0.5}
                            proposalStatus={proposal.status as 'Pending' | 'Passed' | 'Failed'}
                            userBalances={userBalances}
                            refetchBalances={handleBalanceChange}
                            onTradeSuccess={refetchTrades}
                            baseMint={baseMint}
                            tokenSymbol={tokenSymbol}
                            winningMarketIndex={proposal.winningMarketIndex}
                          />
                        </div>
                      </div>
                    </div>

                    {/* User Balances - Separate ZC and SOL cards */}
                    <div className="order-6 md:order-4 pb-10 md:pb-0">
                    {(() => {
                      // Calculate if market expired and which tokens are losing
                      const isExpired = proposal.status !== 'Pending';
                      // For quantum markets, the winning market index is stored in proposal.winningMarketIndex
                      const isShowingLosingTokens = isExpired && proposal.winningMarketIndex !== selectedMarketIndex;

                      // Get display label for the selected market (strip URLs and trim)
                      const selectedLabel = effectiveMarketLabels[selectedMarketIndex]?.replace(/(https?:\/\/[^\s]+)/gi, '').trim() || `Coin ${selectedMarketIndex + 1}`;

                      // Calculate actual balances using market index and dynamic decimals
                      const baseMultiplier = Math.pow(10, baseDecimals);
                      const baseTokenBalance = userBalances ? parseFloat(
                        userBalances.base.conditionalBalances[selectedMarketIndex] || '0'
                      ) / baseMultiplier : 0;

                      const solBalance = userBalances ? parseFloat(
                        userBalances.quote.conditionalBalances[selectedMarketIndex] || '0'
                      ) / 1e9 : 0; // SOL is always 9 decimals

                      // Zero out if showing losing tokens on expired market
                      const displayBaseTokenBalance = (isExpired && isShowingLosingTokens) ? 0 : baseTokenBalance;
                      const displaySOLBalance = (isExpired && isShowingLosingTokens) ? 0 : solBalance;

                      return (
                    <div className="flex gap-4">
                        {/* Base Token Balance Card */}
                        <div className="flex-1 bg-[#121212] border border-[#191919] rounded-[9px] py-3 px-5 transition-all duration-300">
                          <div className="text-white flex flex-col">
                            <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-6 text-center block" style={{ color: '#DDDDD7' }}>
                              {`IV. If "${selectedLabel}" Wins Bal`}
                            </span>
                            <div className="group flex items-center justify-center border border-[#191919] rounded-[6px] py-3 px-4 text-lg font-ibm-plex-mono cursor-default" style={{ color: '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace' }}>
                              <span className="group-hover:hidden">
                                {formatNumber(displayBaseTokenBalance, 0)} {tokenSymbol}<sup className="text-xs">*</sup>
                              </span>
                              <span className="hidden group-hover:inline">
                                  {formatCurrency(displayBaseTokenBalance * (baseTokenPrice || 0), 2)}
                                </span>
                            </div>
                          </div>
                        </div>

                        {/* SOL Balance Card */}
                        <div className="flex-1 bg-[#121212] border border-[#191919] rounded-[9px] py-3 px-5 transition-all duration-300">
                          <div className="text-white flex flex-col">
                            <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-6 text-center block" style={{ color: '#DDDDD7' }}>
                              {`IV. If "${selectedLabel}" Wins Bal`}
                            </span>
                            <div className="group flex items-center justify-center border border-[#191919] rounded-[6px] py-3 px-4 text-lg font-ibm-plex-mono cursor-default" style={{ color: '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace' }}>
                              <span className="group-hover:hidden">
                                {formatNumber(displaySOLBalance, 3)} SOL<sup className="text-xs">*</sup>
                              </span>
                              {solPrice && (
                                <span className="hidden group-hover:inline">
                                  {formatCurrency(displaySOLBalance * solPrice, 2)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                    </div>
                      );
                    })()}
                    </div>
                  </div>
                </div>

                {/* Hidden component for price and TWAP updates */}
                <div className="hidden">
                  <LivePriceDisplay
                    proposalId={proposal.id}
                    marketLabels={effectiveMarketLabels}
                    marketCount={effectiveMarketCount}
                    onPricesUpdate={handlePricesUpdate}
                    onTwapUpdate={handleTwapUpdate}
                  />
                </div>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}
