'use client';

import { useState } from 'react';
import MarketChart from './MarketChart';
import type { Trade } from '@/hooks/useTradeHistory';
import { useMarketVolume } from '@/hooks/useMarketVolume';

interface ChartBoxProps {
  proposalId: number;
  selectedMarketIndex: number;  // Numeric market index (0-3 for quantum markets)
  marketLabels?: string[];  // Labels for each market option
  trades: Trade[];
  tradesLoading: boolean;
  getTimeAgo: (timestamp: string) => string;
  getTokenUsed: (isBaseToQuote: boolean, market: number) => string;
  moderatorId?: number;
  className?: string;
  userWalletAddress?: string | null;
  tokenSymbol?: string;  // Token symbol for spot market overlay (e.g., "ZC", "SURF")
  isFutarchy?: boolean;  // Skip old system API calls for futarchy DAOs
}

export function ChartBox({
  proposalId,
  selectedMarketIndex,
  marketLabels,
  trades,
  tradesLoading,
  getTimeAgo,
  getTokenUsed,
  moderatorId,
  className,
  userWalletAddress,
  tokenSymbol,
  isFutarchy
}: ChartBoxProps) {
  // Get display label for the selected market (strip URLs and trim)
  const selectedLabel = marketLabels?.[selectedMarketIndex]?.replace(/(https?:\/\/[^\s]+)/gi, '').trim() || `Coin ${selectedMarketIndex + 1}`;
  const [view, setView] = useState<'chart' | 'history'>('chart');
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [showOnlyMyTrades, setShowOnlyMyTrades] = useState(false);

  // Fetch volume from API (aggregated server-side, all historical trades)
  const { volumeByMarket } = useMarketVolume(proposalId, moderatorId, isFutarchy);

  // Get volume for the selected market (matches old behavior, but with all historical data)
  const marketVolume = volumeByMarket.get(selectedMarketIndex) || 0;

  // Filter trades to show only user's trades when filter is active
  const filteredTrades = trades.filter(t => {
    if (showOnlyMyTrades && userWalletAddress) {
      return t.userAddress === userWalletAddress;
    }
    return true;
  });

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

  return (
    <div className={`bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 transition-all duration-300 flex flex-col overflow-hidden min-h-0 ${className || ''}`}>
      {/* Header with inline toggle and volume */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase text-left" style={{ color: '#DDDDD7' }}>
            {view === 'chart'
              ? `Chart: "${selectedLabel}"`
              : `Trades: "${selectedLabel}"`
            }
          </span>
          <span className="hidden md:inline text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase" style={{ color: '#DDDDD7' }}>
            •
          </span>
          <span className="hidden md:inline text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase" style={{ color: '#DDDDD7' }}>
            VOL ${formatVolume(marketVolume)}
          </span>
        </div>

        {/* Pill Toggle */}
        <div className="flex items-center gap-[2px] p-[3px] border border-[#191919] rounded-full">
          <button
            onClick={() => setView('chart')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer font-ibm-plex-mono ${
              view === 'chart'
                ? 'bg-[#DDDDD7]'
                : 'bg-transparent'
            }`}
            style={view === 'chart' ? { color: '#161616', fontFamily: 'IBM Plex Mono, monospace' } : { color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
          >
            Chart
          </button>
          <button
            onClick={() => setView('history')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer font-ibm-plex-mono ${
              view === 'history'
                ? 'bg-[#DDDDD7]'
                : 'bg-transparent'
            }`}
            style={view === 'history' ? { color: '#161616', fontFamily: 'IBM Plex Mono, monospace' } : { color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
          >
            Trades
          </button>
        </div>
      </div>

      {/* Conditional Content */}
      {view === 'chart' ? (
        <div className="bg-[#121212] border border-[#191919] overflow-hidden rounded-[6px] flex-1 flex flex-col">
          {/* Mobile: 400px */}
          <div className="md:hidden">
            <MarketChart proposalId={proposalId} market={selectedMarketIndex} marketLabel={selectedLabel} height={480} moderatorId={moderatorId} tokenSymbol={tokenSymbol} isFutarchy={isFutarchy} />
          </div>
          {/* Desktop: fills available height */}
          <div className="hidden md:flex md:flex-1">
            <MarketChart proposalId={proposalId} market={selectedMarketIndex} marketLabel={selectedLabel} height="100%" moderatorId={moderatorId} tokenSymbol={tokenSymbol} isFutarchy={isFutarchy} />
          </div>
        </div>
      ) : (
        <div className="h-[480px] md:flex-1 md:min-h-0 relative border border-[#191919] rounded-[6px]">
          <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
          <table className="w-full text-sm">
            <thead className="text-[#6B6E71] font-medium uppercase">
              <tr>
                <th className="py-3 pl-3 text-left font-medium w-[240px]">
                  Trader
                  {userWalletAddress && (
                    <button
                      onClick={() => setShowOnlyMyTrades(!showOnlyMyTrades)}
                      className={`ml-2 cursor-pointer transition-colors hover:text-[#FFFFFF] ${showOnlyMyTrades ? 'text-[#DDDDD7]' : 'text-[#6B6E71]'}`}
                    >
                      [YOU ONLY]
                    </button>
                  )}
                </th>
                <th className="py-3 text-left font-medium w-[100px]">Trade</th>
                <th className="py-3 text-left font-medium w-[120px]">MCAP</th>
                <th className="py-3 text-left font-medium w-[140px]">Amount</th>
                <th className="hidden md:table-cell py-3 text-left font-medium w-[160px]">Tx</th>
                <th className="py-3 pr-3 text-right font-medium">Age</th>
              </tr>
            </thead>
            <tbody>
            {tradesLoading ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[#6B6E71]">
                  Loading trades...
                </td>
              </tr>
            ) : filteredTrades.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-[#6B6E71]">
                  {showOnlyMyTrades ? 'No trades by you yet' : 'No trades yet'}
                </td>
              </tr>
            ) : (
              filteredTrades.map((trade) => (
                <tr
                  key={trade.id}
                  className="group border-t border-[#191919] hover:bg-[#1a1a1a] transition-colors"
                  style={{ color: '#E9E9E3' }}
                >
                  <td className="py-3 pl-3 w-[200px]">
                    <div className="flex items-center gap-1.5">
                      {/* Mobile: First 6 only */}
                      <span className="font-medium md:hidden">{trade.userAddress.slice(0, 6)}</span>
                      {/* Desktop: First 6 + Last 6 */}
                      <span className="font-medium hidden md:inline">{trade.userAddress.slice(0, 6)}...{trade.userAddress.slice(-6)}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(trade.userAddress);
                          setCopiedAddress(trade.userAddress);
                          setTimeout(() => setCopiedAddress(null), 2000);
                        }}
                        className="hidden md:inline-flex hover:text-white transition-colors cursor-pointer"
                        style={{ color: copiedAddress === trade.userAddress ? '#ffffff' : '#6B6E71' }}
                        title="Copy address"
                      >
                        {copiedAddress === trade.userAddress ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        )}
                      </button>
                      <a
                        href={`https://solscan.io/address/${trade.userAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hidden md:inline-flex hover:text-white transition-colors"
                        style={{ color: '#6B6E71' }}
                        title="View on Solscan"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    </div>
                  </td>
                  <td className="py-3 w-[100px]">
                    <span style={{ color: trade.isBaseToQuote ? '#FF6F94' : '#6ECC94' }}>
                      {trade.isBaseToQuote ? 'Sell' : 'Buy'}
                    </span>
                  </td>
                  <td className="py-3 w-[120px]">
                    {/* Mobile: 1 decimal */}
                    <span className="md:hidden">
                      {(() => {
                        if (!trade.marketCapUsd) return <span className="text-[#6B6E71]">-</span>;

                        const mcap = trade.marketCapUsd;

                        if (mcap < 1 || mcap > 100000000000) {
                          return <span className="text-[#6B6E71]">-</span>;
                        }

                        const removeTrailingZeros = (num: string): string => {
                          return num.replace(/\.?0+$/, '');
                        };

                        let formattedMcap;
                        if (mcap >= 1000000000) {
                          formattedMcap = '$' + removeTrailingZeros((mcap / 1000000000).toFixed(1)) + 'B';
                        } else if (mcap >= 1000000) {
                          formattedMcap = '$' + removeTrailingZeros((mcap / 1000000).toFixed(1)) + 'M';
                        } else if (mcap >= 1000) {
                          formattedMcap = '$' + removeTrailingZeros((mcap / 1000).toFixed(1)) + 'K';
                        } else {
                          formattedMcap = '$' + removeTrailingZeros(mcap.toFixed(1));
                        }

                        return formattedMcap;
                      })()}
                    </span>
                    {/* Desktop: 3 decimals */}
                    <span className="hidden md:inline">
                      {(() => {
                        if (!trade.marketCapUsd) return <span className="text-[#6B6E71]">-</span>;

                        const mcap = trade.marketCapUsd;

                        if (mcap < 1 || mcap > 100000000000) {
                          return <span className="text-[#6B6E71]">-</span>;
                        }

                        const removeTrailingZeros = (num: string): string => {
                          return num.replace(/\.?0+$/, '');
                        };

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
                    </span>
                  </td>
                  <td className="py-3 w-[140px]">
                    {/* Mobile: 1 decimal */}
                    <span className="md:hidden">
                      {(() => {
                        const tokenUsed = getTokenUsed(trade.isBaseToQuote, trade.market);
                        const amount = parseFloat(trade.amountIn);

                        const removeTrailingZeros = (num: string): string => {
                          return num.replace(/\.?0+$/, '');
                        };

                        let formattedAmount;
                        if (tokenUsed === 'SOL') {
                          formattedAmount = removeTrailingZeros(amount.toFixed(1));
                        } else {
                          // Base token formatting with K/M/B notation
                          if (amount >= 1000000000) {
                            formattedAmount = removeTrailingZeros((amount / 1000000000).toFixed(1)) + 'B';
                          } else if (amount >= 1000000) {
                            formattedAmount = removeTrailingZeros((amount / 1000000).toFixed(1)) + 'M';
                          } else if (amount >= 1000) {
                            formattedAmount = removeTrailingZeros((amount / 1000).toFixed(1)) + 'K';
                          } else {
                            formattedAmount = removeTrailingZeros(amount.toFixed(1));
                          }
                        }

                        return `${formattedAmount} ${tokenUsed.replace('$', '')}`;
                      })()}
                    </span>
                    {/* Desktop: 3 decimals */}
                    <span className="hidden md:inline">
                      {(() => {
                        const tokenUsed = getTokenUsed(trade.isBaseToQuote, trade.market);
                        const amount = parseFloat(trade.amountIn);

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

                        return `${formattedAmount} ${tokenUsed.replace('$', '')}`;
                      })()}
                    </span>
                  </td>
                  <td className="hidden md:table-cell py-3 w-[160px]">
                    {trade.txSignature ? (
                      <div className="flex items-center gap-1.5">
                        {/* Mobile: First 6 */}
                        <span className="font-medium md:hidden">{trade.txSignature.slice(0, 6)}...</span>
                        {/* Desktop: First 12 */}
                        <span className="font-medium hidden md:inline">{trade.txSignature.slice(0, 12)}...</span>
                        <a
                          href={`https://solscan.io/tx/${trade.txSignature}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hidden md:inline-flex hover:text-white transition-colors"
                          style={{ color: '#6B6E71' }}
                          title="View transaction"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      </div>
                    ) : (
                      <span className="text-[#6B6E71]">-</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-right" style={{ color: '#6B6E71' }}>{getTimeAgo(trade.timestamp)}</td>
                </tr>
              ))
            )}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
