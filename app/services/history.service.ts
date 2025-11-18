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

import { getPool } from '../utils/database';
import {
  IPriceHistory,
  ITWAPHistory,
  ITradeHistory,
  IChartDataPoint
} from '../types/history.interface';
import { Decimal } from 'decimal.js';

/**
 * Service for managing historical data in PostgreSQL
 * Provides recording and retrieval of price, TWAP, and trade history
 * Supports aggregated data for charts and analytics
 */
export class HistoryService {
  /**
   * Records a price snapshot to the database
   * Captures current price of an AMM
   * @param data - Price history data excluding auto-generated fields
   * @param data.moderatorId - ID of the moderator
   * @param data.proposalId - Global proposal ID
   * @param data.market - Which AMM market ('pass' or 'fail')
   * @param data.price - Current price at this point
   * @throws Error if database insert fails
   */
  static async recordPrice(data: Omit<IPriceHistory, 'id' | 'timestamp'>): Promise<void> {
    const pool = getPool();

    // We store moderatorId redundantly for faster queries without joins
    const query = `
      INSERT INTO i_price_history (
        moderator_id, proposal_id, market, price
      ) VALUES ($1, $2, $3, $4)
    `;

    await pool.query(query, [
      data.moderatorId,
      data.proposalId,
      data.market,
      data.price.toString()
    ]);
  }

  /**
   * Records a TWAP snapshot to the database
   * Captures both current TWAP values and cumulative aggregations
   * @param data - TWAP history data excluding auto-generated fields
   * @param data.moderatorId - ID of the moderator
   * @param data.proposalId - Global proposal ID
   * @param data.passTwap - Current pass market TWAP
   * @param data.failTwap - Current fail market TWAP
   * @param data.passAggregation - Cumulative pass price aggregation
   * @param data.failAggregation - Cumulative fail price aggregation
   * @throws Error if database insert fails
   */
  static async recordTWAP(data: Omit<ITWAPHistory, 'id' | 'timestamp'>): Promise<void> {
    const pool = getPool();

    const query = `
      INSERT INTO i_twap_history (
        moderator_id, proposal_id, pass_twap, fail_twap, pass_aggregation, fail_aggregation
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `;

    await pool.query(query, [
      data.moderatorId,
      data.proposalId,
      data.passTwap.toString(),
      data.failTwap.toString(),
      data.passAggregation.toString(),
      data.failAggregation.toString()
    ]);
  }

