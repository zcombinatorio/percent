import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type { ProposalListItem, ProposalDetailResponse } from '@/types/api';

export function useProposals(poolAddress?: string, moderatorId?: number | string) {
  const [proposals, setProposals] = useState<ProposalListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProposals = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getProposals(poolAddress, moderatorId);

      // Only filter proposals if moderator ID is 2
      const modId = moderatorId?.toString() || process.env.NEXT_PUBLIC_MODERATOR_ID;
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
    fetchProposals();
  }, [fetchProposals]);

  return { proposals, loading, error, refetch: fetchProposals };
}

export function useProposal(id: number) {
  const [proposal, setProposal] = useState<ProposalDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProposal() {
      try {
        setLoading(true);
        const data = await api.getProposal(id);
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
  }, [id]);

  return { proposal, loading, error };
}