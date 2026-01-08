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

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { PublicKey } from '@solana/web3.js';
import { TokenPriceBox } from './TokenPriceBox';
import { getPriceStreamService, ChartPriceUpdate } from '../services/price-stream.service';
import { getMonitorStreamService, MonitorPriceUpdate, MonitorTWAPUpdate } from '../services/monitor-stream.service';
import { getFutarchyTWAP } from '@/lib/monitor-api';
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
  proposalPda?: string;        // Required for futarchy mode
}

export const LivePriceDisplay: React.FC<LivePriceDisplayProps> = ({ proposalId, marketLabels, marketCount, onPricesUpdate, onTwapUpdate, proposalPda }) => {
  const { moderatorId, isFutarchy } = useTokenContext();

  // DEBUG: Log futarchy state
  console.log('[LivePriceDisplay] isFutarchy:', isFutarchy, 'proposalPda:', proposalPda, 'proposalId:', proposalId);

  // Array-based state indexed by market
  const [prices, setPrices] = useState<(number | null)[]>(() => Array(marketCount).fill(null));
  const [twapData, setTwapData] = useState<(number | null)[]>(() => Array(marketCount).fill(null));
  const [tokenAddresses, setTokenAddresses] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasWebSocketData, setHasWebSocketData] = useState(false);

  // Refs for futarchy SSE callbacks
  const proposalPdaRef = useRef(proposalPda);

  // Re-initialize arrays when marketCount changes
  useEffect(() => {
    setPrices(Array(marketCount).fill(null));
    setTwapData(Array(marketCount).fill(null));
  }, [marketCount]);

  // Update ref when proposalPda changes
  useEffect(() => {
    proposalPdaRef.current = proposalPda;
  }, [proposalPda]);

  // Fetch proposal details, initial prices, and TWAP data
  useEffect(() => {
    // Futarchy mode - use monitor API for TWAP and initial prices
    if (isFutarchy && proposalPda) {
      console.log('[LivePriceDisplay] Futarchy mode - fetching TWAP for', proposalPda);

      const fetchFutarchyData = async () => {
        try {
          // Fetch TWAP data
          console.log('[LivePriceDisplay] Calling getFutarchyTWAP...');
          const result = await getFutarchyTWAP(proposalPda);
          console.log('[LivePriceDisplay] getFutarchyTWAP result:', result);
          if (result && result.data && result.data.length > 0) {
            const latest = result.data[0];
            console.log('[LivePriceDisplay] Latest TWAP record:', latest);
            // Backend returns twaps[] array
            const twaps: (number | null)[] = (latest.twaps || [])
              .slice(0, marketCount)
              .map((t: string) => parseFloat(t));

            // Pad with nulls if needed
            while (twaps.length < marketCount) {
              twaps.push(null);
            }

            console.log('[LivePriceDisplay] Parsed TWAPs:', twaps);
            setTwapData(twaps);
            if (onTwapUpdate) {
              onTwapUpdate(twaps);
            }

            // Use TWAP values as initial prices (they're the most recent weighted prices)
            // This ensures ModeToggle can display data before SSE updates arrive
            setPrices(prev => {
              const newPrices = [...prev];
              for (let i = 0; i < twaps.length; i++) {
                if (newPrices[i] === null && twaps[i] !== null) {
                  newPrices[i] = twaps[i];
                }
              }
              console.log('[LivePriceDisplay] Set initial prices from TWAP:', newPrices);
              return newPrices;
            });
            setHasWebSocketData(true); // Allow price propagation
          } else {
            console.log('[LivePriceDisplay] No TWAP data returned or empty data array');
          }
        } catch (error) {
          console.error('[LivePriceDisplay] Error fetching futarchy TWAP:', error);
        } finally {
          setIsLoading(false);
        }
      };

      fetchFutarchyData();
      // Poll for TWAP updates every 10 seconds
      const interval = setInterval(fetchFutarchyData, 10000);
      return () => clearInterval(interval);
    }

    // Old system - use API for proposal details and TWAP
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

    // Note: We intentionally don't fetch initial prices from the chart endpoint here
    // because it returns market cap USD values, but we need raw SOL prices for the
    // TWAP projection calculation. The WebSocket will provide SOL prices directly.
    // The UI will show loading state until WebSocket connects.

    fetchProposalDetails();

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
  }, [proposalId, moderatorId, marketCount, isFutarchy, proposalPda, onTwapUpdate]);

  // Handle chart price updates for N-ary markets (from WebSocket)
  const handleChartPriceUpdate = useCallback((update: ChartPriceUpdate) => {
    // Mark that we've received real-time WebSocket data
    setHasWebSocketData(true);

    // Use raw price in SOL for TWAP projection calculations
    // (marketCapUsd is for display purposes only, not for the TWAP formula)
    const priceValue = update.price;
    const marketIndex = typeof update.market === 'number' ? update.market : -1;

    // Only update if valid market index within our range
    if (marketIndex >= 0 && marketIndex < marketCount) {
      setPrices(prev => {
        const newPrices = [...prev];
        newPrices[marketIndex] = priceValue;
        return newPrices;
      });
    }
  }, [marketCount]);

  // Handle futarchy price updates (from monitor SSE)
  const handleFutarchyPriceUpdate = useCallback((update: MonitorPriceUpdate) => {
    console.log('[LivePriceDisplay] Received futarchy price update:', update);
    // Verify this is for our proposal
    if (update.proposalPda !== proposalPdaRef.current) {
      console.log('[LivePriceDisplay] Price update for different proposal, ignoring');
      return;
    }

    setHasWebSocketData(true);

    const marketIndex = update.market;
    if (marketIndex >= 0 && marketIndex < marketCount) {
      console.log('[LivePriceDisplay] Setting price for market', marketIndex, ':', update.price);
      setPrices(prev => {
        const newPrices = [...prev];
        newPrices[marketIndex] = update.price;
        return newPrices;
      });
    }
  }, [marketCount]);

  // Handle futarchy TWAP updates (from monitor SSE)
  const handleFutarchyTwapUpdate = useCallback((update: MonitorTWAPUpdate) => {
    // Verify this is for our proposal
    if (update.proposalPda !== proposalPdaRef.current) return;

    // Convert pools TWAP to array format
    const twaps: (number | null)[] = Array(marketCount).fill(null);
    update.pools.forEach(p => {
      // Pool index maps to market index
      const poolIndex = update.pools.indexOf(p);
      if (poolIndex >= 0 && poolIndex < marketCount) {
        twaps[poolIndex] = p.twap;
      }
    });

    setTwapData(twaps);
    if (onTwapUpdate) {
      onTwapUpdate(twaps);
    }
  }, [marketCount, onTwapUpdate]);

  // Set up chart price subscription for pass/fail markets (old system only)
  useEffect(() => {
    // Skip for futarchy DAOs - they use on-chain AMM prices, not the old price stream
    if (isFutarchy) return;
    if (moderatorId === null) return; // Wait for moderatorId to be available

    const priceService = getPriceStreamService();

    // Subscribe to chart prices for this proposal (includes pass, fail, and spot)
    priceService.subscribeToChartPrices(moderatorId, proposalId, handleChartPriceUpdate);

    // Cleanup on unmount
    return () => {
      priceService.unsubscribeFromChartPrices(moderatorId, proposalId, handleChartPriceUpdate);
    };
  }, [proposalId, moderatorId, isFutarchy, handleChartPriceUpdate]);

  // Set up SSE subscription for futarchy proposals (monitor server)
  useEffect(() => {
    if (!isFutarchy || !proposalPda) return;

    console.log('[LivePriceDisplay] Setting up SSE subscription for', proposalPda);
    const monitorService = getMonitorStreamService();
    console.log('[LivePriceDisplay] MonitorStreamService connected:', monitorService.isConnected());

    // Subscribe to price and TWAP updates
    monitorService.subscribeToPrices(proposalPda, handleFutarchyPriceUpdate);
    monitorService.subscribeToTWAP(proposalPda, handleFutarchyTwapUpdate);
    console.log('[LivePriceDisplay] Subscribed to prices and TWAP');

    // Cleanup on unmount
    return () => {
      console.log('[LivePriceDisplay] Cleaning up SSE subscription');
      monitorService.unsubscribeFromPrices(proposalPda, handleFutarchyPriceUpdate);
      monitorService.unsubscribeFromTWAP(proposalPda, handleFutarchyTwapUpdate);
    };
  }, [isFutarchy, proposalPda, handleFutarchyPriceUpdate, handleFutarchyTwapUpdate]);

  // Call the callback when prices update (only after WebSocket data received)
  // This prevents flickering from stale chart data before real-time prices arrive
  useEffect(() => {
    // Only propagate prices to parent after WebSocket has sent real-time data
    // This avoids showing stale chart prices that would cause reordering flicker
    if (onPricesUpdate && prices.length > 0 && hasWebSocketData) {
      console.log('[LivePriceDisplay] Prices changed:', {
        prices,
        hasCallback: !!onPricesUpdate,
        hasWebSocketData
      });
      onPricesUpdate(prices);
      console.log('[LivePriceDisplay] onPricesUpdate called with WebSocket prices');
    }
  }, [prices, onPricesUpdate, hasWebSocketData]);


  if (error) {
    return (
      <div className="rounded-lg border p-4" style={{ borderColor: 'rgba(255, 111, 148, 0.2)', backgroundColor: 'rgba(255, 111, 148, 0.05)' }}>
        <p style={{ color: '#FF6F94' }}>Error: {error}</p>
      </div>
    );
  }

  // For futarchy DAOs, use monitor SSE for real-time prices
  if (isFutarchy) {
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
            tokenAddress=""
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