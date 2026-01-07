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
import { getMint } from '@solana/spl-token';
import { CpAmm, getPriceFromSqrtPrice, getTokenDecimals } from '@meteora-ag/cp-amm-sdk';
import DLMM from '@meteora-ag/dlmm';
import { Monitor, MonitoredProposal, SwapEvent } from '../monitor';
import { SSEManager } from '../lib/sse';
import { logError } from '../lib/logger';
import { PoolType } from '@zcomb/programs-sdk';
import { HistoryService } from '@app/services/history.service';
import { Decimal } from 'decimal.js';

/**
 * SSE Events:
 * - PRICE_UPDATE: { proposalPda, market, price, marketCapUsd, timestamp }
 * - COND_SWAP: { proposalPda, pool, market, trader, swapAToB, amountIn, amountOut, txSignature, timestamp }
 */

export class PriceService {
  private monitor: Monitor | null = null;
  private connection: Connection;
  private cpAmm: CpAmm;

  // Proposal metadata cache: proposalPda -> { totalSupply, spotPool, spotPoolType, pools }
  private proposalData = new Map<string, {
    totalSupply: number;
    spotPool?: string;
    spotPoolType?: PoolType;
    pools: string[];
  }>();

  // Spot price polling timers
  private spotPollingTimers = new Map<string, NodeJS.Timeout>();
  private readonly SPOT_POLL_INTERVAL_MS = 30_000;

  // SOL price for market cap calculations (updated periodically)
  private solPrice = 0;
  private solPriceTimer: NodeJS.Timeout | null = null;
  private readonly SOL_PRICE_POLL_INTERVAL_MS = 30_000;
  private readonly SOL_USDC_DLMM_POOL = 'HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR';

  constructor(private sse: SSEManager, rpcUrl: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.cpAmm = new CpAmm(this.connection);
  }

  /** Subscribe to monitor events and start price tracking */
  start(monitor: Monitor) {
    this.monitor = monitor;
    // Start SOL price polling
    this.startSolPricePolling();

    // Subscribe to swap events
    monitor.on('swap', (swap) => this.onCondSwap(swap));

    // Subscribe to proposal lifecycle
    monitor.on('proposal:added', (p) => void this.startTracking(p));
    monitor.on('proposal:removed', (p) => this.stopTracking(p));

    // Track existing proposals
    for (const p of monitor.getMonitored()) {
      void this.startTracking(p);
    }

    console.log('[Price] Started');
  }

  /** Stop price tracking and cleanup */
  stop() {
    // Stop SOL price polling
    if (this.solPriceTimer) {
      clearInterval(this.solPriceTimer);
      this.solPriceTimer = null;
    }

    // Stop spot price polling
    for (const timer of this.spotPollingTimers.values()) {
      clearInterval(timer);
    }
    this.spotPollingTimers.clear();
    this.proposalData.clear();
    this.monitor = null;
    console.log('[Price] Stopped');
  } 

  // ─── Price Tracking ──────────────────────────────────────────────

