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
import type { ProposalListItem, ProposalDetailResponse } from '@/types/api';

interface UseProposalsOptions {
  poolAddress?: string;
  moderatorId?: number | string;
  // Futarchy-specific options (new system)
  isFutarchy?: boolean;
  daoPda?: string;
}

export function useProposals(poolAddress?: string, moderatorId?: number | string) {
  const [proposals, setProposals] = useState<ProposalListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getProposals(poolAddress, moderatorId);

      // Server already filters by moderatorId, client-side filter only for legacy proposal exclusion
      const modId = moderatorId?.toString();
      const filteredData = modId === '2'
        ? data.filter(p => ![0, 1, 2, 6, 7].includes(p.id))
        : data;

      setProposals(filteredData);
      setError(null);
    } catch (err) {
      console.error('Error fetching proposals:', err);
      setError('Failed to fetch proposals');
      setProposals([]);
    } finally {
      setLoading(false);
    }
  }, [poolAddress, moderatorId]);

  useEffect(() => {
    // Only fetch if moderatorId is provided (not null or undefined) to avoid defaulting to moderator 1
    if (moderatorId != null) {
      fetchProposals();
    }
  }, [fetchProposals, moderatorId]);

  return { proposals, loading, error, refetch: fetchProposals };
}

/**
 * Hook to fetch proposals with futarchy support.
 * For futarchy DAOs, fetches from zcombinator API.
 * For old system DAOs, fetches from os-percent API.
 */
export function useProposalsWithFutarchy(options: UseProposalsOptions) {
  const { poolAddress, moderatorId, isFutarchy, daoPda } = options;
  const [proposals, setProposals] = useState<ProposalListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);

      let data: ProposalListItem[];

      if (isFutarchy && daoPda) {
        // Fetch from zcombinator API for futarchy DAOs
        data = await api.getZcombinatorProposals(daoPda);
      } else if (moderatorId != null) {
        // Fetch from old system API
        data = await api.getProposals(poolAddress, moderatorId);

        // Server already filters by moderatorId, client-side filter only for legacy proposal exclusion
        const modId = moderatorId?.toString();
        if (modId === '2') {
          data = data.filter(p => ![0, 1, 2, 6, 7].includes(p.id));
        }
      } else {
        // No valid identifier, return empty
        data = [];
      }

      setProposals(data);
      setError(null);
    } catch (err) {
      console.error('Error fetching proposals:', err);
      setError('Failed to fetch proposals');
      setProposals([]);
    } finally {
      setLoading(false);
    }
  }, [poolAddress, moderatorId, isFutarchy, daoPda]);

  useEffect(() => {
    // For futarchy, we need daoPda; for old system, we need moderatorId
    if ((isFutarchy && daoPda) || (!isFutarchy && moderatorId != null)) {
      fetchProposals();
    } else {
      setLoading(false);
    }
  }, [fetchProposals, isFutarchy, daoPda, moderatorId]);

  return { proposals, loading, error, refetch: fetchProposals };
}

export function useProposal(id: number, moderatorId?: number | string) {
  const [proposal, setProposal] = useState<ProposalDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProposal() {
      try {
        setLoading(true);
        const data = await api.getProposal(id, moderatorId);
        setProposal(data);
      } catch (err) {
        console.error('Error fetching proposal:', err);
        setError('Failed to fetch proposal');
        setProposal(null);
      } finally {
        setLoading(false);
      }
    }

    fetchProposal();
  }, [id, moderatorId]);

  return { proposal, loading, error };
}

