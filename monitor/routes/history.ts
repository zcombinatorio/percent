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

import { Router, Request, Response, NextFunction } from 'express';
import { HistoryService } from '@app/services/history.service';

const router = Router();

/**
 * Extract and validate proposal PDA from route params
 */
function getProposalPda(req: Request): string {
  const { pda } = req.params;
  if (!pda || typeof pda !== 'string' || pda.length < 32) {
    throw new Error('Invalid proposal PDA');
  }
  return pda;
}

/**
 * Parse optional date query parameters
 */
function parseDateParams(req: Request): { from?: Date; to?: Date } {
  const { from, to } = req.query;
  let fromDate: Date | undefined;
  let toDate: Date | undefined;

  if (from && typeof from === 'string') {
    fromDate = new Date(from);
    if (isNaN(fromDate.getTime())) {
      throw new Error('Invalid from date format');
    }
  }

  if (to && typeof to === 'string') {
    toDate = new Date(to);
    if (isNaN(toDate.getTime())) {
      throw new Error('Invalid to date format');
    }
  }

  return { from: fromDate, to: toDate };
}

/**
 * Get TWAP history for a proposal
 * GET /:pda/twap?from=&to=
 */
router.get('/:pda/twap', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposalPda = getProposalPda(req);
    const { from, to } = parseDateParams(req);

    const twapData = await HistoryService.getCmbTWAPHistory(proposalPda, from, to);

    res.json({
      proposalPda,
      count: twapData.length,
      data: twapData.map(twap => ({
        id: twap.id,
        timestamp: twap.timestamp.toISOString(),
        twaps: twap.twaps.map(t => t.toString()),
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * Get trade history for a proposal
 * GET /:pda/trades?from=&to=&limit=
 */
router.get('/:pda/trades', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposalPda = getProposalPda(req);
    const { from, to } = parseDateParams(req);

    const { limit } = req.query;
    let limitNum: number | undefined;

    if (limit && typeof limit === 'string') {
      limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum <= 0) {
        return res.status(400).json({ error: 'Invalid limit - must be a positive number' });
      }
    }

    const trades = await HistoryService.getCmbTradeHistory(proposalPda, from, to, limitNum || 100);

    res.json({
      proposalPda,
      count: trades.length,
      data: trades.map(trade => ({
        id: trade.id,
        timestamp: trade.timestamp.toISOString(),
        market: trade.market,
        trader: trade.trader,
        isBaseToQuote: trade.isBaseToQuote,
        amountIn: trade.amountIn.toString(),
        amountOut: trade.amountOut.toString(),
        feeAmount: trade.feeAmount?.toString(),
        txSignature: trade.txSignature,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * Get trade volume for a proposal
 * GET /:pda/volume?from=&to=
 */
router.get('/:pda/volume', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposalPda = getProposalPda(req);
    const { from, to } = parseDateParams(req);

    const volumeData = await HistoryService.getCmbTradeVolume(proposalPda, from, to);

    res.json({
      proposalPda,
      totalVolume: volumeData.totalVolume.toString(),
      totalTradeCount: volumeData.totalTradeCount,
      byMarket: volumeData.byMarket.map(m => ({
        market: m.market,
        volume: m.volume.toString(),
        tradeCount: m.tradeCount,
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

/**
 * Get chart data (OHLCV) for a proposal
 * GET /:pda/chart?interval=&from=&to=
 */
router.get('/:pda/chart', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const proposalPda = getProposalPda(req);
    const { from, to } = parseDateParams(req);

    const { interval } = req.query;

    if (!interval || typeof interval !== 'string') {
      return res.status(400).json({
        error: 'Missing required interval parameter',
        validIntervals: ['1m', '5m', '15m', '1h', '4h', '1d'],
      });
    }

    const validIntervals = ['1m', '5m', '15m', '1h', '4h', '1d'];
    if (!validIntervals.includes(interval)) {
      return res.status(400).json({
        error: 'Invalid interval',
        validIntervals,
      });
    }

    // For sparse data, expand lookback window to at least 24 hours
    const minLookbackMs = 24 * 60 * 60 * 1000;
    let effectiveFrom = from;

    if (from) {
      const requestedLookback = Date.now() - from.getTime();
      if (requestedLookback < minLookbackMs) {
        effectiveFrom = new Date(Date.now() - minLookbackMs);
      }
    } else {
      effectiveFrom = new Date(Date.now() - minLookbackMs);
    }

    const chartData = await HistoryService.getCmbChartData(
      proposalPda,
      interval as '1m' | '5m' | '15m' | '1h' | '4h' | '1d',
      effectiveFrom,
      to
    );

    res.json({
      proposalPda,
      interval,
      count: chartData.length,
      data: chartData.map(point => ({
        timestamp: new Date(point.timestamp).toISOString(),
        market: point.market === -1 ? 'spot' : point.market,
        open: point.open.toString(),
        high: point.high.toString(),
        low: point.low.toString(),
        close: point.close.toString(),
        volume: point.volume?.toString() || '0',
      })),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

export default router;