  /**
   * Records a trade transaction to the database
   * Captures swap details including user, amounts, and execution price
   * @param data - Trade history data excluding auto-generated fields
   * @param data.moderatorId - ID of the moderator
   * @param data.proposalId - Global proposal ID
   * @param data.market - Which AMM was traded ('pass' or 'fail')
   * @param data.userAddress - Wallet address of the trader
   * @param data.isBaseToQuote - Direction of the trade
   * @param data.amountIn - Amount of tokens swapped in
   * @param data.amountOut - Amount of tokens received
   * @param data.price - Execution price of the trade
   * @param data.txSignature - Optional Solana transaction signature
   * @throws Error if database insert fails
   */
  static async recordTrade(data: Omit<ITradeHistory, 'id' | 'timestamp'>): Promise<void> {
    const pool = getPool();

    const query = `
      INSERT INTO i_trade_history (
        moderator_id, proposal_id, market, user_address, is_base_to_quote,
        amount_in, amount_out, price, tx_signature
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    await pool.query(query, [
      data.moderatorId,
      data.proposalId,
      data.market,
      data.userAddress,
      data.isBaseToQuote,
      data.amountIn.toString(),
      data.amountOut.toString(),
      data.price.toString(),
      data.txSignature || null
    ]);
  }

  /**
   * Retrieves TWAP history for a proposal
   * Returns time-weighted average price snapshots with aggregations
   * @param moderatorId - ID of the moderator
   * @param proposalId - Global proposal ID
   * @param from - Optional start date filter
   * @param to - Optional end date filter
   * @returns Array of TWAP history records ordered by timestamp descending
   * @throws Error if database query fails
   */
  static async getTWAPHistory(
    moderatorId: number,
    proposalId: number,
    from?: Date,
    to?: Date
  ): Promise<ITWAPHistory[]> {
    const pool = getPool();

    let query = `
      SELECT * FROM i_twap_history
      WHERE moderator_id = $1 AND proposal_id = $2
    `;
    const params: (number | Date)[] = [moderatorId, proposalId];

    if (from) {
      params.push(from);
      query += ` AND timestamp >= $${params.length}`;
    }

    if (to) {
      params.push(to);
      query += ` AND timestamp <= $${params.length}`;
    }

    query += ' ORDER BY timestamp DESC';

    const result = await pool.query(query, params);

    return result.rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      moderatorId: row.moderator_id,
      proposalId: row.proposal_id,
      passTwap: new Decimal(row.pass_twap),
      failTwap: new Decimal(row.fail_twap),
      passAggregation: new Decimal(row.pass_aggregation),
      failAggregation: new Decimal(row.fail_aggregation),
    }));
  }

  /**
   * Retrieves trade history for a proposal
   * Returns individual swap transactions with user attribution
   * @param moderatorId - ID of the moderator
   * @param proposalId - Global proposal ID
   * @param from - Optional start date filter
   * @param to - Optional end date filter
   * @param limit - Optional maximum number of records to return
   * @returns Array of trade history records ordered by timestamp descending
   * @throws Error if database query fails
   */
  static async getTradeHistory(
    moderatorId: number,
    proposalId: number,
    from?: Date,
    to?: Date,
    limit?: number
  ): Promise<ITradeHistory[]> {
    const pool = getPool();

    let query = `
      SELECT
        t.*,
        p.total_supply
      FROM i_trade_history t
      LEFT JOIN i_proposals p ON t.moderator_id = p.moderator_id
        AND t.proposal_id = p.proposal_id
      WHERE t.moderator_id = $1 AND t.proposal_id = $2
    `;
    const params: (number | Date)[] = [moderatorId, proposalId];

    if (from) {
      params.push(from);
      query += ` AND t.timestamp >= $${params.length}`;
    }

    if (to) {
      params.push(to);
      query += ` AND t.timestamp <= $${params.length}`;
    }

    query += ' ORDER BY t.timestamp DESC';

    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    const result = await pool.query(query, params);

    return result.rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      moderatorId: row.moderator_id,
      proposalId: row.proposal_id,
      market: row.market,
      userAddress: row.user_address,
      isBaseToQuote: row.is_base_to_quote,
      amountIn: new Decimal(row.amount_in),
      amountOut: new Decimal(row.amount_out),
      price: new Decimal(row.price),
      txSignature: row.tx_signature,
      totalSupply: row.total_supply ? parseInt(row.total_supply) : undefined,
    }));
  }

  /**
   * Retrieves aggregated chart data for a proposal
   * Combines price and volume data into time-bucketed points for visualization
   * @param moderatorId - ID of the moderator
   * @param proposalId - Global proposal ID
   * @param interval - Time interval for aggregation buckets
   * @param from - Optional start date filter
   * @param to - Optional end date filter
   * @returns Array of chart data points with prices and volume
   * @throws Error if database query fails
   *
   * Implementation details:
   * - Aggregates price data using AVG for each time bucket
   * - Calculates volume as sum of amountIn for trades in each bucket
   * - Uses FIRST_VALUE/LAST_VALUE for OHLC data (open/close prices)
   * - Combines data from both price_history and trade_history tables
   */
  static async getChartData(
    moderatorId: number,
    proposalId: number,
    interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d',
    from?: Date,
    to?: Date
  ): Promise<IChartDataPoint[]> {
    const pool = getPool();

    const intervalSeconds = HistoryService.parseInterval(interval);

    // Get aggregated price data with window functions
    let query = `
      WITH bucketed_prices AS (
        SELECT
          to_timestamp(floor(extract(epoch from timestamp) / ${intervalSeconds}) * ${intervalSeconds}) as bucket,
          market,
          price,
          timestamp,
          ROW_NUMBER() OVER (
            PARTITION BY market,
              floor(extract(epoch from timestamp) / ${intervalSeconds})
            ORDER BY timestamp ASC
          ) as first_row,
          ROW_NUMBER() OVER (
            PARTITION BY market,
              floor(extract(epoch from timestamp) / ${intervalSeconds})
            ORDER BY timestamp DESC
          ) as last_row
        FROM i_price_history
        WHERE moderator_id = $1 AND proposal_id = $2
    `;

    const params: (number | Date)[] = [moderatorId, proposalId];

    if (from) {
      params.push(from);
      query += ` AND timestamp >= $${params.length}`;
    }

    if (to) {
      params.push(to);
      query += ` AND timestamp <= $${params.length}`;
    }

    query += `
      )
      SELECT
        bucket,
        market,
        MAX(CASE WHEN first_row = 1 THEN price END) as open,
        MAX(price) as high,
        MIN(price) as low,
        MAX(CASE WHEN last_row = 1 THEN price END) as close
      FROM bucketed_prices
      GROUP BY bucket, market
      ORDER BY bucket DESC
    `;

    const priceResult = await pool.query(query, params);

    // Get trade volume data
    let volumeQuery = `
      SELECT
        to_timestamp(floor(extract(epoch from timestamp) / ${intervalSeconds}) * ${intervalSeconds}) as bucket,
        SUM(amount_in) as volume
      FROM i_trade_history
      WHERE moderator_id = $1 AND proposal_id = $2
    `;

    if (from) {
      volumeQuery += ` AND timestamp >= $3`;
    }
    if (to) {
      const toParam = from ? 4 : 3;
      volumeQuery += ` AND timestamp <= $${toParam}`;
    }

    volumeQuery += `
      GROUP BY bucket
      ORDER BY bucket DESC
    `;

    const volumeResult = await pool.query(volumeQuery, params);

    // Create volume lookup map by timestamp
    const volumeMap = new Map<number, number>();
    for (const row of volumeResult.rows) {
      const timestamp = new Date(row.bucket).getTime();
      volumeMap.set(timestamp, parseFloat(row.volume));
    }

    // Convert price data to chart points with OHLC
    const chartData: IChartDataPoint[] = priceResult.rows.map(row => ({
      timestamp: new Date(row.bucket).getTime(),
      moderatorId: moderatorId,
      market: row.market as 'pass' | 'fail',
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: volumeMap.get(new Date(row.bucket).getTime()) || 0,
    }));

    // Sort by timestamp ascending for forward-fill processing
    const sortedData = chartData.sort((a, b) => a.timestamp - b.timestamp);

    // Forward-fill: ensure each candle's open equals the previous candle's close
    // Group by market to handle pass/fail separately
    const marketGroups = new Map<'pass' | 'fail' | 'global' | 'spot', IChartDataPoint[]>();
    for (const point of sortedData) {
      if (!marketGroups.has(point.market)) {
        marketGroups.set(point.market, []);
      }
      marketGroups.get(point.market)!.push(point);
    }

    // Apply forward-fill within each market
    for (const [market, points] of marketGroups) {
      for (let i = 1; i < points.length; i++) {
        const prevClose = points[i - 1].close;
        const currentOpen = points[i].open;

        // If there's a gap, forward-fill the open with previous close
        if (prevClose !== currentOpen) {
          points[i].open = prevClose;
          // Also adjust low if the new open is lower than recorded low
          if (prevClose < points[i].low) {
            points[i].low = prevClose;
          }
          // Also adjust high if the new open is higher than recorded high
          if (prevClose > points[i].high) {
            points[i].high = prevClose;
          }
        }
      }
    }

    // Return sorted descending (most recent first)
    return sortedData.sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Parses interval string to seconds for SQL aggregation
   * @param interval - Interval string ('1m', '5m', '15m', '1h', '4h', '1d')
   * @returns Number of seconds in the interval
   * @private
   */
  private static parseInterval(interval: string): number {
    const intervals: Record<string, number> = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '1h': 3600,
      '4h': 14400,
      '1d': 86400,
    };

    return intervals[interval] || 60;
  }
}