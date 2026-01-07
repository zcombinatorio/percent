'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
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
import { useProposalsWithFutarchy } from '@/hooks/useProposals';
import { useTradeHistory } from '@/hooks/useTradeHistory';
import { useUserBalances } from '@/hooks/useUserBalances';
import { formatNumber, formatCurrency } from '@/lib/formatters';
import { getProposalContent } from '@/lib/proposalContent';
import { getEffectiveMarketCount, filterMarketData, applyMarketLabelOverrides } from '@/lib/proposal-overrides';
import { MarkdownText } from '@/lib/renderMarkdown';
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
  const searchParams = useSearchParams();
  const { tokenSlug, poolAddress, baseMint, baseDecimals, tokenSymbol, moderatorId, icon, isLoading: tokenContextLoading, isFutarchy, daoPda } = useTokenContext();

  // Show toast for historical QM navigation (only once)
  const hasShownHistoricalToast = useRef(false);
  useEffect(() => {
    if (searchParams.get('historical') === 'true' && !hasShownHistoricalToast.current) {
      hasShownHistoricalToast.current = true;
      toast('Historical QM view coming soon', { icon: '🕐' });
      // Clean up the URL
      router.replace(`/${tokenSlug}`, { scroll: false });
    }
  }, [searchParams, router, tokenSlug]);
  const { ready, authenticated, user, walletAddress, login } = usePrivyWallet();

  // Only fetch proposals after TokenContext has loaded
  const shouldFetchProposals = !tokenContextLoading && (isFutarchy ? daoPda !== null : moderatorId !== null);

  // Fetch proposals - for futarchy, reads on-chain; for old system, uses API
  const { proposals, loading, refetch } = useProposalsWithFutarchy({
    poolAddress: shouldFetchProposals ? (poolAddress || undefined) : undefined,
    moderatorId: shouldFetchProposals ? moderatorId ?? undefined : undefined,
    isFutarchy: shouldFetchProposals ? isFutarchy : false,
    daoPda: shouldFetchProposals ? (daoPda || undefined) : undefined,
  });
  const [livePrices, setLivePrices] = useState<(number | null)[]>([]);
  const [twapData, setTwapData] = useState<(number | null)[]>([]);
  const [isProposalModalOpen, setIsProposalModalOpen] = useState(false);
  const [isPassMode, setIsPassMode] = useState(true);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isProposalModalOpen) {
        setIsProposalModalOpen(false);
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isProposalModalOpen]);

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

  const effectiveMarketLabels = useMemo(() => {
    const filtered = proposal?.marketLabels ? filterMarketData(proposal.marketLabels, moderatorId, proposal.id) : ['No', 'Yes'];
    return proposal ? applyMarketLabelOverrides(filtered, moderatorId, proposal.id) : filtered;
  }, [proposal, moderatorId]);

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
  } = useTradeHistory(proposal?.id || null, moderatorId ?? undefined, baseMint, tokenSymbol, isFutarchy);


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

  // Calculate time elapsed percentage for expected final TWAP projection
  // Updates every 10 seconds to keep projection current
  const [timeElapsedPercent, setTimeElapsedPercent] = useState(0);

  useEffect(() => {
    const calculateElapsed = () => {
      if (!proposal) return 0;
      const now = Date.now();
      const start = proposal.createdAt;
      const end = proposal.endsAt || proposal.finalizedAt;
      const elapsed = now - start;
      const total = end - start;
      if (total <= 0) return 1;
      return Math.min(1, Math.max(0, elapsed / total));
    };

    setTimeElapsedPercent(calculateElapsed());

    const interval = setInterval(() => {
      setTimeElapsedPercent(calculateElapsed());
    }, 10000); // Update every 10 seconds

    return () => clearInterval(interval);
  }, [proposal]);

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

                        return (
                          <>
                            {/* Clickable Card */}
                            <div
                              className="flex-[4] min-w-0 bg-[#121212] border border-[#191919] rounded-[9px] pt-4 pb-5 px-5 hover:border-[#2A2A2A] transition-all duration-300 cursor-pointer"
                              onClick={() => setIsProposalModalOpen(true)}
                            >
                              <div className="flex flex-col justify-between h-full overflow-hidden">
                                <h1 className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] mb-6 uppercase" style={{ color: '#DDDDD7' }}>
                                  QM {tokenSlug.toUpperCase()}-{proposal.id}
                                </h1>
                                <div className="text-lg font-normal mb-2 line-clamp-1 description-links" style={{ color: '#E9E9E3' }}>
                                  <MarkdownText>{content.title}</MarkdownText>
                                </div>
                                <div className="text-sm description-links break-all line-clamp-1" style={{ color: '#DDDDD7' }}>
                                  {content.content ? content.content : <MarkdownText>{cleanedDescription || ''}</MarkdownText>}
                                </div>
                              </div>
                            </div>

                            {/* Modal Popup */}
                            {isProposalModalOpen && (
                              <div
                                className="fixed inset-0 z-50 flex items-center justify-center p-4"
                                onClick={() => setIsProposalModalOpen(false)}
                              >
                                {/* Backdrop */}
                                <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

                                {/* Modal Content - same styling as card */}
                                <div
                                  className="relative bg-[#121212] border border-[#191919] rounded-[9px] pt-4 pb-5 px-5 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {/* Modal Header - same as card header */}
                                  <h1 className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] mb-6 uppercase flex items-center justify-between" style={{ color: '#DDDDD7' }}>
                                    QM {tokenSlug.toUpperCase()}-{proposal.id}
                                    <button
                                      onClick={() => setIsProposalModalOpen(false)}
                                      className="text-[#DDDDD7] hover:text-white transition-colors cursor-pointer"
                                    >
                                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    </button>
                                  </h1>

                                  {/* Scrollable Content */}
                                  <div className="flex-1 overflow-y-auto scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
                                    <div className="text-lg font-normal mb-2 description-links" style={{ color: '#E9E9E3' }}>
                                      <MarkdownText>{content.title}</MarkdownText>
                                    </div>
                                    <div className="text-sm description-links break-all leading-relaxed" style={{ color: '#DDDDD7' }}>
                                      {content.content ? content.content : <MarkdownText>{cleanedDescription || ''}</MarkdownText>}
                                    </div>

                                    {/* GitHub link if available */}
                                    {githubUrl && (
                                      <a
                                        href={githubUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-2 text-sm mt-4 text-[#DDDDD7] hover:text-white transition-colors"
                                      >
                                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                                          <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
                                        </svg>
                                        View on GitHub
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                                        </svg>
                                      </a>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {/* Time Remaining */}
                      <div className="flex-1 bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300">
                        <div className="text-white flex flex-col items-center">
                          <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-6 block w-full text-left" style={{ color: '#DDDDD7' }}>TIME REMAINING</span>
                          <CountdownTimer
                            endsAt={proposal.endsAt || proposal.finalizedAt}
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
                        moderatorId={moderatorId ?? undefined}
                        userWalletAddress={walletAddress}
                        tokenSymbol={tokenSymbol}
                        isFutarchy={isFutarchy}
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
                        livePrices={livePrices}
                        timeElapsedPercent={timeElapsedPercent}
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
