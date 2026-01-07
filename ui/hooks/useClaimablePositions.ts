import { useState, useEffect, useCallback, useMemo } from 'react';
import { PublicKey } from '@solana/web3.js';
import { fetchUserBalanceForWinningMint, type WinningMintBalanceResponse } from '@/lib/programs/vault';
import { useProposalsWithFutarchy } from './useProposals';
import { useTokenPrices } from './useTokenPrices';
import type { ProposalListItem } from '@/types/api';

export interface ClaimablePosition {
  proposalId: number;
  proposalDescription: string;
  proposalStatus: 'Passed' | 'Failed';
  winningMarketIndex: number;  // Which market won (for N-ary quantum markets)
  isWinner: boolean;
  claimableAmount: number; // Amount of tokens to claim
  claimableToken: 'sol' | 'zc'; // Which token they'll receive
  claimableValue: number; // USD value
}

interface ClaimablePositions {
  positions: ClaimablePosition[];
  totalClaimableValue: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

interface UseClaimablePositionsOptions {
  walletAddress: string | null;
  moderatorId?: number | string;
  // Futarchy DAOs use different claiming mechanism - skip old system
  isFutarchy?: boolean;
}

export function useClaimablePositions(walletAddress: string | null, moderatorId?: number | string, isFutarchy?: boolean): ClaimablePositions {
  // For futarchy DAOs, don't fetch from old system - claiming works differently
  const { proposals } = useProposalsWithFutarchy({
    moderatorId: isFutarchy ? undefined : moderatorId,
    isFutarchy: false, // Always use old system for claimable positions (futarchy has different mechanism)
  });
  const { sol: solPrice, baseToken: baseTokenPrice } = useTokenPrices();
  const [balancesMap, setBalancesMap] = useState<Map<number, WinningMintBalanceResponse>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAllBalances = useCallback(async (address: string, proposalList: ProposalListItem[]) => {
    // Only fetch for finalized proposals with a winning index
    const finalizedProposals = proposalList.filter(p =>
      (p.status === 'Passed' || p.status === 'Failed') &&
      p.winningMarketIndex !== null && p.winningMarketIndex !== undefined
    );

    if (finalizedProposals.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch winning mint balances for finalized proposals in parallel
      const balancePromises = finalizedProposals.map(proposal =>
        fetchUserBalanceForWinningMint(
          new PublicKey(proposal.vaultPDA),
          new PublicKey(address),
          proposal.winningMarketIndex!
        )
          .then(data => ({ id: proposal.id, data }))
          .catch(() => ({ id: proposal.id, data: null }))
      );

      const results = await Promise.all(balancePromises);

      // Update the balances map
      const newMap = new Map<number, WinningMintBalanceResponse>();
      results.forEach(({ id, data }) => {
        if (data) {
          newMap.set(id, data);
        }
      });

      setBalancesMap(newMap);
    } catch (err) {
      console.error('Error fetching claimable balances:', err);
      setError('Failed to fetch claimable positions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!walletAddress || proposals.length === 0) {
      setBalancesMap(new Map());
      return;
    }

    fetchAllBalances(walletAddress, proposals);
  }, [walletAddress, proposals, fetchAllBalances]);

  // Calculate claimable positions from balances
  const { positions, totalClaimableValue } = useMemo(() => {
    const claimableList: ClaimablePosition[] = [];
    let total = 0;

    balancesMap.forEach((balances, proposalId) => {
      const proposal = proposals.find(p => p.id === proposalId);
      if (!proposal || (proposal.status !== 'Passed' && proposal.status !== 'Failed')) return;

      const winningIndex = balances.winningIndex;

      // Get winning tokens directly from the response (already for winning index only)
      const baseWinningTokens = parseFloat(balances.baseConditionalBalance);
      const quoteWinningTokens = parseFloat(balances.quoteConditionalBalance);

      // Check if user has ANY winning tokens to claim
      if (baseWinningTokens > 0 || quoteWinningTokens > 0) {
        // Use proposal decimals - these are required from the API
        if (proposal.baseDecimals === undefined || proposal.quoteDecimals === undefined) {
          console.error(`Proposal ${proposalId} missing decimals configuration`);
          return;
        }
        const baseMultiplier = Math.pow(10, proposal.baseDecimals);
        const quoteMultiplier = Math.pow(10, proposal.quoteDecimals);

        // Check base vault winning tokens (ZC)
        if (baseWinningTokens > 0) {
          const value = (baseWinningTokens / baseMultiplier) * baseTokenPrice;
          claimableList.push({
            proposalId,
            proposalDescription: proposal.description,
            proposalStatus: proposal.status as 'Passed' | 'Failed',
            winningMarketIndex: winningIndex,
            isWinner: true,
            claimableAmount: baseWinningTokens / baseMultiplier,
            claimableToken: 'zc',
            claimableValue: value
          });
          total += value;
        }

        // Check quote vault winning tokens (SOL)
        if (quoteWinningTokens > 0) {
          const value = (quoteWinningTokens / quoteMultiplier) * solPrice;
          claimableList.push({
            proposalId,
            proposalDescription: proposal.description,
            proposalStatus: proposal.status as 'Passed' | 'Failed',
            winningMarketIndex: winningIndex,
            isWinner: true,
            claimableAmount: quoteWinningTokens / quoteMultiplier,
            claimableToken: 'sol',
            claimableValue: value
          });
          total += value;
        }
      }
    });

    return { positions: claimableList, totalClaimableValue: total };
  }, [balancesMap, proposals, solPrice, baseTokenPrice]);

  const refetch = useCallback(() => {
    if (walletAddress && proposals.length > 0) {
      fetchAllBalances(walletAddress, proposals);
    }
  }, [walletAddress, proposals, fetchAllBalances]);

  return { positions, totalClaimableValue, loading, error, refetch };
}