  private async startTracking(proposal: MonitoredProposal) {
    // Fetch totalSupply from the baseMint
    let totalSupply = 0;
    try {
      const mintInfo = await getMint(this.connection, new PublicKey(proposal.baseMint));
      totalSupply = Math.floor(Number(mintInfo.supply) / Math.pow(10, mintInfo.decimals));
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Price] Error fetching mint info for ${proposal.baseMint}:`, errMsg);
      logError('price', {
        action: 'fetch_mint_info',
        proposalPda: proposal.proposalPda,
        baseMint: proposal.baseMint,
        error: errMsg,
      });
    }

    this.proposalData.set(proposal.proposalPda, {
      totalSupply,
      spotPool: proposal.spotPool,
      spotPoolType: proposal.spotPoolType,
      pools: proposal.pools,
    });

    // Broadcast initial conditional pool prices
    for (let i = 0; i < proposal.pools.length; i++) {
      const pool = proposal.pools[i];
      const price = await this.fetchPoolPrice(pool);
      if (price !== null) {
        const marketCapUsd = price * totalSupply * this.solPrice;
        this.onPriceChange(proposal.proposalPda, i, price, marketCapUsd);
      }
    }

    // Start spot price polling if spotPool exists
    if (proposal.spotPool) {
      this.startSpotPricePolling(proposal.proposalPda, proposal.spotPool, proposal.spotPoolType);
    }

    console.log(`[Price] Tracking ${proposal.proposalPda} (${proposal.pools.length} pools, supply=${totalSupply})`);
  }

  private stopTracking(proposal: MonitoredProposal) {
    const timer = this.spotPollingTimers.get(proposal.proposalPda);
    if (timer) {
      clearInterval(timer);
      this.spotPollingTimers.delete(proposal.proposalPda);
    }
    this.proposalData.delete(proposal.proposalPda);
    console.log(`[Price] Stopped tracking ${proposal.proposalPda}`);
  }

  // ─── Price Fetching ─────────────────────────────────────────────

  /** Fetch price from CP-AMM (DAMM) pool */
  private async fetchDammPoolPrice(poolAddress: string): Promise<number | null> {
    try {
      const poolState = await this.cpAmm.fetchPoolState(new PublicKey(poolAddress));
      const [tokenADecimal, tokenBDecimal] = await Promise.all([
        getTokenDecimals(this.connection, poolState.tokenAMint),
        getTokenDecimals(this.connection, poolState.tokenBMint),
      ]);
      const price = getPriceFromSqrtPrice(poolState.sqrtPrice, tokenADecimal, tokenBDecimal);
      return price.toNumber();
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Price] Error fetching DAMM pool price for ${poolAddress}:`, errMsg);
      logError('price', {
        action: 'fetch_damm_price',
        pool: poolAddress,
        error: errMsg,
      });
      return null;
    }
  }

  /** Fetch price from DLMM pool using active bin */
  private async fetchDlmmPoolPrice(poolAddress: string): Promise<number | null> {
    try {
      const dlmmPool = await DLMM.create(this.connection, new PublicKey(poolAddress));
      const activeBin = await dlmmPool.getActiveBin();
      // pricePerToken gives the price of token X in terms of token Y
      const price = parseFloat(activeBin.pricePerToken);
      return price;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Price] Error fetching DLMM pool price for ${poolAddress}:`, errMsg);
      logError('price', {
        action: 'fetch_dlmm_price',
        pool: poolAddress,
        error: errMsg,
      });
      return null;
    }
  }

  /** Fetch price from Futarchy AMM pool (conditional markets) */
  private async fetchPoolPrice(poolAddress: string): Promise<number | null> {
    if (!this.monitor) return null;

    try {
      const poolPda = new PublicKey(poolAddress);
      const spotPrice = await this.monitor.client.amm.fetchSpotPrice(poolPda);

      if (!spotPrice) return null;
      // Spot price is scaled by 1e12 (same as TWAP)
      return Number(spotPrice.toString()) / 1e12;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Price] Error fetching Futarchy pool price for ${poolAddress}:`, errMsg);
      logError('price', {
        action: 'fetch_futarchy_price',
        pool: poolAddress,
        error: errMsg,
      });
      return null;
    }
  }

  // ─── SOL Price Polling ─────────────────────────────────────────

  private startSolPricePolling() {
    const poll = async () => {
      const price = await this.fetchDlmmPoolPrice(this.SOL_USDC_DLMM_POOL);
      if (price !== null && price > 0) {
        this.solPrice = price;
        console.log(`[Price] Updated SOL price: $${price.toFixed(2)}`);
      }
    };

    void poll(); // Initial fetch
    this.solPriceTimer = setInterval(poll, this.SOL_PRICE_POLL_INTERVAL_MS);
    console.log('[Price] Started SOL price polling');
  }

  // ─── Spot Price Polling ─────────────────────────────────────────

  private startSpotPricePolling(proposalPda: string, spotPool: string, spotPoolType?: PoolType) {
    // Check if pool type is DLMM (Anchor enum: { dlmm: {} })
    const isDlmm = spotPoolType && 'dlmm' in spotPoolType;

    const poll = async () => {
      // Use appropriate price fetching method based on pool type
      const price = isDlmm
        ? await this.fetchDlmmPoolPrice(spotPool)
        : await this.fetchDammPoolPrice(spotPool);

      if (price !== null) {
        const data = this.proposalData.get(proposalPda);
        const marketCapUsd = price * (data?.totalSupply || 0) * this.solPrice;
        this.onPriceChange(proposalPda, -1, price, marketCapUsd); // market=-1 for spot
      }
    };

    void poll(); // Initial fetch
    const timer = setInterval(poll, this.SPOT_POLL_INTERVAL_MS);
    this.spotPollingTimers.set(proposalPda, timer);
    console.log(`[Price] Started spot price polling for ${proposalPda} (${isDlmm ? 'dlmm' : 'damm'})`);
  }

  // ─── Event Handlers ──────────────────────────────────────────────

  private async onPriceChange(proposalPda: string, market: number, price: number, marketCapUsd: number) {
    // Record to DB
    try {
      await HistoryService.recordCmbPrice({
        proposalPda,
        market,
        price: new Decimal(price),
        marketCapUsd: new Decimal(marketCapUsd),
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Price] Error recording price to DB:`, errMsg);
      logError('price', { action: 'record_price', proposalPda, market, error: errMsg });
    }

    // Broadcast SSE
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
      txSignature: swap.txSignature,
      timestamp: Date.now(),
    });

    // 2. Record trade to DB
    try {
      await HistoryService.recordCmbTrade({
        proposalPda: swap.proposalPda,
        market: swap.market,
        trader: swap.trader,
        isBaseToQuote: !swap.swapAToB, // A is Quote
        amountIn: new Decimal(swap.amountIn.toString()),
        amountOut: new Decimal(swap.amountOut.toString()),
        feeAmount: new Decimal(swap.feeAmount.toString()),
        txSignature: swap.txSignature,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Price] Error recording trade to DB:`, errMsg);
      logError('price', { action: 'record_trade', proposalPda: swap.proposalPda, error: errMsg });
    }

    // 3. Fetch pool state and calculate new price
    const price = await this.fetchPoolPrice(swap.pool);
    if (price !== null) {
      const data = this.proposalData.get(swap.proposalPda);
      const marketCapUsd = price * (data?.totalSupply || 0) * this.solPrice;
      this.onPriceChange(swap.proposalPda, swap.market, price, marketCapUsd);
    }
  }
}
