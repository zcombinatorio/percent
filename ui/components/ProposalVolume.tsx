'use client';

import { useTradeHistory } from '@/hooks/useTradeHistory';

interface ProposalVolumeProps {
  proposalId: number;
}

export function ProposalVolume({ proposalId }: ProposalVolumeProps) {
  const { totalVolume, loading } = useTradeHistory(proposalId);

  // Format volume with K/M/B suffixes
  const formatVolume = (volume: number): string => {
    if (volume >= 1e9) {
      return (volume / 1e9).toFixed(2) + 'B';
    } else if (volume >= 1e6) {
      return (volume / 1e6).toFixed(2) + 'M';
    } else if (volume >= 1e3) {
      return (volume / 1e3).toFixed(2) + 'K';
    } else {
      return volume.toFixed(2);
    }
  };

  if (loading) {
    return (
      <span className="px-2 py-0.5 text-xs font-normal rounded-full bg-gray-500/10 text-gray-400">
        Loading...
      </span>
    );
  }

  if (totalVolume === 0) {
    return null;
  }

  return (
    <span className="px-2 py-0.5 text-xs font-normal rounded-full bg-gray-500/10 text-gray-300">
      Vol: ${formatVolume(totalVolume)}
    </span>
  );
}
