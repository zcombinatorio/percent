'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import { usePrivyWallet } from '@/hooks/usePrivyWallet';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useTokenPrices } from '@/hooks/useTokenPrices';
import Header from '@/components/Header';
import { useProposals } from '@/hooks/useProposals';
import { useClaimablePositions } from '@/hooks/useClaimablePositions';
import { formatNumber } from '@/lib/formatters';
import { useSolanaWallets } from '@privy-io/react-auth/solana';
import { Transaction } from '@solana/web3.js';
import toast from 'react-hot-toast';
import { getProposalContent } from '@/lib/proposalContent';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckCircle2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { claimWinnings } from '@/lib/trading';
import Masonry from 'react-masonry-css';
import { ProposalVolume } from '@/components/ProposalVolume';
import { useTokenContext } from '@/providers/TokenContext';

export default function HistoryPage() {
  const { tokenSlug, poolAddress, baseMint, baseDecimals, tokenSymbol, moderatorId, icon } = useTokenContext();
  const { ready, authenticated, user, walletAddress, login } = usePrivyWallet();
  const { proposals, loading, refetch } = useProposals(poolAddress || undefined, moderatorId || undefined);
  const [hoveredProposalId, setHoveredProposalId] = useState<number | null>(null);
  const [proposalPfgs, setProposalPfgs] = useState<Record<number, number>>({});
  const [claimingProposalId, setClaimingProposalId] = useState<number | null>(null);

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

  // Fetch claimable positions for history view
  const { positions: claimablePositions, refetch: refetchClaimable } = useClaimablePositions(walletAddress, moderatorId || undefined);

  // Transaction signer helper for claiming
  const createTransactionSigner = useCallback(() => {
    return async (transaction: Transaction) => {
      const wallet = wallets[0];
      if (!wallet) throw new Error('No Solana wallet found');
      return await wallet.signTransaction(transaction);
    };
  }, [wallets]);

  // Handle claim from history card
  const handleClaimFromHistory = useCallback(async (
    proposalId: number,
    proposalStatus: 'Passed' | 'Failed',
    proposalRewards: Array<{ claimableToken: 'sol' | 'zc', claimableAmount: number, positionType: 'pass' | 'fail' }>
  ) => {
    if (!authenticated) {
      login();
      return;
    }

    if (!walletAddress) {
      toast.error('No wallet address found');
      return;
    }

    if (proposalRewards.length === 0) {
      toast.error('No position to claim');
      return;
    }

    // Determine user position type from rewards
    const userPositionType = proposalRewards[0].positionType;
    const userPosition = { type: userPositionType };

    setClaimingProposalId(proposalId);

    try {
      await claimWinnings({
        proposalId,
        proposalStatus,
        userPosition,
        userAddress: walletAddress,
        signTransaction: createTransactionSigner(),
        moderatorId: moderatorId || undefined
      });

      // Refresh claimable positions to update UI
      refetchClaimable();

    } catch (error) {
      console.error('Claim failed:', error);
      // Error toast is already shown by claimWinnings function
    } finally {
      setClaimingProposalId(null);
    }
  }, [authenticated, login, walletAddress, createTransactionSigner, refetchClaimable]);

  // Memoize sorted proposals
  const sortedProposals = useMemo(() =>
    [...proposals].sort((a, b) => b.finalizedAt - a.finalizedAt),
    [proposals]
  );

  // Fetch TWAP data for all finalized proposals
  useEffect(() => {
    if (sortedProposals.length > 0) {
      const fetchPfgs = async () => {
        const pfgMap: Record<number, number> = {};

        for (const proposal of sortedProposals) {
          if (proposal.status === 'Passed' || proposal.status === 'Failed') {
            const twapData = await api.getTWAP(proposal.id, moderatorId || undefined);
            if (twapData && twapData.failTwap > 0) {
              const pfg = ((twapData.passTwap - twapData.failTwap) / twapData.failTwap) * 100;
              pfgMap[proposal.id] = pfg;
            }
          }
        }

        setProposalPfgs(pfgMap);
      };

      fetchPfgs();
    }
  }, [sortedProposals]);

  // Calculate total balance
  const hasWalletBalance = (solBalance > 0 || baseTokenBalance > 0);

  return (
    <div className="flex h-screen" style={{ backgroundColor: '#0a0a0a' }}>
      <div className="flex-1 flex flex-col overflow-hidden">
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

        <div className="flex-1 flex justify-center overflow-y-auto">
          <div className="w-full max-w-[1332px] 2xl:max-w-[1512px] pt-8 px-4 md:px-0">
            <div className="mb-6">
              <h2 className="text-2xl font-medium" style={{ color: '#E9E9E3' }}>History</h2>
            </div>
            {/* Mobile: Simple vertical stack */}
            <div className="md:hidden flex flex-col gap-4 pb-8">
              {sortedProposals
                .filter(proposal => proposal.status === 'Passed' || proposal.status === 'Failed')
                .map((proposal) => {
                const proposalContent = getProposalContent(proposal.id, proposal.title, proposal.description, moderatorId?.toString());
                const isHovered = hoveredProposalId === proposal.id;

                // Extract first section (Executive Summary) for preview
                let summaryPreview = proposal.description;
                if (proposalContent.content) {
                  try {
                    const htmlString = renderToStaticMarkup(proposalContent.content as React.ReactElement);
                    // Extract content between first and second <h3> tags (the first section)
                    const sections = htmlString.split(/<h3/);
                    if (sections.length > 1) {
                      // Get the first section with its heading
                      const firstSectionWithHeading = '<h3' + sections[1];
                      // Extract up to the closing tag of the section or next heading
                      const sectionEnd = sections.length > 2 ? firstSectionWithHeading.indexOf('</div>') : firstSectionWithHeading.length;
                      const firstSection = sectionEnd > 0 ? firstSectionWithHeading.substring(0, sectionEnd) : firstSectionWithHeading;

                      summaryPreview = firstSection
                        .replace(/<[^>]*>/g, ' ')
                        .replace(/&gt;/g, '>')
                        .replace(/&lt;/g, '<')
                        .replace(/&amp;/g, '&')
                        .replace(/&apos;/g, "'")
                        .replace(/&quot;/g, '"')
                        .replace(/\s+/g, ' ')
                        .trim()
                        // Remove "Executive Summary" or "Summary" heading text
                        .replace(/^(Executive Summary|Summary)\s+/i, '');
                    }
                  } catch (e) {
                    summaryPreview = proposal.description;
                  }
                }

                // Get claimable rewards for this proposal
                const proposalRewards = claimablePositions.filter(pos => pos.proposalId === proposal.id);
                const hasClaimableRewards = proposalRewards.length > 0;
                const isCurrentlyClaiming = claimingProposalId === proposal.id;

                return (
                  <div
                    key={proposal.id}
                    onMouseEnter={() => setHoveredProposalId(proposal.id)}
                    onMouseLeave={() => setHoveredProposalId(null)}
                    onClick={() => {
                      if (hasClaimableRewards && !isCurrentlyClaiming) {
                        handleClaimFromHistory(
                          proposal.id,
                          proposal.status as 'Passed' | 'Failed',
                          proposalRewards
                        );
                      }
                    }}
                    className={`bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300 ${
                      hasClaimableRewards ? 'cursor-pointer hover:border-[#2A2A2A]' : ''
                    } ${isCurrentlyClaiming ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    <div className="text-white flex flex-col">
                      <div className="flex items-center justify-between gap-2 mb-6">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em]" style={{ color: '#DDDDD7' }}>{tokenSlug.toUpperCase()}-{proposal.id}</div>
                          {proposal.status === 'Passed' && (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-normal rounded-full" style={{ backgroundColor: '#6ECC9433', color: '#6ECC94' }}>
                              Pass
                              <CheckCircle2 className="w-3 h-3" />
                            </span>
                          )}
                          {proposal.status === 'Failed' && (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-normal rounded-full" style={{ backgroundColor: '#FF6F9433', color: '#FF6F94' }}>
                              Fail
                              <XCircle className="w-3 h-3" />
                            </span>
                          )}
                          {proposalPfgs[proposal.id] !== undefined && (
                            <span className="px-2 py-0.5 text-xs font-normal rounded-full" style={{ backgroundColor: '#BEE8FC33', color: '#BEE8FC' }}>
                              PFG: {proposalPfgs[proposal.id].toFixed(1)}%
                            </span>
                          )}
                          <ProposalVolume proposalId={proposal.id} moderatorId={moderatorId ?? undefined} baseMint={baseMint} />
                        </div>
                        <div className="text-sm text-[#B0AFAB]">
                          {new Date(proposal.finalizedAt).toLocaleDateString('en-US', {
                            month: 'numeric',
                            day: 'numeric'
                          })}
                        </div>
                      </div>

                      <div className="text-lg font-normal mb-2" style={{ color: '#E9E9E3' }}>{proposalContent.title}</div>

                      {/* Show summary or full content based on hover */}
                      <div className={`text-sm ${proposalRewards.length > 0 ? 'mb-6' : ''}`} style={{ color: '#DDDDD7' }}>
                        {isHovered ? (
                          proposalContent.content || <p>{proposal.description}</p>
                        ) : (
                          summaryPreview
                        )}
                      </div>

                      {/* Only show claim row if user has claimable rewards */}
                      {proposalRewards.length > 0 && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <div className="relative flex items-center justify-center">
                              <div className="w-2 h-2 rounded-full absolute" style={{ backgroundColor: '#BEE8FC', opacity: 0.75, animation: 'ping 3s cubic-bezier(0, 0, 0.2, 1) infinite' }}></div>
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#BEE8FC' }}></div>
                            </div>
                            <span className="text-sm" style={{ color: '#BEE8FC' }}>Click to claim</span>
                          </div>

                          {/* Rewards display */}
                          <div className="text-sm" style={{ color: '#BEE8FC' }}>
                            {(() => {
                              const zcReward = proposalRewards.find(r => r.claimableToken === 'zc');
                              const solReward = proposalRewards.find(r => r.claimableToken === 'sol');

                              const parts = [];
                              if (zcReward) {
                                parts.push(`${formatNumber(zcReward.claimableAmount, 0)} ZC`);
                              }
                              if (solReward) {
                                parts.push(`${solReward.claimableAmount.toFixed(4)} SOL`);
                              }

                              return parts.join(' / ');
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Desktop: Masonry layout */}
            <div className="hidden md:block">
              <Masonry
                breakpointCols={3}
                className="flex w-auto pb-8"
                columnClassName="bg-clip-padding"
                style={{ marginLeft: '-16px' }}
              >
                {sortedProposals
                  .filter(proposal => proposal.status === 'Passed' || proposal.status === 'Failed')
                  .map((proposal) => {
                  const proposalContent = getProposalContent(proposal.id, proposal.title, proposal.description, moderatorId?.toString());
                  const isHovered = hoveredProposalId === proposal.id;

                  // Extract first section (Executive Summary) for preview
                  let summaryPreview = proposal.description;
                  if (proposalContent.content) {
                    try {
                      const htmlString = renderToStaticMarkup(proposalContent.content as React.ReactElement);
                      // Extract content between first and second <h3> tags (the first section)
                      const sections = htmlString.split(/<h3/);
                      if (sections.length > 1) {
                        // Get the first section with its heading
                        const firstSectionWithHeading = '<h3' + sections[1];
                        // Extract up to the closing tag of the section or next heading
                        const sectionEnd = sections.length > 2 ? firstSectionWithHeading.indexOf('</div>') : firstSectionWithHeading.length;
                        const firstSection = sectionEnd > 0 ? firstSectionWithHeading.substring(0, sectionEnd) : firstSectionWithHeading;

                        summaryPreview = firstSection
                          .replace(/<[^>]*>/g, ' ')
                          .replace(/&gt;/g, '>')
                          .replace(/&lt;/g, '<')
                          .replace(/&amp;/g, '&')
                          .replace(/&apos;/g, "'")
                          .replace(/&quot;/g, '"')
                          .replace(/\s+/g, ' ')
                          .trim()
                          // Remove "Executive Summary" or "Summary" heading text
                          .replace(/^(Executive Summary|Summary)\s+/i, '');
                      }
                    } catch (e) {
                      summaryPreview = proposal.description;
                    }
                  }

                  // Get claimable rewards for this proposal
                  const proposalRewards = claimablePositions.filter(pos => pos.proposalId === proposal.id);
                  const hasClaimableRewards = proposalRewards.length > 0;
                  const isCurrentlyClaiming = claimingProposalId === proposal.id;

                  return (
                    <div
                      key={proposal.id}
                      onMouseEnter={() => setHoveredProposalId(proposal.id)}
                      onMouseLeave={() => setHoveredProposalId(null)}
                      onClick={() => {
                        if (hasClaimableRewards && !isCurrentlyClaiming) {
                          handleClaimFromHistory(
                            proposal.id,
                            proposal.status as 'Passed' | 'Failed',
                            proposalRewards
                          );
                        }
                      }}
                      className={`bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300 ml-4 mb-4 ${
                        hasClaimableRewards ? 'cursor-pointer hover:border-[#2A2A2A]' : ''
                      } ${isCurrentlyClaiming ? 'opacity-60 pointer-events-none' : ''}`}
                    >
                      <div className="text-white flex flex-col">
                        <div className="flex items-center justify-between gap-2 mb-6">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em]" style={{ color: '#DDDDD7' }}>{tokenSlug.toUpperCase()}-{proposal.id}</div>
                            {proposal.status === 'Passed' && (
                              <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-normal rounded-full" style={{ backgroundColor: '#6ECC9433', color: '#6ECC94' }}>
                                Pass
                                <CheckCircle2 className="w-3 h-3" />
                              </span>
                            )}
                            {proposal.status === 'Failed' && (
                              <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-normal rounded-full" style={{ backgroundColor: '#FF6F9433', color: '#FF6F94' }}>
                                Fail
                                <XCircle className="w-3 h-3" />
                              </span>
                            )}
                            {proposalPfgs[proposal.id] !== undefined && (
                              <span className="px-2 py-0.5 text-xs font-normal rounded-full" style={{ backgroundColor: '#BEE8FC33', color: '#BEE8FC' }}>
                                PFG: {proposalPfgs[proposal.id].toFixed(1)}%
                              </span>
                            )}
                            <ProposalVolume proposalId={proposal.id} moderatorId={moderatorId ?? undefined} baseMint={baseMint} />
                          </div>
                          <div className="text-sm text-[#B0AFAB]">
                            {new Date(proposal.finalizedAt).toLocaleDateString('en-US', {
                              month: 'numeric',
                              day: 'numeric'
                            })}
                          </div>
                        </div>

                        <div className="text-lg font-normal mb-2" style={{ color: '#E9E9E3' }}>{proposalContent.title}</div>

                        {/* Show summary or full content based on hover */}
                        <div className={`text-sm ${proposalRewards.length > 0 ? 'mb-6' : ''}`} style={{ color: '#DDDDD7' }}>
                          {isHovered ? (
                            proposalContent.content || <p>{proposal.description}</p>
                          ) : (
                            summaryPreview
                          )}
                        </div>

                        {/* Only show claim row if user has claimable rewards */}
                        {proposalRewards.length > 0 && (
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5">
                              <div className="relative flex items-center justify-center">
                                <div className="w-2 h-2 rounded-full absolute" style={{ backgroundColor: '#BEE8FC', opacity: 0.75, animation: 'ping 3s cubic-bezier(0, 0, 0.2, 1) infinite' }}></div>
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#BEE8FC' }}></div>
                              </div>
                              <span className="text-sm" style={{ color: '#BEE8FC' }}>Click to claim</span>
                            </div>

                            {/* Rewards display */}
                            <div className="text-sm" style={{ color: '#BEE8FC' }}>
                              {(() => {
                                const zcReward = proposalRewards.find(r => r.claimableToken === 'zc');
                                const solReward = proposalRewards.find(r => r.claimableToken === 'sol');

                                const parts = [];
                                if (zcReward) {
                                  parts.push(`${formatNumber(zcReward.claimableAmount, 0)} ZC`);
                                }
                                if (solReward) {
                                  parts.push(`${solReward.claimableAmount.toFixed(4)} SOL`);
                                }

                                return parts.join(' / ');
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Masonry>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
