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

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { ProposalListItem } from '@/types/api';

export interface ExploreProposal extends ProposalListItem {
  moderatorId: number;
  tokenTicker: string;
  tokenIcon: string | null;
  // Futarchy-specific fields
  isFutarchy?: boolean;
  daoPda?: string;
  daoName?: string;
}

/**
 * Hook to fetch all proposals from production pools (ZC, OOGWAY, SURF)
 * Used by the /explore page to show a unified view of all proposals
 */
export function useAllProposals() {
  const [proposals, setProposals] = useState<ExploreProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getAllProposals();
      setProposals(data);
      setError(null);
    } catch (err) {
      console.error('[useAllProposals] Error:', err);
      setError('Failed to fetch proposals');
      setProposals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  return { proposals, loading, error, refetch: fetchProposals };
}
