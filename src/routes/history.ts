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

import { Router } from 'express';
import { HistoryService } from '../../app/services/history.service';
import { requireModeratorId, getProposalId } from '@src/middleware/validation';
import { PersistenceService } from '@app/services/persistence.service';
import { LoggerService } from '../../app/services/logger.service';

const router = Router();
const logger = new LoggerService('api').createChild('history');
router.use(requireModeratorId); // require moderatorId for all history routes

/**
 * Get TWAP history for a proposal
 * GET /:id/twap?from=&to=
 * 
 * Query parameters:
 * - from: ISO date string (optional)
 * - to: ISO date string (optional)
 */
router.get('/:id/twap', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const proposalId = getProposalId(req);

    const { from, to } = req.query;

    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (from && typeof from === 'string') {
      fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) {
        logger.warn('[GET /:id/twap] Invalid from date format', {
          proposalId,
          from
        });
        return res.status(400).json({ error: 'Invalid from date format' });
      }
    }

    if (to && typeof to === 'string') {
      toDate = new Date(to);
      if (isNaN(toDate.getTime())) {
        logger.warn('[GET /:id/twap] Invalid to date format', {
          proposalId,
          to
        });
        return res.status(400).json({ error: 'Invalid to date format' });
      }
    }

    const twapData = await HistoryService.getTWAPHistory(
      moderatorId,
      proposalId,
      fromDate,
      toDate
    );

    logger.info('[GET /:id/twap] TWAP history retrieved', {
      proposalId,
      moderatorId,
      count: twapData.length,
      from: fromDate?.toISOString(),
      to: toDate?.toISOString()
    });

    res.json({
      moderatorId,
      proposalId,
      count: twapData.length,
      data: twapData.map(twap => ({
        id: twap.id,
        timestamp: twap.timestamp.toISOString(),
        twaps: twap.twaps.map(t => t.toString()),
        aggregations: twap.aggregations.map(a => a.toString()),
      }))
    });
  } catch (error) {
    logger.error('[GET /:id/twap] Failed to get TWAP history', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id
    });
    next(error);
  }
});

/**
 * Get trade history for a proposal
 * GET /:id/trades?from=&to=&limit=
 * 
 * Query parameters:
 * - from: ISO date string (optional)
 * - to: ISO date string (optional)
 * - limit: number (optional, default 100)
 */
router.get('/:id/trades', async (req, res, next) => {
  try {
    const proposalId = getProposalId(req);
    const moderatorId = req.moderatorId;

    const { from, to, limit } = req.query;

    let fromDate: Date | undefined;
    let toDate: Date | undefined;
    let limitNum: number | undefined;

    if (from && typeof from === 'string') {
      fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) {
        logger.warn('[GET /:id/trades] Invalid from date format', {
          proposalId,
          from
        });
        return res.status(400).json({ error: 'Invalid from date format' });
      }
    }

    if (to && typeof to === 'string') {
      toDate = new Date(to);
      if (isNaN(toDate.getTime())) {
        logger.warn('[GET /:id/trades] Invalid to date format', {
          proposalId,
          to
        });
        return res.status(400).json({ error: 'Invalid to date format' });
      }
    }

    if (limit && typeof limit === 'string') {
      limitNum = parseInt(limit);
      if (isNaN(limitNum) || limitNum <= 0) {
        logger.warn('[GET /:id/trades] Invalid limit value', {
          proposalId,
          limit
        });
        return res.status(400).json({ error: 'Invalid limit - must be a positive number' });
      }
    }

    const trades = await HistoryService.getTradeHistory(
      moderatorId,
      proposalId,
      fromDate,
      toDate,
      limitNum || 100
    );

    // Get current SOL/USD price for market cap calculation
    const { SolPriceService } = await import('../../app/services/sol-price.service');
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getSolPrice();

    logger.info('[GET /:id/trades] Trade history retrieved', {
      proposalId,
      moderatorId,
      count: trades.length,
      limit: limitNum || 100,
      from: fromDate?.toISOString(),
      to: toDate?.toISOString()
    });

    res.json({
      moderatorId,
      proposalId,
      count: trades.length,
      data: trades.map(trade => ({
        id: trade.id,
        timestamp: trade.timestamp.toISOString(),
        market: trade.market,
        userAddress: trade.userAddress,
        isBaseToQuote: trade.isBaseToQuote,
        amountIn: trade.amountIn.toString(),
        amountOut: trade.amountOut.toString(),
        price: trade.price.toString(),
        txSignature: trade.txSignature,
        marketCapUsd: trade.totalSupply && trade.baseDecimals !== undefined
          ? trade.price.toNumber() * trade.totalSupply * solPrice
          : undefined,
      }))
    });
  } catch (error) {
    logger.error('[GET /:id/trades] Failed to get trade history', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id
    });
    next(error);
  }
});

