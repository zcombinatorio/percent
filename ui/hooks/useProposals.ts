import { useState, useEffect } from 'react';
import { api, ProposalResponse } from '@/lib/api';
import { mockProposals } from '@/lib/mock-data';

export function useProposals() {
  const [proposals, setProposals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProposals() {
      try {
        setLoading(true);
        const data = await api.getProposals();
        
        if (data && data.length > 0) {
          setProposals(data);
        } else {
          setProposals(mockProposals);
        }
      } catch (err) {
        console.error('Error fetching proposals:', err);
        setError('Failed to fetch proposals');
        setProposals(mockProposals);
      } finally {
        setLoading(false);
      }
    }

    fetchProposals();
  }, []);

  return { proposals, loading, error };
}

export function useProposal(id: number) {
  const [proposal, setProposal] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProposal() {
      try {
        setLoading(true);
        const data = await api.getProposal(id);
        
        if (data) {
          setProposal(data);
        } else {
          const mockProposal = mockProposals.find(p => p.id === id);
          setProposal(mockProposal || mockProposals[0]);
        }
      } catch (err) {
        console.error('Error fetching proposal:', err);
        setError('Failed to fetch proposal');
        const mockProposal = mockProposals.find(p => p.id === id);
        setProposal(mockProposal || mockProposals[0]);
      } finally {
        setLoading(false);
      }
    }

    fetchProposal();
  }, [id]);

  return { proposal, loading, error };
}