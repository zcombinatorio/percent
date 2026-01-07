'use client';

import { useState, useMemo, useCallback } from 'react';
import { usePrivyWallet } from '@/hooks/usePrivyWallet';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useTokenPrices } from '@/hooks/useTokenPrices';
import { useTransactionSigner } from '@/hooks/useTransactionSigner';
import Header from '@/components/Header';
import { useProposalsWithFutarchy } from '@/hooks/useProposals';
import { useClaimablePositions } from '@/hooks/useClaimablePositions';
import { formatNumber } from '@/lib/formatters';
import toast from 'react-hot-toast';
import { getProposalContent } from '@/lib/proposalContent';
import { getOverriddenLabel } from '@/lib/proposal-overrides';
import { MarkdownText } from '@/lib/renderMarkdown';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckCircle2 } from 'lucide-react';
import { claimWinnings } from '@/lib/trading';
import Masonry from 'react-masonry-css';
import { ProposalVolume } from '@/components/ProposalVolume';
import { useTokenContext } from '@/providers/TokenContext';

export default function HistoryPage() {
  const { tokenSlug, poolAddress, baseMint, baseDecimals, tokenSymbol, moderatorId, icon, isFutarchy, daoPda } = useTokenContext();
  const { ready, authenticated, user, walletAddress, login } = usePrivyWallet();
  const { proposals, loading, refetch } = useProposalsWithFutarchy({
    poolAddress: poolAddress || undefined,
    moderatorId: moderatorId ?? undefined,
    isFutarchy,
    daoPda: daoPda || undefined,
  });
  const [hoveredProposalId, setHoveredProposalId] = useState<number | null>(null);
  const [claimingProposalId, setClaimingProposalId] = useState<number | null>(null);

  // Fetch wallet balances for current token
  const { sol: solBalance, baseToken: baseTokenBalance, refetch: refetchWalletBalances } = useWalletBalances({
    walletAddress,
    baseMint,
    baseDecimals,
  });

  // Fetch token prices for USD conversion
  const { sol: solPrice, baseToken: baseTokenPrice } = useTokenPrices(baseMint);

  // Get transaction signer
  const { signTransaction } = useTransactionSigner();

  // Fetch claimable positions for history view (skip for futarchy DAOs - different claiming mechanism)
  const { positions: claimablePositions, refetch: refetchClaimable } = useClaimablePositions(walletAddress, moderatorId || undefined, isFutarchy);

  // Handle claim from history card
  const handleClaimFromHistory = useCallback(async (
    proposalId: number,
    winningMarketIndex: number,
    vaultPDA: string
  ) => {
    if (!authenticated) {
      login();
      return;
    }

    // Check if Privy SDK is fully ready - embedded wallet needs to be initialized
    if (!ready) {
      toast.error('Wallet initializing, please try again in a moment');
      return;
    }

    if (!walletAddress) {
      toast.error('No wallet address found');
      return;
    }

    setClaimingProposalId(proposalId);

    try {
      await claimWinnings({
        proposalId,
        winningMarketIndex,
        vaultPDA,
        userAddress: walletAddress,
        signTransaction,
      });

      // Refresh all balances after successful claim
      refetchClaimable();
      refetchWalletBalances();

    } catch (error) {
      console.error('Claim failed:', error);
      // Error toast is already shown by claimWinnings function
    } finally {
      setClaimingProposalId(null);
    }
  }, [authenticated, ready, login, walletAddress, signTransaction, refetchClaimable, refetchWalletBalances]);

  // Memoize sorted proposals - use endsAt for futarchy, finalizedAt for old system
  const sortedProposals = useMemo(() =>
    [...proposals].sort((a, b) => (b.endsAt || b.finalizedAt) - (a.endsAt || a.finalizedAt)),
    [proposals]
  );

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
          baseMint={baseMint}
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
                      if (hasClaimableRewards && !isCurrentlyClaiming && proposal.winningMarketIndex !== null && proposal.winningMarketIndex !== undefined) {
                        handleClaimFromHistory(
                          proposal.id,
                          proposal.winningMarketIndex,
                          proposal.vaultPDA
                        );
                      }
                    }}
                    className={`bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300 overflow-hidden ${
                      hasClaimableRewards ? 'cursor-pointer hover:border-[#2A2A2A]' : ''
                    } ${isCurrentlyClaiming ? 'opacity-60 pointer-events-none' : ''}`}
                  >
                    <div className="text-white flex flex-col min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-6">
                        <div className="flex items-center gap-2 flex-wrap">
                          <div className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em]" style={{ color: '#DDDDD7' }}>{tokenSlug.toUpperCase()}-{proposal.id}</div>
                          {proposal.winningMarketLabel && (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-normal rounded-full" style={{ backgroundColor: '#BEE8FC33', color: '#BEE8FC' }}>
                              {getOverriddenLabel(proposal.winningMarketLabel, moderatorId, proposal.id, proposal.winningMarketIndex)}
                              <CheckCircle2 className="w-3 h-3" />
                            </span>
                          )}
                          <ProposalVolume proposalId={proposal.id} moderatorId={moderatorId ?? undefined} baseMint={baseMint} isFutarchy={isFutarchy} />
                        </div>
                        <div className="text-sm text-[#B0AFAB]">
                          {new Date(proposal.finalizedAt).toLocaleDateString('en-US', {
                            month: 'numeric',
                            day: 'numeric'
                          })}
                        </div>
                      </div>

                      <div className="text-lg font-normal mb-2" style={{ color: '#E9E9E3' }}><MarkdownText>{proposalContent.title}</MarkdownText></div>

                      {/* Show summary or full content based on hover */}
                      <div className={`text-sm break-all ${proposalRewards.length > 0 ? 'mb-6' : ''}`} style={{ color: '#DDDDD7' }}>
                        {isHovered ? (
                          proposalContent.content || <MarkdownText>{proposal.description}</MarkdownText>
                        ) : (
                          <MarkdownText>{summaryPreview}</MarkdownText>
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
                                parts.push(`${formatNumber(zcReward.claimableAmount, 0)} ${tokenSymbol}`);
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
                        if (hasClaimableRewards && !isCurrentlyClaiming && proposal.winningMarketIndex !== null && proposal.winningMarketIndex !== undefined) {
                          handleClaimFromHistory(
                            proposal.id,
                            proposal.winningMarketIndex,
                            proposal.vaultPDA
                          );
                        }
                      }}
                      className={`bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300 ml-4 mb-4 overflow-hidden ${
                        hasClaimableRewards ? 'cursor-pointer hover:border-[#2A2A2A]' : ''
                      } ${isCurrentlyClaiming ? 'opacity-60 pointer-events-none' : ''}`}
                    >
                      <div className="text-white flex flex-col min-w-0">
                        <div className="flex items-center justify-between gap-2 mb-6">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em]" style={{ color: '#DDDDD7' }}>{tokenSlug.toUpperCase()}-{proposal.id}</div>
                            {proposal.winningMarketLabel && (
                              <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-normal rounded-full" style={{ backgroundColor: '#BEE8FC33', color: '#BEE8FC' }}>
                                {getOverriddenLabel(proposal.winningMarketLabel, moderatorId, proposal.id, proposal.winningMarketIndex)}
                                <CheckCircle2 className="w-3 h-3" />
                              </span>
                            )}
                            <ProposalVolume proposalId={proposal.id} moderatorId={moderatorId ?? undefined} baseMint={baseMint} isFutarchy={isFutarchy} />
                          </div>
                          <div className="text-sm text-[#B0AFAB]">
                            {new Date(proposal.finalizedAt).toLocaleDateString('en-US', {
                              month: 'numeric',
                              day: 'numeric'
                            })}
                          </div>
                        </div>

                        <div className="text-lg font-normal mb-2" style={{ color: '#E9E9E3' }}><MarkdownText>{proposalContent.title}</MarkdownText></div>

                        {/* Show summary or full content based on hover */}
                        <div className={`text-sm ${proposalRewards.length > 0 ? 'mb-6' : ''}`} style={{ color: '#DDDDD7' }}>
                          {isHovered ? (
                            proposalContent.content || <MarkdownText>{proposal.description}</MarkdownText>
                          ) : (
                            <MarkdownText>{summaryPreview}</MarkdownText>
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
                                  parts.push(`${formatNumber(zcReward.claimableAmount, 0)} ${tokenSymbol}`);
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
