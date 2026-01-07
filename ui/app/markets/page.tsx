/*
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This file is part of Z Combinator.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

'use client';

import { useState, useMemo, memo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Masonry from 'react-masonry-css';
import { CheckCircle2 } from 'lucide-react';
import ExploreHeader from '@/components/ExploreHeader';
import { MiniCountdownTimer } from '@/components/MiniCountdownTimer';
import { useAllProposals, type ExploreProposal } from '@/hooks/useAllProposals';
import { getProposalContent, proposalContentMap } from '@/lib/proposalContent';
import { MarkdownText } from '@/lib/renderMarkdown';
import { renderToStaticMarkup } from 'react-dom/server';

// Type for pre-computed proposal data
interface ProposalCardData {
  proposal: ExploreProposal;
  tokenSlug: string;
  proposalContent: ReturnType<typeof getProposalContent>;
  summaryPreview: string;
  isLive: boolean;
}

/**
 * Map moderatorId to token slug for navigation (old system only)
 */
function getTokenSlug(moderatorId: number): string {
  const mapping: Record<number, string> = {
    2: 'zc',
    3: 'oogway',
    6: 'surf',
  };
  return mapping[moderatorId] || 'zc';
}

/**
 * Get the navigation slug for a proposal
 * For futarchy: uses daoName (lowercase)
 * For old system: uses moderatorId mapping
 */
function getProposalSlug(proposal: ExploreProposal): string {
  if (proposal.isFutarchy && proposal.daoName) {
    return proposal.daoName.toLowerCase();
  }
  return getTokenSlug(proposal.moderatorId);
}

/**
 * Get unique key for a proposal's project (DAO or moderator)
 * Used for grouping proposals by project
 */
function getProjectKey(proposal: ExploreProposal): string {
  if (proposal.isFutarchy && proposal.daoPda) {
    return `futarchy-${proposal.daoPda}`;
  }
  return `old-${proposal.moderatorId}`;
}

/**
 * Get summary preview from proposal content
 * For custom rich content: extracts the first section's content (after the first heading)
 * For simple descriptions: returns the description directly (truncated if needed)
 */
function getSummaryPreview(proposal: ExploreProposal, moderatorId: number): string {
  // Check if this proposal has custom rich content (only moderator 2 has custom content)
  const hasCustomContent = moderatorId === 2 && proposalContentMap[proposal.id] !== undefined;

  // For proposals without custom rich content, just return the description directly
  if (!hasCustomContent) {
    const desc = proposal.description || '';
    // Truncate long descriptions
    if (desc.length > 200) {
      return desc.substring(0, 200).trim() + '...';
    }
    return desc;
  }

  // For proposals with custom rich content, extract summary from rendered content
  const proposalContent = getProposalContent(proposal.id, proposal.title, proposal.description, moderatorId.toString());

  if (!proposalContent.content) {
    return proposal.description || '';
  }

  try {
    const htmlString = renderToStaticMarkup(proposalContent.content as React.ReactElement);

    // Strip HTML tags and decode entities
    const plainText = htmlString
      .replace(/<[^>]*>/g, '\n')
      .replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<')
      .replace(/&amp;/g, '&')
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/\n+/g, '\n')
      .trim();

    // Split into lines and find the first "section"
    const lines = plainText.split('\n').filter(line => line.trim());

    if (lines.length >= 2) {
      // Skip the first line (heading like "Executive Summary" or "The Decision")
      // Return the content of the first section (lines until next short heading-like line)
      const contentLines: string[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        // Stop if we hit what looks like another heading (short line, often bold markers removed)
        // Headings are typically short (< 50 chars) and followed by longer content
        if (contentLines.length > 0 && line.length < 50 && lines[i + 1] && lines[i + 1].length > line.length * 2) {
          break;
        }
        contentLines.push(line);
        // Limit to first ~3 lines of content for preview
        if (contentLines.length >= 3) break;
      }

      if (contentLines.length > 0) {
        return contentLines.join(' ').replace(/\s+/g, ' ').trim();
      }
    }

    // Fallback: just return first 200 chars
    return plainText.substring(0, 200).trim() + (plainText.length > 200 ? '...' : '');
  } catch {
    // Fall back to description
  }

  return proposal.description || '';
}

