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

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import ExploreHeader from '@/components/ExploreHeader';
import { useAllProposals } from '@/hooks/useAllProposals';

interface Project {
  moderatorId: number;
  tokenSlug: string;
  tokenTicker: string;
  tokenIcon: string | null;
  proposalCount: number;
  liveProposalCount: number;
}

/**
 * Map moderatorId to token slug for navigation
 */
function getTokenSlug(moderatorId: number): string {
  const mapping: Record<number, string> = {
    2: 'zc',
    3: 'oogway',
    6: 'surf',
  };
  return mapping[moderatorId] || 'zc';
}

export default function ProjectsPage() {
  const router = useRouter();
  const { proposals, loading, error } = useAllProposals();

  // Extract unique projects from proposals
  const projects = useMemo(() => {
    const projectMap = new Map<number, Project>();

    for (const proposal of proposals) {
      const existing = projectMap.get(proposal.moderatorId);
      const isLive = proposal.status === 'Pending';

      if (existing) {
        existing.proposalCount++;
        if (isLive) existing.liveProposalCount++;
      } else {
        projectMap.set(proposal.moderatorId, {
          moderatorId: proposal.moderatorId,
          tokenSlug: getTokenSlug(proposal.moderatorId),
          tokenTicker: proposal.tokenTicker,
          tokenIcon: proposal.tokenIcon,
          proposalCount: 1,
          liveProposalCount: isLive ? 1 : 0,
        });
      }
    }

    // Sort by proposal count descending (most quantum markets first)
    return Array.from(projectMap.values()).sort((a, b) => b.proposalCount - a.proposalCount);
  }, [proposals]);

  if (loading) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#0a0a0a' }}>
        <ExploreHeader />
        <div className="flex items-center justify-center h-[calc(100vh-112px)]">
          <div className="text-[#B0AFAB]">Loading projects...</div>
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
          <h2 className="text-2xl font-medium mb-6" style={{ color: '#E9E9E3' }}>All Combinator Projects</h2>

          {/* Project cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-8">
            {projects.map((project) => (
              <div
                key={project.moderatorId}
                onClick={() => router.push(`/${project.tokenSlug}`)}
                className="bg-[#121212] border border-[#191919] rounded-[9px] p-6 transition-all duration-300 cursor-pointer hover:border-[#2A2A2A] hover:bg-[#151515]"
              >
                <div className="flex items-center gap-4">
                  {/* Token icon */}
                  <div className="w-12 h-12 rounded-full bg-[#1A1A1A] flex items-center justify-center overflow-hidden border border-[#292929]">
                    {project.tokenIcon ? (
                      <Image
                        src={project.tokenIcon}
                        alt={project.tokenTicker}
                        width={48}
                        height={48}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-lg font-semibold" style={{ color: '#DDDDD7' }}>
                        {project.tokenTicker.charAt(0)}
                      </span>
                    )}
                  </div>

                  {/* Token info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-lg font-semibold font-ibm-plex-mono" style={{ color: '#E9E9E3' }}>
                        ${project.tokenTicker}
                      </span>
                      {project.liveProposalCount > 0 && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full animate-pulse" style={{ backgroundColor: '#BEE8FC33', color: '#BEE8FC' }}>
                          LIVE
                        </span>
                      )}
                    </div>
                    <div className="text-sm mt-1" style={{ color: '#6B6E71' }}>
                      {project.proposalCount} Quantum Market{project.proposalCount !== 1 ? 's' : ''}
                    </div>
                  </div>

                  {/* Arrow indicator */}
                  <svg
                    className="w-5 h-5 flex-shrink-0"
                    fill="none"
                    stroke="#6B6E71"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            ))}
          </div>

          {projects.length === 0 && (
            <div className="text-center py-12 text-[#B0AFAB]">
              No projects found
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
