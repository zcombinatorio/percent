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
   * @param data.market - Market index (-1 for spot, 0+ for market index)
   * @param data.price - Current price at this point
   * @throws Error if database insert fails
   */
  static async recordPrice(data: Omit<IPriceHistory, 'id' | 'timestamp'>): Promise<void> {
    const pool = getPool();

    // We store moderatorId redundantly for faster queries without joins
    const query = `
      INSERT INTO qm_price_history (
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
   * @param data.twaps - Array of TWAPs for each market
   * @param data.aggregations - Array of cumulative aggregations for each market
   * @throws Error if database insert fails
   */
  static async recordTWAP(data: Omit<ITWAPHistory, 'id' | 'timestamp'>): Promise<void> {
    const pool = getPool();

    const query = `
      INSERT INTO qm_twap_history (
        moderator_id, proposal_id, twaps, aggregations
      ) VALUES ($1, $2, $3, $4)
    `;

    await pool.query(query, [
      data.moderatorId,
      data.proposalId,
      data.twaps.map(t => t.toString()),
      data.aggregations.map(a => a.toString())
    ]);
  }

  /**
   * Records a trade transaction to the database
   * Captures swap details including user, amounts, and execution price
   * @param data - Trade history data excluding auto-generated fields
   * @param data.moderatorId - ID of the moderator
   * @param data.proposalId - Global proposal ID
   * @param data.market - Market index (0+)
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
      INSERT INTO qm_trade_history (
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
      SELECT * FROM qm_twap_history
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
      twaps: row.twaps.map((t: string) => new Decimal(t)),
      aggregations: row.aggregations.map((a: string) => new Decimal(a)),
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
        p.total_supply,
        p.base_decimals
      FROM qm_trade_history t
      LEFT JOIN qm_proposals p ON t.moderator_id = p.moderator_id
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

    return result.rows.map(row => {
      if (row.base_decimals === null || row.base_decimals === undefined) {
        console.warn(`Trade ${row.id} for proposal ${row.proposal_id} missing base_decimals from joined proposal data`);
      }
      return {
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
        baseDecimals: row.base_decimals !== null && row.base_decimals !== undefined
          ? parseInt(row.base_decimals)
          : undefined,
      };
    });
  }

  /**
   * Retrieves total trade volume for a proposal, grouped by market
   * Calculates volume as SUM of amount_in for all trades
   * @param moderatorId - ID of the moderator
   * @param proposalId - Global proposal ID
   * @param from - Optional start date filter
   * @param to - Optional end date filter
   * @returns Object with volume per market and total volume
   * @throws Error if database query fails
   */
  static async getTradeVolume(
    moderatorId: number,
    proposalId: number,
    from?: Date,
    to?: Date
  ): Promise<{
    byMarket: { market: number; volume: Decimal; tradeCount: number }[];
    totalVolume: Decimal;
    totalTradeCount: number;
  }> {
    const pool = getPool();

    // Calculate volume in SOL terms:
    // - Buy (is_base_to_quote = false): user pays SOL, so amount_in is SOL
    // - Sell (is_base_to_quote = true): user receives SOL, so amount_out is SOL
    let query = `
      SELECT
        market,
        SUM(CASE WHEN is_base_to_quote THEN amount_out ELSE amount_in END) as volume,
        COUNT(*) as trade_count
      FROM qm_trade_history
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

    query += ` GROUP BY market ORDER BY market`;

    const result = await pool.query(query, params);

    const byMarket = result.rows.map(row => ({
      market: row.market,
      volume: new Decimal(row.volume || 0),
      tradeCount: parseInt(row.trade_count),
    }));

    const totalVolume = byMarket.reduce(
      (sum, m) => sum.plus(m.volume),
      new Decimal(0)
    );

    const totalTradeCount = byMarket.reduce(
      (sum, m) => sum + m.tradeCount,
      0
    );

    return { byMarket, totalVolume, totalTradeCount };
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
        FROM qm_price_history
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
      FROM qm_trade_history
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
      market: row.market,
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      volume: volumeMap.get(new Date(row.bucket).getTime()) || 0,
    }));

    // Sort by timestamp ascending for forward-fill processing
    const sortedData = chartData.sort((a, b) => a.timestamp - b.timestamp);

    // Forward-fill: ensure each candle's open equals the previous candle's close
    // Group by market to handle multiple markets separately
    const marketGroups = new Map<number, IChartDataPoint[]>();
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

  // ============================================================================
  // Zcombinator/Futarchy History Methods (cmb_ tables)
  // Uses zcombinator dao.id directly, no FK constraints
  // ============================================================================

  /**
   * Records a price snapshot for a futarchy proposal
   * @param data.daoId - Zcombinator DAO ID
   * @param data.proposalId - On-chain proposal ID
   * @param data.market - Pool index (0, 1, 2, ...)
   * @param data.price - Current spot price
   */
  static async recordCmbPrice(data: {
    daoId: number;
    proposalId: number;
    market: number;
    price: Decimal;
  }): Promise<void> {
    const pool = getPool();

    const query = `
      INSERT INTO cmb_price_history (dao_id, proposal_id, market, price)
      VALUES ($1, $2, $3, $4)
    `;

    await pool.query(query, [
      data.daoId,
      data.proposalId,
      data.market,
      data.price.toString()
    ]);
  }

  /**
   * Records a TWAP snapshot for a futarchy proposal
   * @param data.daoId - Zcombinator DAO ID
   * @param data.proposalId - On-chain proposal ID
   * @param data.twaps - Array of TWAPs for each market
   * @param data.aggregations - Array of cumulative observations for each market
   */
  static async recordCmbTWAP(data: {
    daoId: number;
    proposalId: number;
    twaps: Decimal[];
    aggregations: Decimal[];
  }): Promise<void> {
    const pool = getPool();

    const query = `
      INSERT INTO cmb_twap_history (dao_id, proposal_id, twaps, aggregations)
      VALUES ($1, $2, $3, $4)
    `;

    await pool.query(query, [
      data.daoId,
      data.proposalId,
      data.twaps.map(t => t.toString()),
      data.aggregations.map(a => a.toString())
    ]);
  }

  /**
   * Records a trade for a futarchy proposal
   * @param data.daoId - Zcombinator DAO ID
   * @param data.proposalId - On-chain proposal ID
   * @param data.market - Pool index
   * @param data.userAddress - Trader wallet address
   * @param data.isBaseToQuote - Trade direction
   * @param data.amountIn - Input amount
   * @param data.amountOut - Output amount
   * @param data.price - Execution price
   * @param data.txSignature - Optional transaction signature
   */
  static async recordCmbTrade(data: {
    daoId: number;
    proposalId: number;
    market: number;
    userAddress: string;
    isBaseToQuote: boolean;
    amountIn: Decimal;
    amountOut: Decimal;
    price: Decimal;
    txSignature?: string;
  }): Promise<void> {
    const pool = getPool();

    const query = `
      INSERT INTO cmb_trade_history (
        dao_id, proposal_id, market, user_address, is_base_to_quote,
        amount_in, amount_out, price, tx_signature
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;

    await pool.query(query, [
      data.daoId,
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
   * Retrieves TWAP history for a futarchy proposal
   */
  static async getCmbTWAPHistory(
    daoId: number,
    proposalId: number,
    from?: Date,
    to?: Date
  ): Promise<{
    id: number;
    timestamp: Date;
    daoId: number;
    proposalId: number;
    twaps: Decimal[];
    aggregations: Decimal[];
  }[]> {
    const pool = getPool();

    let query = `
      SELECT * FROM cmb_twap_history
      WHERE dao_id = $1 AND proposal_id = $2
    `;
    const params: (number | Date)[] = [daoId, proposalId];

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
      daoId: row.dao_id,
      proposalId: row.proposal_id,
      twaps: row.twaps.map((t: string) => new Decimal(t)),
      aggregations: row.aggregations.map((a: string) => new Decimal(a)),
    }));
  }

  /**
   * Retrieves price history for a futarchy proposal
   */
  static async getCmbPriceHistory(
    daoId: number,
    proposalId: number,
    from?: Date,
    to?: Date
  ): Promise<{
    id: number;
    timestamp: Date;
    daoId: number;
    proposalId: number;
    market: number;
    price: Decimal;
  }[]> {
    const pool = getPool();

    let query = `
      SELECT * FROM cmb_price_history
      WHERE dao_id = $1 AND proposal_id = $2
    `;
    const params: (number | Date)[] = [daoId, proposalId];

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
      daoId: row.dao_id,
      proposalId: row.proposal_id,
      market: row.market,
      price: new Decimal(row.price),
    }));
  }

  /**
   * Retrieves trade history for a futarchy proposal
   */
  static async getCmbTradeHistory(
    daoId: number,
    proposalId: number,
    from?: Date,
    to?: Date,
    limit?: number
  ): Promise<{
    id: number;
    timestamp: Date;
    daoId: number;
    proposalId: number;
    market: number;
    userAddress: string;
    isBaseToQuote: boolean;
    amountIn: Decimal;
    amountOut: Decimal;
    price: Decimal;
    txSignature: string | null;
  }[]> {
    const pool = getPool();

    let query = `
      SELECT * FROM cmb_trade_history
      WHERE dao_id = $1 AND proposal_id = $2
    `;
    const params: (number | Date)[] = [daoId, proposalId];

    if (from) {
      params.push(from);
      query += ` AND timestamp >= $${params.length}`;
    }

    if (to) {
      params.push(to);
      query += ` AND timestamp <= $${params.length}`;
    }

    query += ' ORDER BY timestamp DESC';

    if (limit) {
      query += ` LIMIT ${limit}`;
    }

    const result = await pool.query(query, params);

    return result.rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      daoId: row.dao_id,
      proposalId: row.proposal_id,
      market: row.market,
      userAddress: row.user_address,
      isBaseToQuote: row.is_base_to_quote,
      amountIn: new Decimal(row.amount_in),
      amountOut: new Decimal(row.amount_out),
      price: new Decimal(row.price),
      txSignature: row.tx_signature,
    }));
  }
}