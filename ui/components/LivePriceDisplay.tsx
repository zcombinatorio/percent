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

import React, { useEffect, useState, useCallback } from 'react';
import { PublicKey } from '@solana/web3.js';
import { TokenPriceBox } from './TokenPriceBox';
import { getPriceStreamService, ChartPriceUpdate } from '../services/price-stream.service';
import { api } from '../lib/api';
import { fetchVaultState } from '@/lib/programs/vault';
import { buildApiUrl } from '@/lib/api-utils';
import { useTokenContext } from '@/providers/TokenContext';

interface LivePriceDisplayProps {
  proposalId: number;
  marketLabels: string[];      // Labels for each market from proposal
  marketCount: number;         // Number of markets (2-4)
  onPricesUpdate?: (prices: (number | null)[]) => void;  // Array by market index
  onTwapUpdate?: (twaps: (number | null)[]) => void;     // Array by market index
}

export const LivePriceDisplay: React.FC<LivePriceDisplayProps> = ({ proposalId, marketLabels, marketCount, onPricesUpdate, onTwapUpdate }) => {
  const { moderatorId } = useTokenContext();

  // Array-based state indexed by market
  const [prices, setPrices] = useState<(number | null)[]>(() => Array(marketCount).fill(null));
  const [twapData, setTwapData] = useState<(number | null)[]>(() => Array(marketCount).fill(null));
  const [tokenAddresses, setTokenAddresses] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Re-initialize arrays when marketCount changes
  useEffect(() => {
    setPrices(Array(marketCount).fill(null));
    setTwapData(Array(marketCount).fill(null));
  }, [marketCount]);

  // Fetch proposal details, initial prices, and TWAP data
  useEffect(() => {
    const fetchProposalDetails = async () => {
      try {
        const proposal = await api.getProposal(proposalId, moderatorId || undefined);
        if (!proposal) {
          throw new Error('Failed to fetch proposal details');
        }

        // Fetch conditional mints from vault state via SDK (on-chain)
        // Use VaultType.Base to get the base vault's conditional mints
        const { VaultType } = await import('@/lib/programs/vault');
        const vaultState = await fetchVaultState(new PublicKey(proposal.vaultPDA), VaultType.Base);
        setTokenAddresses(vaultState.conditionalMints.slice(0, marketCount));

      } catch (error) {
        console.error('Error fetching proposal details:', error);
        setError('Failed to fetch proposal details');
      } finally {
        setIsLoading(false);
      }
    };

    // Fetch initial prices from chart endpoint
    const fetchInitialPrices = async () => {
      try {
        console.log('[LivePriceDisplay] Fetching initial prices for proposal', proposalId);

        // Get moderatorId from proposal first
        const proposal = await api.getProposal(proposalId, moderatorId || undefined);
        if (!proposal) {
          console.warn('[LivePriceDisplay] Cannot fetch initial prices - proposal not found');
          return;
        }

        console.log('[LivePriceDisplay] Proposal data:', {
          proposalId,
          moderatorId: proposal.moderatorId,
          status: proposal.status
        });

        const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const url = buildApiUrl(API_BASE_URL, `/api/history/${proposalId}/chart`, {
          interval: '5m'
        }, moderatorId ?? undefined);

        console.log('[LivePriceDisplay] Fetching from URL:', url);
        const response = await fetch(url);

        if (response.ok) {
          const data = await response.json();
          console.log('[LivePriceDisplay] Chart data received:', {
            dataLength: data.data?.length || 0,
            firstItems: data.data?.slice(0, 6)
          });

          if (data.data && data.data.length > 0) {
            // Group chart data by market index (supports 2-4 markets)
            const newPrices: (number | null)[] = Array(marketCount).fill(null);

            for (const d of data.data) {
              const marketIndex = typeof d.market === 'number' ? d.market : null;
              if (marketIndex !== null && marketIndex >= 0 && marketIndex < marketCount) {
                // Use most recent close price for each market
                newPrices[marketIndex] = parseFloat(d.close);
              }
            }

            console.log('[LivePriceDisplay] Setting initial prices:', newPrices);

            setPrices(prev => newPrices.map((p, i) => p !== null ? p : prev[i]));

            console.log('[LivePriceDisplay] Initial prices set successfully');
          } else {
            console.warn('[LivePriceDisplay] No chart data available');
          }
        } else {
          console.error('[LivePriceDisplay] Chart fetch failed:', response.status, response.statusText);
        }
      } catch (error) {
        console.error('[LivePriceDisplay] Error fetching initial prices:', error);
        // Continue - WebSocket will update prices
      }
    };

    fetchProposalDetails();
    fetchInitialPrices();
    
    // Fetch TWAP data for governance decision
    const fetchTwap = async () => {
      try {
        const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const url = buildApiUrl(API_BASE_URL, `/api/history/${proposalId}/twap`, undefined, moderatorId ?? undefined);
        const response = await fetch(url);
        if (response.ok) {
          const data = await response.json();
          if (data.data && data.data.length > 0) {
            const latest = data.data[0];
            // Backend returns twaps[] array - use directly (supports 2-4 markets)
            const twaps: (number | null)[] = (latest.twaps || [])
              .slice(0, marketCount)
              .map((t: string) => parseFloat(t));

            // Pad with nulls if needed
            while (twaps.length < marketCount) {
              twaps.push(null);
            }

            setTwapData(twaps);
            // Notify parent component of TWAP update
            if (onTwapUpdate) {
              onTwapUpdate(twaps);
            }
          }
        }
      } catch (error) {
        // Silently fail - TWAP data not available yet
      }
    };
    
    fetchTwap();

    // Poll for TWAP updates every 10 seconds
    const interval = setInterval(fetchTwap, 10000);

    return () => clearInterval(interval);
  }, [proposalId, moderatorId, marketCount]);

  // Handle chart price updates for N-ary markets
  const handleChartPriceUpdate = useCallback((update: ChartPriceUpdate) => {
    console.log('[LivePriceDisplay] Chart price update:', update);

    // Use marketCapUsd if available (new backend), otherwise price field (legacy)
    const marketCapValue = update.marketCapUsd ?? update.price;
    const marketIndex = typeof update.market === 'number' ? update.market : -1;

    // Only update if valid market index within our range
    if (marketIndex >= 0 && marketIndex < marketCount) {
      setPrices(prev => {
        const newPrices = [...prev];
        newPrices[marketIndex] = marketCapValue;
        return newPrices;
      });
    }
  }, [marketCount]);

  // Set up chart price subscription for pass/fail markets
  useEffect(() => {
    if (moderatorId === null) return; // Wait for moderatorId to be available

    const priceService = getPriceStreamService();

    // Subscribe to chart prices for this proposal (includes pass, fail, and spot)
    priceService.subscribeToChartPrices(moderatorId, proposalId, handleChartPriceUpdate);
    console.log('[LivePriceDisplay] Subscribed to chart prices for proposal', proposalId, 'moderator', moderatorId);

    // Cleanup on unmount
    return () => {
      priceService.unsubscribeFromChartPrices(moderatorId, proposalId, handleChartPriceUpdate);
      console.log('[LivePriceDisplay] Unsubscribed from chart prices for proposal', proposalId, 'moderator', moderatorId);
    };
  }, [proposalId, moderatorId, handleChartPriceUpdate]);

  // Call the callback when prices update
  useEffect(() => {
    console.log('[LivePriceDisplay] Prices changed, calling onPricesUpdate:', {
      prices,
      hasCallback: !!onPricesUpdate
    });

    if (onPricesUpdate && prices.length > 0) {
      onPricesUpdate(prices);
      console.log('[LivePriceDisplay] onPricesUpdate called successfully');
    }
  }, [prices, onPricesUpdate]);


  if (error) {
    return (
      <div className="rounded-lg border p-4" style={{ borderColor: 'rgba(255, 111, 148, 0.2)', backgroundColor: 'rgba(255, 111, 148, 0.05)' }}>
        <p style={{ color: '#FF6F94' }}>Error: {error}</p>
      </div>
    );
  }

  // Dynamic grid columns based on market count
  const gridColsClass = marketCount === 2 ? 'md:grid-cols-2' :
                        marketCount === 3 ? 'md:grid-cols-3' :
                        'md:grid-cols-4';

  return (
    <div className={`grid grid-cols-1 ${gridColsClass}`}>
      {marketLabels.slice(0, marketCount).map((label, index) => (
        <TokenPriceBox
          key={index}
          tokenName={label}
          tokenSymbol={`COIN${index + 1}-${proposalId}`}
          tokenAddress={tokenAddresses[index] || ''}
          price={prices[index] ?? null}
          twap={twapData[index] ?? null}
          isLoading={prices[index] === null}
          tokenType="market"
          marketIndex={index}
          isLast={index === marketCount - 1}
        />
      ))}
    </div>
  );
};