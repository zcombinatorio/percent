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

import { Connection, PublicKey } from '@solana/web3.js';
import { CpAmm, getPriceFromSqrtPrice, getTokenDecimals } from '@meteora-ag/cp-amm-sdk';
import { Monitor, MonitoredProposal, SwapEvent } from '../monitor';
import { SSEManager } from '../lib/sse';

/**
 * SSE Events:
 * - PRICE_UPDATE: { proposalPda, market, price, marketCapUsd, timestamp }
 * - SWAP: { proposalPda, pool, market, trader, isBaseToQuote, amountIn, amountOut, feeAmount, timestamp }
 */

export class PriceService {
  private monitor: Monitor | null = null;
  private connection: Connection;
  private cpAmm: CpAmm;

  // Proposal metadata cache: proposalPda -> { totalSupply, spotPool, pools }
  private proposalData = new Map<string, {
    totalSupply: number;
    spotPool?: string;
    pools: string[];
  }>();

  // Spot price polling timers
  private spotPollingTimers = new Map<string, NodeJS.Timeout>();
  private readonly SPOT_POLL_INTERVAL_MS = 60_000;

  // SOL price for market cap calculations (updated periodically)
  private solPrice = 0;

  constructor(private sse: SSEManager, rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.cpAmm = new CpAmm(this.connection);
  }

  /** Subscribe to monitor events and start price tracking */
  start(monitor: Monitor) {
    this.monitor = monitor;

    // Subscribe to swap events
    monitor.on('swap', (swap) => this.onCondSwap(swap));

    // Subscribe to proposal lifecycle
    monitor.on('proposal:added', (p) => this.startTracking(p));
    monitor.on('proposal:removed', (p) => this.stopTracking(p));

    // Track existing proposals
    for (const p of monitor.getMonitored()) {
      this.startTracking(p);
    }

    console.log('[PriceService] Started');
  }

  /** Stop price tracking and cleanup */
  stop() {
    for (const timer of this.spotPollingTimers.values()) {
      clearInterval(timer);
    }
    this.spotPollingTimers.clear();
    this.proposalData.clear();
    this.monitor = null;
    console.log('[PriceService] Stopped');
  } 

  // ─── Price Tracking ──────────────────────────────────────────────

  private startTracking(proposal: MonitoredProposal) {
    // ** TODO: Fetch totalSupply from on-chain proposal account
    const totalSupply = 1_000_000_000; // Placeholder

    this.proposalData.set(proposal.proposalPda, {
      totalSupply,
      spotPool: proposal.spotPool,
      pools: proposal.pools,
    });

    // Start spot price polling if spotPool exists
    if (proposal.spotPool) {
      this.startSpotPricePolling(proposal.proposalPda, proposal.spotPool);
    }

    console.log(`[PriceService] Tracking ${proposal.proposalPda} (${proposal.pools.length} pools)`);
  }

  private stopTracking(proposal: MonitoredProposal) {
    const timer = this.spotPollingTimers.get(proposal.proposalPda);
    if (timer) {
      clearInterval(timer);
      this.spotPollingTimers.delete(proposal.proposalPda);
    }
    this.proposalData.delete(proposal.proposalPda);
    console.log(`[PriceService] Stopped tracking ${proposal.proposalPda}`);
  }

  // ─── Price Fetching ─────────────────────────────────────────────

  private async fetchPoolPrice(poolAddress: string): Promise<number | null> {
    try {
      const poolState = await this.cpAmm.fetchPoolState(new PublicKey(poolAddress));
      const [tokenADecimal, tokenBDecimal] = await Promise.all([
        getTokenDecimals(this.connection, poolState.tokenAMint),
        getTokenDecimals(this.connection, poolState.tokenBMint),
      ]);
      const price = getPriceFromSqrtPrice(poolState.sqrtPrice, tokenADecimal, tokenBDecimal);
      return price.toNumber();
    } catch (error) {
      console.error(`[PriceService] Error fetching pool price for ${poolAddress}:`, error);
      return null;
    }
  }

  // ─── Spot Price Polling ─────────────────────────────────────────

  private startSpotPricePolling(proposalPda: string, spotPool: string) {
    const poll = async () => {
      const price = await this.fetchPoolPrice(spotPool);
      if (price !== null) {
        const data = this.proposalData.get(proposalPda);
        const marketCapUsd = price * (data?.totalSupply || 0) * this.solPrice;
        this.onPriceChange(proposalPda, -1, price, marketCapUsd); // market=-1 for spot
      }
    };

    void poll(); // Initial fetch
    const timer = setInterval(poll, this.SPOT_POLL_INTERVAL_MS);
    this.spotPollingTimers.set(proposalPda, timer);
    console.log(`[PriceService] Started spot price polling for ${proposalPda}`);
  }

  // ─── Event Handlers ──────────────────────────────────────────────

  private onPriceChange(proposalPda: string, market: number, price: number, marketCapUsd: number) {
    // ** TODO: Save price to DB
    // await HistoryService.recordPrice({...});

    this.sse.broadcast('PRICE_UPDATE', {
      proposalPda,
      market,
      price,
      marketCapUsd,
      timestamp: Date.now(),
    });
  }

  private async onCondSwap(swap: SwapEvent) {
    // 1. Broadcast swap event
    this.sse.broadcast('COND_SWAP', {
      proposalPda: swap.proposalPda,
      pool: swap.pool,
      market: swap.market,
      trader: swap.trader,
      swapAToB: swap.swapAToB,
      amountIn: swap.amountIn.toString(),
      amountOut: swap.amountOut.toString(),
      timestamp: Date.now(),
    });

    // 2. ** TODO: Save trade to DB
    // await HistoryService.recordTrade({...});

    // 3. Fetch pool state and calculate new price
    const price = await this.fetchPoolPrice(swap.pool);
    if (price !== null) {
      const data = this.proposalData.get(swap.proposalPda);
      const marketCapUsd = price * (data?.totalSupply || 0) * this.solPrice;
      this.onPriceChange(swap.proposalPda, swap.market, price, marketCapUsd);
    }
  }
}
