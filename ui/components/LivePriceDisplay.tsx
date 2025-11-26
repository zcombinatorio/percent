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
import { TokenPriceBox } from './TokenPriceBox';
import { getPriceStreamService, ChartPriceUpdate } from '../services/price-stream.service';
import { api } from '../lib/api';
import { buildApiUrl } from '@/lib/api-utils';
import { useTokenContext } from '@/providers/TokenContext';

interface LivePriceDisplayProps {
  proposalId: number;
  onPricesUpdate?: (prices: { pass: number | null; fail: number | null }) => void;
  onTwapUpdate?: (twap: { passTwap: number | null; failTwap: number | null }) => void;
}

interface TokenPrices {
  pass: number | null;
  fail: number | null;
}

interface TwapData {
  passTwap: number | null;
  failTwap: number | null;
}

export const LivePriceDisplay: React.FC<LivePriceDisplayProps> = ({ proposalId, onPricesUpdate, onTwapUpdate }) => {
  const { moderatorId } = useTokenContext();
  const [prices, setPrices] = useState<TokenPrices>({
    pass: null,
    fail: null
  });
  
  const [twapData, setTwapData] = useState<TwapData>({
    passTwap: null,
    failTwap: null
  });
  
  const [tokenAddresses, setTokenAddresses] = useState<{
    pass: string | null;
    fail: string | null;
    passPool: string | null;
    failPool: string | null;
  }>({
    pass: null,
    fail: null,
    passPool: null,
    failPool: null
  });
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch proposal details, initial prices, and TWAP data
  useEffect(() => {
    const fetchProposalDetails = async () => {
      try {
        const proposal = await api.getProposal(proposalId, moderatorId || undefined);
        if (!proposal) {
          throw new Error('Failed to fetch proposal details');
        }

        // Extract pass and fail token addresses for display purposes
        // Market index: 0 = fail, 1 = pass
        const passAddress = proposal.baseVaultState?.conditionalMints?.[1] || null;
        const failAddress = proposal.baseVaultState?.conditionalMints?.[0] || null;

        setTokenAddresses({
          pass: passAddress,
          fail: failAddress,
          passPool: null,
          failPool: null
        });

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
            // Get the most recent prices for pass and fail markets
            // Backend uses numeric market indices: 0 = fail, 1 = pass
            const passData = data.data.find((d: any) => d.market === 1 || d.market === 'pass');
            const failData = data.data.find((d: any) => d.market === 0 || d.market === 'fail');

            console.log('[LivePriceDisplay] Found market data:', {
              passData,
              failData
            });

            if (passData || failData) {
              const newPrices = {
                pass: passData ? parseFloat(passData.close) : null,
                fail: failData ? parseFloat(failData.close) : null
              };

              console.log('[LivePriceDisplay] Setting initial prices:', newPrices);

              setPrices(prev => ({
                ...prev,
                pass: newPrices.pass !== null ? newPrices.pass : prev.pass,
                fail: newPrices.fail !== null ? newPrices.fail : prev.fail
              }));

              console.log('[LivePriceDisplay] Initial prices set successfully');
            } else {
              console.warn('[LivePriceDisplay] No pass or fail data found in chart response');
            }
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
        console.log(response);
        if (response.ok) {
          const data = await response.json();
          if (data.data && data.data.length > 0) {
            const latest = data.data[0];
            // Backend returns twaps[] array: index 0 = fail, index 1 = pass
            const twap = {
              passTwap: parseFloat(latest.twaps?.[1] || '0'),
              failTwap: parseFloat(latest.twaps?.[0] || '0')
            };
            setTwapData(twap);
            // Notify parent component of TWAP update
            if (onTwapUpdate) {
              onTwapUpdate(twap);
            }
          }
        }
      } catch (error) {
        // Silently fail - TWAP data not available yet
      }
    };
    
    fetchTwap();

    // Poll for TWAP updates every 30 seconds
    const interval = setInterval(fetchTwap, 10000);

    return () => clearInterval(interval);
  }, [proposalId, moderatorId]);

  // Handle chart price updates for pass/fail markets
  const handleChartPriceUpdate = useCallback((update: ChartPriceUpdate) => {
    console.log('[LivePriceDisplay] Chart price update:', update);

    // Use marketCapUsd if available (new backend), otherwise price field (legacy)
    const marketCapValue = update.marketCapUsd ?? update.price;

    setPrices(prev => ({
      ...prev,
      [update.market]: marketCapValue
    }));
  }, []);

  // Set up chart price subscription for pass/fail markets
  useEffect(() => {
    const priceService = getPriceStreamService();

    // Subscribe to chart prices for this proposal (includes pass, fail, and spot)
    priceService.subscribeToChartPrices(proposalId, handleChartPriceUpdate);
    console.log('[LivePriceDisplay] Subscribed to chart prices for proposal', proposalId);

    // Cleanup on unmount
    return () => {
      priceService.unsubscribeFromChartPrices(proposalId, handleChartPriceUpdate);
      console.log('[LivePriceDisplay] Unsubscribed from chart prices for proposal', proposalId);
    };
  }, [proposalId, handleChartPriceUpdate]);

  // Call the callback when prices update
  useEffect(() => {
    console.log('[LivePriceDisplay] Prices changed, calling onPricesUpdate:', {
      pass: prices.pass,
      fail: prices.fail,
      hasCallback: !!onPricesUpdate
    });

    if (onPricesUpdate) {
      onPricesUpdate({ pass: prices.pass, fail: prices.fail });
      console.log('[LivePriceDisplay] onPricesUpdate called successfully');
    }
  }, [prices.pass, prices.fail, onPricesUpdate]);


  if (error) {
    return (
      <div className="rounded-lg border p-4" style={{ borderColor: 'rgba(255, 111, 148, 0.2)', backgroundColor: 'rgba(255, 111, 148, 0.05)' }}>
        <p style={{ color: '#FF6F94' }}>Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3">
      <TokenPriceBox
        tokenName="Pass"
        tokenSymbol={`PASS-${proposalId}`}
        tokenAddress={tokenAddresses.pass || ''}
        price={prices.pass}
        isLoading={prices.pass === null}
        tokenType="pass"
      />

      <TokenPriceBox
        tokenName="Fail"
        tokenSymbol={`FAIL-${proposalId}`}
        tokenAddress={tokenAddresses.fail || ''}
        price={prices.fail}
        isLoading={prices.fail === null}
        tokenType="fail"
      />

      <TokenPriceBox
        tokenName="Pass-Fail Gap (PFG)"
        tokenSymbol="TWAP"
        price={
          // Match backend calculation: (passTwap - failTwap) / failTwap * 100
          // Backend uses this to compare against passThresholdBps/100
          twapData.passTwap !== null && twapData.failTwap !== null && twapData.failTwap > 0
            ? ((twapData.passTwap - twapData.failTwap) / twapData.failTwap) * 100
            : null
        }
        isLoading={false}
        tokenType="gap"
      />
    </div>
  );
};