import type { Trade } from '@/hooks/useTradeHistory';

interface TradeHistoryTableProps {
  trades: Trade[];
  loading: boolean;
  getTimeAgo: (timestamp: string) => string;
  formatAddress: (address: string) => string;
  getTokenUsed: (isBaseToQuote: boolean, market: 'pass' | 'fail') => string;
}

export function TradeHistoryTable({
  trades,
  loading,
  getTimeAgo,
  formatAddress,
  getTokenUsed
}: TradeHistoryTableProps) {
  return (
    <div className="max-h-[400px] overflow-y-auto scrollbar-hide border border-[#191919] rounded-[6px]">
      <table className="w-full text-xs">
        <thead className="text-[#6B6E71] font-medium uppercase">
          <tr>
            <th className="py-3 pl-3 text-left font-medium">Trader</th>
            <th className="py-3 text-left font-medium">Coin</th>
            <th className="py-3 text-left font-medium">Trade</th>
            <th className="py-3 text-left font-medium">MCAP</th>
            <th className="py-3 text-left font-medium">Amount</th>
            <th className="py-3 text-left font-medium">Tx</th>
            <th className="py-3 pr-3 text-right font-medium">Age</th>
          </tr>
        </thead>
        <tbody>
        {loading ? (
          <tr>
            <td colSpan={7} className="py-8 text-center text-[#6B6E71]">
              Loading trades...
            </td>
          </tr>
        ) : trades.length === 0 ? (
          <tr>
            <td colSpan={7} className="py-8 text-center text-[#6B6E71]">
              No trades yet
            </td>
          </tr>
        ) : (
          trades.map((trade) => {
            const tokenUsed = getTokenUsed(trade.isBaseToQuote, trade.market);
            const isBuy = !trade.isBaseToQuote;
            const amount = parseFloat(trade.amountIn);

            // Format amount with K/M/B notation for base token - remove trailing zeros
            const removeTrailingZeros = (num: string): string => {
              return num.replace(/\.?0+$/, '');
            };

            let formattedAmount;
            if (tokenUsed === 'SOL') {
              formattedAmount = removeTrailingZeros(amount.toFixed(3));
            } else {
              // Base token formatting with K/M/B notation
              if (amount >= 1000000000) {
                formattedAmount = removeTrailingZeros((amount / 1000000000).toFixed(3)) + 'B';
              } else if (amount >= 1000000) {
                formattedAmount = removeTrailingZeros((amount / 1000000).toFixed(3)) + 'M';
              } else if (amount >= 1000) {
                formattedAmount = removeTrailingZeros((amount / 1000).toFixed(3)) + 'K';
              } else {
                formattedAmount = removeTrailingZeros(amount.toFixed(3));
              }
            }

            return (
              <tr
                key={trade.id}
                className="hover:bg-[#272A2D]/30 transition-colors"
              >
                <td className="py-3 pl-3 whitespace-nowrap" style={{ color: '#DDDDD7' }}>
                  {formatAddress(trade.userAddress)}
                  <button
                    onClick={() => navigator.clipboard.writeText(trade.userAddress)}
                    className="text-[#6B6E71] hover:text-theme-text transition-colors ml-1 inline"
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
                    href={`https://solscan.io/account/${trade.userAddress}`}
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
                <td className="py-3 uppercase" style={{ color: '#DDDDD7' }}>
                  {trade.market === 'pass' ? 'Pass' : 'Fail'}
                </td>
                <td className="py-3" style={{ color: isBuy ? '#6ECC94' : '#FF6F94' }}>
                  {isBuy ? 'Buy' : 'Sell'}
                </td>
                <td className="py-3" style={{ color: '#DDDDD7' }}>
                  {(() => {
                    if (!trade.marketCapUsd) return '—';

                    const mcap = trade.marketCapUsd;

                    // Validate market cap is within reasonable bounds
                    // Min: $1, Max: $100B (anything beyond is likely a calculation error)
                    if (mcap < 1 || mcap > 100000000000) {
                      return '—';
                    }

                    let formattedMcap;
                    if (mcap >= 1000000000) {
                      formattedMcap = '$' + removeTrailingZeros((mcap / 1000000000).toFixed(3)) + 'B';
                    } else if (mcap >= 1000000) {
                      formattedMcap = '$' + removeTrailingZeros((mcap / 1000000).toFixed(3)) + 'M';
                    } else if (mcap >= 1000) {
                      formattedMcap = '$' + removeTrailingZeros((mcap / 1000).toFixed(3)) + 'K';
                    } else {
                      formattedMcap = '$' + removeTrailingZeros(mcap.toFixed(2));
                    }

                    return formattedMcap;
                  })()}
                </td>
                <td className="py-3" style={{ color: '#DDDDD7' }}>
                  {formattedAmount} {tokenUsed.replace('$', '')}
                </td>
                <td className="py-3 whitespace-nowrap" style={{ color: '#DDDDD7' }}>
                  {trade.txSignature ? trade.txSignature.slice(0, 6) : '—'}
                  {trade.txSignature && (
                    <a
                      href={`https://solscan.io/tx/${trade.txSignature}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#6B6E71] hover:text-theme-text transition-colors ml-1 inline"
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
                  )}
                </td>
                <td className="py-3 pr-3 text-right text-[#6B6E71]">{getTimeAgo(trade.timestamp)}</td>
              </tr>
            );
          })
        )}
        </tbody>
      </table>
    </div>
  );
}