/**
 * Memoized proposal card component
 * Only re-renders when its specific props change, not when other cards hover
 */
interface ProposalCardProps {
  data: ProposalCardData;
  isHovered: boolean;
  onHover: (proposalId: number, moderatorId: number) => void;
  onLeave: () => void;
  onClick: () => void;
  isMobile?: boolean;
}

const ProposalCard = memo(function ProposalCard({
  data,
  isHovered,
  onHover,
  onLeave,
  onClick,
  isMobile = false,
}: ProposalCardProps) {
  const { proposal, tokenSlug, proposalContent, summaryPreview, isLive } = data;

  const handleMouseEnter = useCallback(() => {
    onHover(proposal.id, proposal.moderatorId);
  }, [onHover, proposal.id, proposal.moderatorId]);

  return (
    <div
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onLeave}
      className={`bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300 overflow-hidden cursor-pointer hover:border-[#2A2A2A] ${isMobile ? '' : 'ml-4 mb-4'}`}
    >
      <div className="text-white flex flex-col min-w-0">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2 mb-6">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Token badge */}
            <div className="flex items-center gap-1.5">
              {proposal.tokenIcon && (
                <Image
                  src={proposal.tokenIcon}
                  alt={proposal.tokenTicker}
                  width={16}
                  height={16}
                  className="rounded-full"
                />
              )}
              <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em]" style={{ color: '#DDDDD7' }}>
                {tokenSlug.toUpperCase()}-{proposal.id}
              </span>
            </div>

            {/* Status badge */}
            {!isLive && proposal.winningMarketLabel && (
              <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-normal rounded-full" style={{ backgroundColor: '#BEE8FC33', color: '#BEE8FC' }}>
                {proposal.winningMarketLabel}
                <CheckCircle2 className="w-3 h-3" />
              </span>
            )}
          </div>

          {/* Date or Countdown */}
          {isLive ? (
            <MiniCountdownTimer endsAt={proposal.endsAt || proposal.finalizedAt} />
          ) : (
            <div className="text-sm text-[#B0AFAB]">
              {new Date(proposal.finalizedAt).toLocaleDateString('en-US', {
                month: 'numeric',
                day: 'numeric'
              })}
            </div>
          )}
        </div>

        {/* Title */}
        <div className="text-lg font-normal mb-2" style={{ color: '#E9E9E3' }}>
          <MarkdownText>{proposalContent.title}</MarkdownText>
        </div>

        {/* Description preview */}
        <div className={`text-sm ${isMobile ? 'break-all' : ''}`} style={{ color: '#DDDDD7' }}>
          {isHovered ? (
            proposalContent.content || <MarkdownText>{proposal.description}</MarkdownText>
          ) : (
            <MarkdownText>{summaryPreview}</MarkdownText>
          )}
        </div>
      </div>
    </div>
  );
});

