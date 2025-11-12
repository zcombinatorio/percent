'use client';

interface LeaderboardEntry {
  walletAddress: string;
  volume: number;
}

interface LeaderboardTableProps {
  entries: LeaderboardEntry[];
  totalVolume?: number;
  loading?: boolean;
}

export function LeaderboardTable({ entries, totalVolume, loading = false }: LeaderboardTableProps) {
  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

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

  return (
    <div className="overflow-y-auto scrollbar-hide border border-[#191919] rounded-[9px]">
      <table className="w-full">
        <thead className="text-[#6B6E71] font-medium uppercase sticky top-0" style={{ backgroundColor: '#121212' }}>
          {totalVolume !== undefined && (
            <tr className="border-b border-[#191919]">
              <td colSpan={3} className="py-3 px-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium" style={{ color: '#6B6E71' }}>
                    TOTAL VOLUME (ALL PROPOSALS)
                  </span>
                  <span className="text-lg font-medium" style={{ color: '#E9E9E3' }}>
                    ${formatVolume(totalVolume)}
                  </span>
                </div>
              </td>
            </tr>
          )}
          <tr>
            <th className="py-4 pl-5 text-left font-medium text-sm">Rank</th>
            <th className="py-4 text-left font-medium text-sm">Wallet Address</th>
            <th className="py-4 pr-5 text-right font-medium text-sm">Volume</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={3} className="py-12 text-center text-[#6B6E71]">
                Loading leaderboard...
              </td>
            </tr>
          ) : entries.length === 0 ? (
            <tr>
              <td colSpan={3} className="py-12 text-center text-[#6B6E71]">
                No entries yet
              </td>
            </tr>
          ) : (
            entries.map((entry, index) => (
              <tr
                key={entry.walletAddress}
                className="hover:bg-[#272A2D]/30 transition-colors border-t border-[#191919]"
              >
                <td className="py-4 pl-5 text-sm" style={{ color: '#DDDDD7' }}>
                  #{index + 1}
                </td>
                <td className="py-4 text-sm" style={{ color: '#DDDDD7' }}>
                  {formatAddress(entry.walletAddress)}
                  <button
                    onClick={() => navigator.clipboard.writeText(entry.walletAddress)}
                    className="text-[#6B6E71] hover:text-theme-text transition-colors ml-2 inline"
                    title="Copy address"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="inline"
                    >
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                  <a
                    href={`https://solscan.io/account/${entry.walletAddress}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#6B6E71] hover:text-theme-text transition-colors ml-1 inline"
                    title="View on Solscan"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="inline"
                    >
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </a>
                </td>
                <td className="py-4 pr-5 text-right text-sm" style={{ color: '#DDDDD7' }}>
                  ${formatVolume(entry.volume)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
