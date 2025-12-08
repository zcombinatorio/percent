'use client';

import { useEffect, useRef, useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { ProposalMarketDatafeed } from '@/services/tradingview-datafeed';
import { api } from '@/lib/api';
import { fetchVaultState } from '@/lib/programs/vault';
import { formatUSD } from '@/lib/formatters';

declare global {
  interface Window {
    TradingView: any;
  }
}

interface MarketChartProps {
  proposalId: number;
  market: number;  // Numeric market index (0-3 for quantum markets)
  marketLabel?: string;  // Display label for the market (e.g., "Yes", "No", option name)
  height?: number | string;
  moderatorId?: number;
}

export default function MarketChart({ proposalId, market, marketLabel, height = 256, moderatorId }: MarketChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartRetryCount, setChartRetryCount] = useState(0);

  useEffect(() => {
    let isMounted = true;
    let retryCount = 0;
    let containerRetryCount = 0;
    let chartReadyTimeoutRef: NodeJS.Timeout | null = null;
    const MAX_RETRIES = 20; // 10 seconds max wait time (20 * 500ms)
    const MAX_CONTAINER_RETRIES = 50; // 5 seconds max (50 * 100ms)
    const MAX_CHART_READY_RETRIES = 3;
    const CHART_READY_TIMEOUT = 15000; // 15 seconds

    const initChart = async () => {
      const logPrefix = `[Chart P${proposalId} M${market}]`;
      const startTime = Date.now();
      const log = (step: string, data?: any) => {
        const elapsed = Date.now() - startTime;
        console.log(`${logPrefix} [${elapsed}ms] ${step}`, data || '');
      };

      try {
        log('🚀 Starting chart initialization', { retry: chartRetryCount });

        // Fetch proposal details to get token/pool addresses
        log('📡 Fetching proposal...');
        const proposalFetchStart = Date.now();
        const proposal = await api.getProposal(proposalId, moderatorId);
        log('✅ Proposal fetched', { took: Date.now() - proposalFetchStart + 'ms', hasVaultPDA: !!proposal?.vaultPDA });
        if (!proposal) {
          throw new Error('Failed to fetch proposal details');
        }

        // Get token address from vault state via SDK (on-chain)
        // Market is a numeric index (0-3 for quantum markets)
        // Use VaultType.Base to get the base vault's conditional mints
        log('📡 Fetching vault state from RPC...');
        const vaultFetchStart = Date.now();
        const { VaultType } = await import('@/lib/programs/vault');
        const vaultState = await fetchVaultState(new PublicKey(proposal.vaultPDA), VaultType.Base);
        log('✅ Vault state fetched', { took: Date.now() - vaultFetchStart + 'ms', mintsCount: vaultState.conditionalMints?.length });
        const tokenAddress = vaultState.conditionalMints[market];
        const poolAddress = proposal.ammData?.[market]?.pool;

        if (!tokenAddress || !poolAddress) {
          log('❌ Missing addresses', { tokenAddress, poolAddress, market });
          throw new Error(`Missing market ${market} addresses`);
        }
        log('✅ Addresses resolved', { tokenAddress: tokenAddress.slice(0, 8) + '...', poolAddress: poolAddress?.slice(0, 8) + '...' });

        // Wait for TradingView library to load with timeout
        if (typeof window === 'undefined' || !window.TradingView) {
          retryCount++;
          log('⏳ TradingView not loaded yet', { attempt: retryCount, maxRetries: MAX_RETRIES });
          if (retryCount >= MAX_RETRIES) {
            throw new Error(
              'TradingView library failed to load. This may be due to a CDN issue or ad blocker. ' +
              'Please refresh the page or check your browser console for errors.'
            );
          }
          // If library not loaded yet, wait a bit and retry
          setTimeout(initChart, 500);
          return;
        }
        log('✅ TradingView library loaded');

        // Wait for container to be mounted in DOM
        if (!containerRef.current) {
          containerRetryCount++;
          log('⏳ Container not ready', { attempt: containerRetryCount, maxRetries: MAX_CONTAINER_RETRIES });
          if (containerRetryCount >= MAX_CONTAINER_RETRIES) {
            throw new Error('Chart container failed to mount');
          }
          setTimeout(initChart, 100);
          return;
        }
        log('✅ Container ready');

        // Check if component is still mounted
        if (!isMounted) {
          log('⚠️ Component unmounted, aborting');
          return;
        }

        // Create datafeed with spot pool address for overlay support
        log('📊 Creating datafeed...');
        const datafeed = new ProposalMarketDatafeed(proposalId, market, proposal.spotPoolAddress, moderatorId, marketLabel);
        datafeed.setAddresses(tokenAddress, poolAddress);
        log('✅ Datafeed created');

        // Clear any existing widget
        containerRef.current.innerHTML = '';

        // Create widget
        log('📊 Creating TradingView widget...');
        const widgetCreateStart = Date.now();
        const widget = new window.TradingView.widget({
          container: containerRef.current,
          library_path: '/charting_library/charting_library/',
          datafeed: datafeed,
          symbol: `MARKET-${market}`,
          interval: '1' as any,
          timezone: 'Etc/UTC',
          theme: 'dark',
          locale: 'en',
          autosize: true,
          style: '1', // 1 = Candles (default)
          save_load_adapter: null, // Disable saving/loading chart settings
          auto_save_delay: 0, // Disable auto-save
          disabled_features: [
            'header_symbol_search',
            'symbol_search_hot_key',
            'header_compare',
            'header_undo_redo',
            'header_screenshot',
            'header_chart_type',
            'header_settings',
            'header_indicators',
            'header_fullscreen_button',
            'left_toolbar',
            'control_bar',
            'timeframes_toolbar',
            'volume_force_overlay',
            'create_volume_indicator_by_default',
          ],
          enabled_features: [
            'hide_left_toolbar_by_default',
          ],
          custom_css_url: '/charting_library/charting_library/custom.css',
          custom_formatters: {
            priceFormatterFactory: () => ({
              format: (price: number) => formatUSD(price, 2)
            }),
          },
          overrides: {
            'paneProperties.background': '#121212',
            'paneProperties.backgroundType': 'solid',
            'paneProperties.vertGridProperties.color': '#191919',
            'paneProperties.horzGridProperties.color': '#191919',
            'paneProperties.separatorColor': '#121212',
            'symbolWatermarkProperties.transparency': 98,
            'symbolWatermarkProperties.color': 'rgba(255, 255, 255, 0.02)',
            'scalesProperties.textColor': '#9ca3af',
            'scalesProperties.lineColor': '#191919',
            // Force price scale to show absolute prices, not percentage/log/indexed
            'scalesProperties.scaleSeriesOnly': false,
            'scalesProperties.percentage': false,
            'mainSeriesProperties.priceAxisProperties.percentage': false,
            'mainSeriesProperties.priceAxisProperties.log': false,
            'mainSeriesProperties.priceAxisProperties.indexedTo100': false,
            'mainSeriesProperties.priceAxisProperties.autoScale': true,
            // Standard trading colors: green = up, red = down
            'mainSeriesProperties.candleStyle.upColor': '#6ECC94',
            'mainSeriesProperties.candleStyle.downColor': '#FF6F94',
            'mainSeriesProperties.candleStyle.borderUpColor': '#6ECC94',
            'mainSeriesProperties.candleStyle.borderDownColor': '#FF6F94',
            'mainSeriesProperties.candleStyle.wickUpColor': '#6ECC94',
            'mainSeriesProperties.candleStyle.wickDownColor': '#FF6F94',
            'mainSeriesProperties.candleStyle.drawWick': true,
            'mainSeriesProperties.candleStyle.drawBorder': true,
            // Hollow candles
            'mainSeriesProperties.hollowCandleStyle.upColor': '#6ECC94',
            'mainSeriesProperties.hollowCandleStyle.downColor': '#FF6F94',
            'mainSeriesProperties.hollowCandleStyle.borderUpColor': '#6ECC94',
            'mainSeriesProperties.hollowCandleStyle.borderDownColor': '#FF6F94',
            'mainSeriesProperties.hollowCandleStyle.wickUpColor': '#6ECC94',
            'mainSeriesProperties.hollowCandleStyle.wickDownColor': '#FF6F94',
            // Bars
            'mainSeriesProperties.barStyle.upColor': '#6ECC94',
            'mainSeriesProperties.barStyle.downColor': '#FF6F94',
            'mainSeriesProperties.lineStyle.color': '#6ECC94',
            'mainSeriesProperties.areaStyle.color1': 'rgba(110, 204, 148, 0.3)',
            'mainSeriesProperties.areaStyle.color2': 'rgba(110, 204, 148, 0.05)',
            'mainSeriesProperties.areaStyle.linecolor': '#6ECC94',
          },
        });
        log('✅ Widget constructor completed', { took: Date.now() - widgetCreateStart + 'ms' });

        widgetRef.current = widget;

        // Set timeout for chart ready - auto-retry if it doesn't fire
        log('⏱️ Starting chart ready timeout', { timeout: CHART_READY_TIMEOUT + 'ms' });
        chartReadyTimeoutRef = setTimeout(() => {
          if (!isMounted) return;
          log('❌ TIMEOUT: onChartReady never fired!', { waited: CHART_READY_TIMEOUT + 'ms' });
          console.warn(`[Chart market-${market}] Chart ready timeout after ${CHART_READY_TIMEOUT}ms`);

          // Cleanup current widget
          if (widgetRef.current) {
            try {
              widgetRef.current.remove();
            } catch (e) {
              // Ignore cleanup errors
            }
            widgetRef.current = null;
          }

          // Retry or show error
          if (chartRetryCount < MAX_CHART_READY_RETRIES) {
            console.log(`[Chart market-${market}] Retrying... (attempt ${chartRetryCount + 2}/${MAX_CHART_READY_RETRIES + 1})`);
            setChartRetryCount(prev => prev + 1);
          } else {
            setError('Chart failed to load. Please refresh the page.');
            setIsLoading(false);
          }
        }, CHART_READY_TIMEOUT);

        // Wait for chart to be ready before hiding loading state
        log('⏳ Waiting for onChartReady callback...');
        widget.onChartReady(async () => {
          // Cancel timeout on success
          if (chartReadyTimeoutRef) {
            clearTimeout(chartReadyTimeoutRef);
            chartReadyTimeoutRef = null;
          }
          log('🎉 onChartReady FIRED!', { totalTime: Date.now() - startTime + 'ms' });
          console.log(`[Chart market-${market}] Chart ready`);
          const chart = widget.chart();

          setIsLoading(false);
          log('✅ Loading state cleared, chart visible');

          // Add spot price overlay FIRST (if available)
          // Note: Compare study automatically switches to percentage mode
          if (proposal.spotPoolAddress) {
            try {
              console.log(`[Chart market-${market}] Adding spot price overlay for pool ${proposal.spotPoolAddress}`);

              // Use the chart's createStudy method to add a line overlay
              // The 'Compare' study allows adding additional price series
              // The main datafeed (ProposalMarketDatafeed) handles 'SPOT-MARKET' symbol requests
              // WARNING: Compare study automatically switches to percentage mode!
              const studyId = await chart.createStudy(
                'Compare',     // indicator name
                false,         // forceOverlay
                false,         // lock
                {              // inputs
                  symbol: 'SPOT-MARKET',
                  source: 'close',
                },
                {              // overrides
                  'plot.color': '#9ca3af',      // Neutral gray (default is #9C27B0 purple)
                  'plot.linewidth': 2,
                  'plot.transparency': 0,
                  'plot.linestyle': 0,          // Solid line
                }
              );

              console.log(`[Chart market-${market}] ✅ Spot price overlay added (study ID: ${studyId}, color: #9ca3af)`);
            } catch (error) {
              console.error(`[Chart market-${market}] ❌ Failed to add spot price overlay:`, error);
              // Don't throw - chart should still work without overlay
            }
          }

          // Force normal price scale mode AFTER adding Compare study
          // Compare study automatically switches to percentage mode, so we override it here
          try {
            const panes = chart.getPanes();

            if (panes && panes.length > 0) {
              const rightScales = panes[0].getRightPriceScales();

              if (rightScales && rightScales.length > 0) {
                const currentMode = rightScales[0].getMode();
                console.log(`[Chart market-${market}] Current price scale mode (after Compare): ${currentMode}`);

                // Mode 0 = Normal, 1 = Log, 2 = Percentage, 3 = IndexedTo100
                if (currentMode !== 0) {
                  rightScales[0].setMode(0); // Set to Normal mode
                  const newMode = rightScales[0].getMode();
                  console.log(`[Chart market-${market}] ✅ Forced Normal mode (was ${currentMode}, now ${newMode})`);
                } else {
                  console.log(`[Chart market-${market}] Price scale already in Normal mode`);
                }
              }
            }
          } catch (e) {
            console.error(`[Chart market-${market}] Failed to set price scale mode:`, e);
          }
        });
      } catch (err) {
        log('❌ ERROR during initialization', { error: err instanceof Error ? err.message : err });
        console.error('Error initializing chart:', err);
        setError(err instanceof Error ? err.message : 'Failed to load chart');
        setIsLoading(false);
      }
    };

    initChart();

    // Cleanup
    return () => {
      isMounted = false;
      if (chartReadyTimeoutRef) {
        clearTimeout(chartReadyTimeoutRef);
      }
      if (widgetRef.current) {
        try {
          widgetRef.current.remove();
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    };
  }, [proposalId, market, chartRetryCount]);

  return (
    <div style={{ position: 'relative', height: typeof height === 'number' ? `${height}px` : height, width: '100%' }}>
      {/* Chart container - always rendered so ref is attached */}
      <div
        ref={containerRef}
        style={{
          height: typeof height === 'number' ? `${height}px` : height,
          width: '100%',
          background: '#121212'
        }}
      />

      {/* Loading overlay */}
      {isLoading && (
        <div
          className="flex items-center justify-center text-theme-text-disabled text-sm"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: '#121212',
            zIndex: 10
          }}
        >
          <div className="text-center">
            <div className="text-4xl mb-2 animate-pulse">📊</div>
            <div>Loading chart...</div>
          </div>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div
          className="flex items-center justify-center text-theme-text-disabled text-sm"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: '#121212',
            zIndex: 10
          }}
        >
          <div className="text-center">
            <div className="text-4xl mb-2">📊</div>
            <div>{error}</div>
          </div>
        </div>
      )}
    </div>
  );
}