export default function ExplorePage() {
  const router = useRouter();
  const { proposals, loading, error } = useAllProposals();
  const [hoveredProposalId, setHoveredProposalId] = useState<number | null>(null);
  const [hoveredModeratorId, setHoveredModeratorId] = useState<number | null>(null);

  // Pre-compute all derived data once when proposals change
  // This prevents expensive re-computations on hover
  const proposalCardData = useMemo(() => {
    const live = proposals.filter(p => p.status === 'Pending').sort((a, b) => (a.endsAt || a.finalizedAt) - (b.endsAt || b.finalizedAt));
    const historical = proposals.filter(p => p.status !== 'Pending').sort((a, b) => b.finalizedAt - a.finalizedAt);
    const sorted = [...live, ...historical];

    return sorted.map((proposal): ProposalCardData => {
      const tokenSlug = getProposalSlug(proposal);
      const proposalContent = getProposalContent(proposal.id, proposal.title, proposal.description, proposal.moderatorId.toString());
      const summaryPreview = getSummaryPreview(proposal, proposal.moderatorId);
      const isLive = proposal.status === 'Pending';

      return { proposal, tokenSlug, proposalContent, summaryPreview, isLive };
    });
  }, [proposals]);

  // Compute the most recent proposal ID for each project (DAO or moderator)
  // Most recent = live proposal, or highest ID if none are live
  // Uses project key to handle both old system (moderatorId) and futarchy (daoPda)
  const latestProposalByProject = useMemo(() => {
    const latest = new Map<string, number>();
    for (const proposal of proposals) {
      const projectKey = getProjectKey(proposal);
      const current = latest.get(projectKey);
      if (current === undefined) {
        latest.set(projectKey, proposal.id);
      } else {
        // Prefer live proposals, otherwise take higher ID
        const currentProposal = proposals.find(p => getProjectKey(p) === projectKey && p.id === current);
        const isCurrentLive = currentProposal?.status === 'Pending';
        const isNewLive = proposal.status === 'Pending';

        if (isNewLive && !isCurrentLive) {
          latest.set(projectKey, proposal.id);
        } else if (!isNewLive && isCurrentLive) {
          // Keep current (it's live)
        } else if (proposal.id > current) {
          latest.set(projectKey, proposal.id);
        }
      }
    }
    return latest;
  }, [proposals]);

  // Memoized callbacks to prevent re-renders
  const handleHover = useCallback((proposalId: number, moderatorId: number) => {
    setHoveredProposalId(proposalId);
    setHoveredModeratorId(moderatorId);
  }, []);

  const handleLeave = useCallback(() => {
    setHoveredProposalId(null);
    setHoveredModeratorId(null);
  }, []);

  const handleCardClick = useCallback((proposal: ExploreProposal) => {
    const slug = getProposalSlug(proposal);
    const projectKey = getProjectKey(proposal);
    const latestId = latestProposalByProject.get(projectKey);
    const isHistorical = latestId !== proposal.id;
    router.push(`/${slug}${isHistorical ? '?historical=true' : ''}`);
  }, [router, latestProposalByProject]);

  if (loading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#0a0a0a' }}>
        <ExploreHeader />
        <div className="flex items-center justify-center h-[calc(100vh-112px)]">
          <div className="text-[#B0AFAB]">Loading proposals...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#0a0a0a' }}>
        <ExploreHeader />
        <div className="flex items-center justify-center h-[calc(100vh-112px)]">
          <div className="text-red-400">{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0a0a0a' }}>
      <ExploreHeader />

      <main className="flex justify-center">
        <div className="w-full max-w-[1332px] 2xl:max-w-[1512px] pt-8 px-4 md:px-0">
          {/* Page heading */}
          <h2 className="text-2xl font-medium mb-6" style={{ color: '#E9E9E3' }}>All Quantum Markets</h2>

          {/* Mobile: Simple vertical stack */}
          <div className="md:hidden flex flex-col gap-4 pb-8">
            {proposalCardData.map((data) => (
              <ProposalCard
                key={`mobile-${data.proposal.moderatorId}-${data.proposal.id}`}
                data={data}
                isHovered={hoveredProposalId === data.proposal.id && hoveredModeratorId === data.proposal.moderatorId}
                onHover={handleHover}
                onLeave={handleLeave}
                onClick={() => handleCardClick(data.proposal)}
                isMobile
              />
            ))}
          </div>

          {/* Desktop: Masonry layout */}
          <div className="hidden md:block">
            <Masonry
              breakpointCols={3}
              className="flex w-auto pb-8"
              columnClassName="bg-clip-padding"
              style={{ marginLeft: '-16px' }}
            >
              {proposalCardData.map((data) => (
                <ProposalCard
                  key={`desktop-${data.proposal.moderatorId}-${data.proposal.id}`}
                  data={data}
                  isHovered={hoveredProposalId === data.proposal.id && hoveredModeratorId === data.proposal.moderatorId}
                  onHover={handleHover}
                  onLeave={handleLeave}
                  onClick={() => handleCardClick(data.proposal)}
                />
              ))}
            </Masonry>
          </div>

          {proposalCardData.length === 0 && (
            <div className="text-center py-12 text-[#B0AFAB]">
              No proposals found
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