/**
 * Get chart data for a proposal
 * GET /:id/chart?interval=&from=&to=
 * 
 * Query parameters:
 * - interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' (required)
 * - from: ISO date string (optional)
 * - to: ISO date string (optional)
 */
router.get('/:id/chart', async (req, res, next) => {
  try {
    const proposalId = getProposalId(req);
    const moderatorId = req.moderatorId;

    const { interval, from, to } = req.query;

    if (!interval || typeof interval !== 'string') {
      logger.warn('[GET /:id/chart] Missing required interval parameter', {
        proposalId,
        receivedParams: Object.keys(req.query)
      });
      return res.status(400).json({
        error: 'Missing required interval parameter',
        validIntervals: ['1m', '5m', '15m', '1h', '4h', '1d']
      });
    }

    const validIntervals = ['1m', '5m', '15m', '1h', '4h', '1d'];
    if (!validIntervals.includes(interval)) {
      logger.warn('[GET /:id/chart] Invalid interval', {
        proposalId,
        interval
      });
      return res.status(400).json({
        error: 'Invalid interval',
        validIntervals
      });
    }

    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (from && typeof from === 'string') {
      fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) {
        logger.warn('[GET /:id/chart] Invalid from date format', {
          proposalId,
          from
        });
        return res.status(400).json({ error: 'Invalid from date format' });
      }
    }

    if (to && typeof to === 'string') {
      toDate = new Date(to);
      if (isNaN(toDate.getTime())) {
        logger.warn('[GET /:id/chart] Invalid to date format', {
          proposalId,
          to
        });
        return res.status(400).json({ error: 'Invalid to date format' });
      }
    }

    // For sparse data (like predictions markets with few trades),
    // expand the lookback window to at least 24 hours to ensure we catch data points
    const minLookbackMs = 24 * 60 * 60 * 1000; // 24 hours
    let effectiveFromDate = fromDate;

    if (fromDate) {
      const requestedLookback = Date.now() - fromDate.getTime();
      if (requestedLookback < minLookbackMs) {
        effectiveFromDate = new Date(Date.now() - minLookbackMs);
      }
    } else {
      effectiveFromDate = new Date(Date.now() - minLookbackMs);
    }

    const chartData = await HistoryService.getChartData(
      moderatorId,
      proposalId,
      interval as '1m' | '5m' | '15m' | '1h' | '4h' | '1d',
      effectiveFromDate,
      toDate
    );

    // Get proposal to access totalSupply and baseDecimals
    const persistenceService = new PersistenceService(moderatorId, logger.createChild('persistence'));
    const proposal = await persistenceService.loadProposal(proposalId);
    const totalSupply = proposal?.config.totalSupply || 1000000000;
    const baseDecimals = proposal?.config.baseDecimals || 6;
    // totalSupply is already decimal-adjusted when stored in database
    const actualSupply = totalSupply;

    // Get current SOL/USD price
    const { SolPriceService } = await import('../../app/services/sol-price.service');
    const solPriceService = SolPriceService.getInstance();
    const solPrice = await solPriceService.getSolPrice();

    // Transform data to USD market cap (price × actual supply × SOL price) and ISO strings for JSON serialization
    // Note: Spot prices are already in USD market cap, so don't convert them
    const formattedData = chartData.map(point => {
      // Spot prices are already market cap USD, other markets need conversion
      const multiplier = point.market === -1 ? 1 : (actualSupply * solPrice);

      return {
        timestamp: new Date(point.timestamp).toISOString(),
        market: point.market,
        open: (point.open * multiplier).toString(),
        high: (point.high * multiplier).toString(),
        low: (point.low * multiplier).toString(),
        close: (point.close * multiplier).toString(),
        volume: point.volume?.toString() || '0'
      };
    });

    logger.info('[GET /:id/chart] Chart data retrieved', {
      proposalId,
      moderatorId,
      interval,
      count: formattedData.length,
      from: fromDate?.toISOString(),
      to: toDate?.toISOString()
    });

    res.json({
      moderatorId,
      proposalId,
      interval,
      count: formattedData.length,
      data: formattedData
    });
  } catch (error) {
    logger.error('[GET /:id/chart] Failed to get chart data', {
      error: error instanceof Error ? error.message : String(error),
      proposalId: req.params.id,
      interval: req.query.interval
    });
    next(error);
  }
});

export default router;