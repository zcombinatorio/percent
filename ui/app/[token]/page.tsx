'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { usePrivyWallet } from '@/hooks/usePrivyWallet';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useTokenPrices } from '@/hooks/useTokenPrices';
// import Sidebar from '@/components/Sidebar';
import TradingInterface from '@/components/TradingInterface';
import Header from '@/components/Header';
import { CountdownTimer } from '@/components/CountdownTimer';
import { ChartBox } from '@/components/ChartBox';
import { ModeToggle } from '@/components/ModeToggle';
import { DepositCard } from '@/components/DepositCard';
import { useProposals } from '@/hooks/useProposals';
import { useTradeHistory } from '@/hooks/useTradeHistory';
import { useUserBalances } from '@/hooks/useUserBalances';
import { useClaimablePositions } from '@/hooks/useClaimablePositions';
import { formatNumber, formatCurrency } from '@/lib/formatters';
import { useSolanaWallets } from '@privy-io/react-auth/solana';
import { Transaction } from '@solana/web3.js';
import toast from 'react-hot-toast';
import { getProposalContent } from '@/lib/proposalContent';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { claimWinnings } from '@/lib/trading';
import { buildApiUrl } from '@/lib/api-utils';
import Masonry from 'react-masonry-css';
import { ProposalVolume } from '@/components/ProposalVolume';
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
  const [livePrices, setLivePrices] = useState<{ pass: number | null; fail: number | null }>({ pass: null, fail: null });
  const [twapData, setTwapData] = useState<{ passTwap: number | null; failTwap: number | null }>({ passTwap: null, failTwap: null });
  const [isLiveProposalHovered, setIsLiveProposalHovered] = useState(false);
  const [isPassMode, setIsPassMode] = useState(true);

  // Fetch wallet balances for current token
  const { sol: solBalance, baseToken: baseTokenBalance } = useWalletBalances({
    walletAddress,
    baseMint,
    baseDecimals,
  });

  // Fetch token prices for USD conversion
  const { sol: solPrice, baseToken: baseTokenPrice } = useTokenPrices(baseMint);

  // Get Solana wallets for transaction signing
  const { wallets } = useSolanaWallets();

  // Memoize sorted proposals for live view (sort by creation time to match backend ordering)
  const sortedProposals = useMemo(() =>
    [...proposals].sort((a, b) => b.createdAt - a.createdAt),
    [proposals]
  );

  const [selectedProposalId, setSelectedProposalId] = useState<number | null>(null);

  // Fetch user balances for the selected proposal
  const { data: userBalances, refetch: refetchBalances } = useUserBalances(selectedProposalId, walletAddress, moderatorId ?? undefined);
  const [selectedMarket, setSelectedMarket] = useState<'pass' | 'fail'>('pass');

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

  // Fetch trade history for the selected proposal
  const {
    trades,
    totalVolume,
    loading: tradesLoading,
    refetch: refetchTrades,
    getTimeAgo,
    getTokenUsed
  } = useTradeHistory(proposal?.id || null, moderatorId ?? undefined, baseMint, tokenSymbol);

  // Market caps are pre-calculated on the backend (price in SOL × total supply × SOL/USD)
  // WebSocket delivers market cap USD directly - no frontend calculation needed
  const marketCaps = useMemo(() => {
    console.log('[HomePage] Calculating marketCaps from livePrices:', livePrices);
    const caps = {
      pass: livePrices.pass,
      fail: livePrices.fail,
    };
    console.log('[HomePage] marketCaps result:', caps);
    return caps;
  }, [livePrices.pass, livePrices.fail]);

  const handleSelectProposal = useCallback((id: number) => {
    setSelectedProposalId(id);
  }, []);
  
  const handleMarketChange = useCallback((market: 'pass' | 'fail') => {
    setSelectedMarket(market);
    // Also sync the mode toggle
    setIsPassMode(market === 'pass');
  }, []);

  const handleModeToggle = useCallback((newIsPassMode: boolean) => {
    setIsPassMode(newIsPassMode);
    // Also sync the selected market
    setSelectedMarket(newIsPassMode ? 'pass' : 'fail');
  }, []);

  const handleTimerEnd = useCallback(() => {
    // Wait 5 seconds after timer ends to refetch proposals
    setTimeout(() => {
      refetch();
    }, 5000);
  }, [refetch]);

  const handlePricesUpdate = useCallback((prices: { pass: number | null; fail: number | null }) => {
    console.log('[HomePage] handlePricesUpdate called with:', prices);
    setLivePrices(prices);
    console.log('[HomePage] livePrices state will be updated');
  }, []);

  const handleTwapUpdate = useCallback((twap: { passTwap: number | null; failTwap: number | null }) => {
    console.log('TWAP update from LivePriceDisplay:', twap);
    setTwapData(twap);
  }, []);

  // Calculate if user has any position
  const hasPosition = useMemo(() => {
    if (!userBalances) return false;
    return (
      parseFloat(userBalances.base.passConditional || '0') > 0 ||
      parseFloat(userBalances.base.failConditional || '0') > 0 ||
      parseFloat(userBalances.quote.passConditional || '0') > 0 ||
      parseFloat(userBalances.quote.failConditional || '0') > 0
    );
  }, [userBalances]);

  // Check if user has any wallet balance
  const hasWalletBalance = useMemo(() => {
    return solBalance > 0 || baseTokenBalance > 0;
  }, [solBalance, baseTokenBalance]);

  /* TRADING FUNCTIONS - COMMENTED OUT UNTIL TRADING MODAL IS IMPLEMENTED
  // Handle MAX button click - TODO: Move to trading modal
  const handleMaxClick = useCallback(() => {
    if (marketMode === 'enter') {
      let maxBalance = selectedToken === 'sol' ? solBalance : baseTokenBalance;

      // Reserve 0.02 SOL for transaction fees when entering with SOL
      if (selectedToken === 'sol' && maxBalance !== null) {
        const SOL_GAS_RESERVE = 0.02;
        maxBalance = Math.max(0, maxBalance - SOL_GAS_RESERVE);
      }

      setAmount(maxBalance?.toString() || '0');
    } else {
      // Exit mode: calculate min of pass and fail for selected token
      if (userBalances) {
        let maxExitAmount = 0;
        if (selectedToken === 'sol') {
          const passSol = parseFloat(userBalances.quote.passConditional || '0') / 1e9;
          const failSol = parseFloat(userBalances.quote.failConditional || '0') / 1e9;
          maxExitAmount = Math.min(passSol, failSol);
        } else {
          const passZC = parseFloat(userBalances.base.passConditional || '0') / 1e6;
          const failZC = parseFloat(userBalances.base.failConditional || '0') / 1e6;
          maxExitAmount = Math.min(passZC, failZC);
        }
        setAmount(maxExitAmount.toString());
      }
    }
  }, [marketMode, selectedToken, solBalance, baseTokenBalance, userBalances]);

  // Handle Enter Market - Split tokens into conditional tokens
  const handleEnterMarket = useCallback(async () => {
    if (!authenticated || !walletAddress) {
      toast.error('Please connect your wallet');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (!proposal || proposal.id === undefined) {
      toast.error('No proposal selected');
      return;
    }

    setIsEntering(true);
    const toastId = toast.loading('Entering market...');

    try {
      // Determine vault type based on selected token
      const vaultType = selectedToken === 'sol' ? 'quote' : 'base';

      // Convert amount to smallest units
      const decimals = selectedToken === 'sol' ? 9 : 6; // SOL: 9, ZC: 6
      const amountInSmallestUnits = Math.floor(parseFloat(amount) * Math.pow(10, decimals));

      // Build split transaction
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const buildResponse = await fetch(buildApiUrl(API_BASE_URL, `/api/vaults/${proposal.id}/${vaultType}/buildSplitTx`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: walletAddress,
          amount: amountInSmallestUnits.toString()
        })
      });

      if (!buildResponse.ok) {
        const error = await buildResponse.json();
        throw new Error(error.message || 'Failed to build split transaction');
      }

      const buildData = await buildResponse.json();

      // Sign the transaction
      const splitTx = Transaction.from(Buffer.from(buildData.transaction, 'base64'));
      const wallet = wallets[0];
      if (!wallet) throw new Error('No Solana wallet found');
      const signedTx = await wallet.signTransaction(splitTx);

      // Execute split transaction
      const executeResponse = await fetch(buildApiUrl(API_BASE_URL, `/api/vaults/${proposal.id}/${vaultType}/executeSplitTx`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: Buffer.from(signedTx.serialize({ requireAllSignatures: false })).toString('base64')
        })
      });

      if (!executeResponse.ok) {
        const error = await executeResponse.json();
        throw new Error(error.message || 'Failed to execute split transaction');
      }

      toast.success('Successfully entered market!', { id: toastId, duration: 5000 });

      // Clear amount and refresh balances
      setAmount('');
      refetchBalances();

    } catch (error) {
      console.error('Enter market failed:', error);
      toast.error(
        `Failed to enter market: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { id: toastId }
      );
    } finally {
      setIsEntering(false);
    }
  }, [authenticated, walletAddress, amount, proposal, selectedToken, wallets, refetchBalances]);

  // Handle Exit Market - Merge conditional tokens back
  const handleExitMarket = useCallback(async () => {
    if (!authenticated || !walletAddress) {
      toast.error('Please connect your wallet');
      return;
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    if (!proposal || proposal.id === undefined) {
      toast.error('No proposal selected');
      return;
    }

    if (!userBalances) {
      toast.error('Unable to get user balances');
      return;
    }

    setIsExiting(true);
    const toastId = toast.loading('Exiting market...');

    try {
      // Determine vault type based on selected token
      const vaultType = selectedToken === 'sol' ? 'quote' : 'base';

      // Convert amount to smallest units
      const decimals = selectedToken === 'sol' ? 9 : 6; // SOL: 9, ZC: 6
      const amountInSmallestUnits = Math.floor(parseFloat(amount) * Math.pow(10, decimals));

      // Build merge transaction
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const buildResponse = await fetch(buildApiUrl(API_BASE_URL, `/api/vaults/${proposal.id}/${vaultType}/buildMergeTx`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: walletAddress,
          amount: amountInSmallestUnits.toString()
        })
      });

      if (!buildResponse.ok) {
        const error = await buildResponse.json();
        throw new Error(error.message || 'Failed to build merge transaction');
      }

      const buildData = await buildResponse.json();

      // Sign the transaction
      const mergeTx = Transaction.from(Buffer.from(buildData.transaction, 'base64'));
      const wallet = wallets[0];
      if (!wallet) throw new Error('No Solana wallet found');
      const signedTx = await wallet.signTransaction(mergeTx);

      // Execute merge transaction
      const executeResponse = await fetch(buildApiUrl(API_BASE_URL, `/api/vaults/${proposal.id}/${vaultType}/executeMergeTx`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transaction: Buffer.from(signedTx.serialize({ requireAllSignatures: false })).toString('base64')
        })
      });

      if (!executeResponse.ok) {
        const error = await executeResponse.json();
        throw new Error(error.message || 'Failed to execute merge transaction');
      }

      toast.success('Successfully exited market!', { id: toastId, duration: 5000 });

      // Clear amount and refresh balances
      setAmount('');
      refetchBalances();

    } catch (error) {
      console.error('Exit market failed:', error);
      toast.error(
        `Failed to exit market: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { id: toastId }
      );
    } finally {
      setIsExiting(false);
    }
  }, [authenticated, walletAddress, amount, proposal, selectedToken, userBalances, wallets, refetchBalances]);
  */

  // Calculate PFG percentage to match backend logic
  const pfgPercentage = useMemo(() => {
    // Match backend calculation exactly from app/twap-oracle.ts
    if (twapData.passTwap !== null && twapData.failTwap !== null && twapData.failTwap > 0) {
      const percentage = ((twapData.passTwap - twapData.failTwap) / twapData.failTwap) * 100;
      return percentage;
    }
    return null;
  }, [twapData.passTwap, twapData.failTwap]);

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
        />

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex justify-center overflow-y-auto">
              <div className="w-full max-w-[1332px] 2xl:max-w-[1512px] pt-8 pb-8 px-4 md:px-0">
                <div className="mb-6">
                  <h2 className="text-2xl font-medium" style={{ color: '#E9E9E3' }}>Live Proposal</h2>
                </div>

                {/* 2-column layout: 2/3 left, 1/3 right */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Left Column (2/3 width) */}
                  <div className="contents md:flex md:col-span-2 md:flex-col md:gap-4 md:pb-12">
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
                              PROPOSAL {tokenSlug.toUpperCase()}-{proposal.id}
                              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                              </svg>
                            </h1>
                            <div className={`text-lg font-normal mb-2 ${!isLiveProposalHovered ? 'line-clamp-1' : ''}`} style={{ color: '#E9E9E3' }}>
                              {content.title}
                            </div>
                            <div className={`text-sm description-links ${!isLiveProposalHovered ? 'line-clamp-2' : ''}`} style={{ color: '#DDDDD7' }}>
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
                            <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 hover:border-[#2A2A2A] transition-all duration-300 cursor-pointer h-full">
                              {cardInner}
                            </div>
                          </a>
                        ) : (
                          <div
                            className="flex-[4] bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300"
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
                    <div className="order-4 md:order-2">
                      <ChartBox
                        proposalId={proposal.id}
                        selectedMarket={selectedMarket}
                        trades={trades.filter(trade => trade.market === selectedMarket)}
                        totalVolume={totalVolume}
                        tradesLoading={tradesLoading}
                        getTimeAgo={getTimeAgo}
                        getTokenUsed={getTokenUsed}
                      />
                    </div>
                  </div>

                  {/* Right Column (1/3 width) */}
                  <div className="contents md:flex md:col-span-1 md:flex-col md:gap-4 md:pb-12">
                    {/* Deposit Card */}
                    <div className="order-2 md:order-1">
                      <DepositCard
                        proposalId={proposal.id}
                        solBalance={solBalance}
                        baseTokenBalance={baseTokenBalance}
                        userBalances={userBalances}
                        onDepositSuccess={refetchBalances}
                        moderatorId={moderatorId || undefined}
                        tokenSymbol={tokenSymbol}
                      />
                    </div>

                    {/* Mode Toggle */}
                    <div className="order-3 md:order-2">
                      <ModeToggle
                        isPassMode={isPassMode}
                        onToggle={handleModeToggle}
                        pfgPercentage={pfgPercentage}
                        passMarketCap={marketCaps.pass}
                        failMarketCap={marketCaps.fail}
                      />
                    </div>

                    {/* Trading Interface */}
                    <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300 order-5 md:order-3">
                      <div className="text-white flex flex-col items-center">
                        <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-6 block w-full text-center" style={{ color: '#DDDDD7' }}>
                          III. Trade {selectedMarket === 'pass' ? 'Pass' : 'Fail'} Coin
                        </span>
                        <div className="w-full">
                          <TradingInterface
                            proposalId={proposal.id}
                            selectedMarket={selectedMarket}
                            onMarketChange={handleMarketChange}
                            passPrice={livePrices.pass || 0.5}
                            failPrice={livePrices.fail || 0.5}
                            proposalStatus="Pending"
                            userBalances={userBalances}
                            refetchBalances={refetchBalances}
                            onTradeSuccess={refetchTrades}
                            baseMint={baseMint}
                            tokenSymbol={tokenSymbol}
                          />
                        </div>
                      </div>
                    </div>

                    {/* User Balances - Separate ZC and SOL cards */}
                    <div className="order-6 md:order-4 pb-10 md:pb-0">
                    {(() => {
                      // Calculate if market expired and which tokens are losing
                      const isExpired = proposal.status !== 'Pending';
                      const isShowingLosingTokens = (selectedMarket === 'pass' && proposal.status === 'Failed') ||
                                                     (selectedMarket === 'fail' && proposal.status === 'Passed');

                      // Calculate actual balances
                      const baseTokenBalance = userBalances ? parseFloat(
                        selectedMarket === 'pass' ?
                          userBalances.base.passConditional :
                          userBalances.base.failConditional || '0'
                      ) / 1e6 : 0;

                      const solBalance = userBalances ? parseFloat(
                        selectedMarket === 'pass' ?
                          userBalances.quote.passConditional :
                          userBalances.quote.failConditional || '0'
                      ) / 1e9 : 0;

                      // Zero out if showing losing tokens on expired market
                      const displayBaseTokenBalance = (isExpired && isShowingLosingTokens) ? 0 : baseTokenBalance;
                      const displaySOLBalance = (isExpired && isShowingLosingTokens) ? 0 : solBalance;

                      return (
                    <div className="flex gap-4">
                        {/* Base Token Balance Card */}
                        <div className="flex-1 bg-[#121212] border border-[#191919] rounded-[9px] py-3 px-5 transition-all duration-300">
                          <div className="text-white flex flex-col">
                            <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-6 text-center block" style={{ color: '#DDDDD7' }}>
                              {selectedMarket === 'pass' ? `IV. If Pass ${tokenSymbol} Bal` : `IV. If Fail ${tokenSymbol} Bal`}
                            </span>
                            <div className="group flex items-center justify-center border border-[#191919] rounded-[6px] py-3 px-4 text-lg font-ibm-plex-mono cursor-default" style={{ color: '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace' }}>
                              <span className="group-hover:hidden">
                                {formatNumber(displayBaseTokenBalance, 0)} {selectedMarket === 'pass' ? 'PASS' : 'FAIL'}
                              </span>
                              {baseTokenPrice && (
                                <span className="hidden group-hover:inline">
                                  {formatCurrency(displayBaseTokenBalance * baseTokenPrice, 2)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* SOL Balance Card */}
                        <div className="flex-1 bg-[#121212] border border-[#191919] rounded-[9px] py-3 px-5 transition-all duration-300">
                          <div className="text-white flex flex-col">
                            <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-6 text-center block" style={{ color: '#DDDDD7' }}>
                              {selectedMarket === 'pass' ? 'IV. If Pass SOL Bal' : 'IV. If Fail SOL Bal'}
                            </span>
                            <div className="group flex items-center justify-center border border-[#191919] rounded-[6px] py-3 px-4 text-lg font-ibm-plex-mono cursor-default" style={{ color: '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace' }}>
                              {/* Mobile: 3 decimals */}
                              <span className="group-hover:hidden md:hidden">
                                {formatNumber(displaySOLBalance, 3)} SOL
                              </span>
                              {/* Desktop: 6 decimals */}
                              <span className="group-hover:hidden hidden md:inline">
                                {formatNumber(displaySOLBalance, 6)} SOL
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

                {/* Hidden component for TWAP updates */}
                <div className="hidden">
                  <LivePriceDisplay
                    proposalId={proposal.id}
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
