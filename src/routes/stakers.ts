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
import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { getPool } from '../../app/utils/database';
import { SolPriceService } from '../../app/services/sol-price.service';
import { ZcPriceService } from '../../app/services/zc-price.service';
import { POOL_METADATA } from '../config/pools';

const router = Router();

// Vault program ID and ZC token mint
const PROGRAM_ID = new PublicKey("47rZ1jgK7zU6XAgffAfXkDX1JkiiRi4HRPBytossWR12");
const ZC_TOKEN_MINT = new PublicKey("GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC");

// Cache for staker volume data (30 second TTL)
let volumeCache: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 30000; // 30 seconds

// Build moderatorId -> ticker map from POOL_METADATA
const MODERATOR_TICKER_MAP: Record<number, string> = Object.values(POOL_METADATA).reduce(
  (acc, meta) => {
    acc[meta.moderatorId] = meta.ticker.toUpperCase();
    return acc;
  },
  {} as Record<number, string>
);

const getTickerForModerator = (moderatorId: number): string => {
  return MODERATOR_TICKER_MAP[moderatorId] || `MOD${moderatorId}`;
};

/**
 * GET /api/stakers/volume
 * Returns total USD volume traded by stakers across all QMs
 */
router.get('/volume', async (_req, res) => {
  try {
    // Check cache first
    if (volumeCache && Date.now() - volumeCache.timestamp < CACHE_TTL) {
      return res.json(volumeCache.data);
    }

    // 1. Get shareMint PDA
    const [shareMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint")],
      PROGRAM_ID
    );

    // 2. Get ALL token accounts holding sZC using getProgramAccounts
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    // Use getProgramAccounts with filters to get all sZC token accounts
    const tokenAccounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [
        { dataSize: 165 }, // Token account size
        { memcmp: { offset: 0, bytes: shareMint.toBase58() } } // Filter by mint
      ]
    });

    // 3. Parse accounts and filter for balance > 0
    const stakerAddresses: string[] = [];
    for (const { account } of tokenAccounts) {
      // Token account layout: mint (32) + owner (32) + amount (8) + ...
      // Owner is at offset 32, amount is at offset 64
      const owner = new PublicKey(account.data.slice(32, 64));
      const amount = account.data.readBigUInt64LE(64);

      if (amount > 0n) {
        stakerAddresses.push(owner.toBase58());
      }
    }

    if (stakerAddresses.length === 0) {
      const emptyResult = { volumeUsd: 0, stakerCount: 0, tradeCount: 0 };
      volumeCache = { data: emptyResult, timestamp: Date.now() };
      return res.json(emptyResult);
    }

    // 5. Query trade volume for these addresses across ALL moderators
    const pool = getPool();
    const result = await pool.query(`
      SELECT
        SUM(CASE WHEN is_base_to_quote THEN amount_in ELSE amount_out END) as total_base_volume,
        SUM(CASE WHEN is_base_to_quote THEN amount_out ELSE amount_in END) as total_quote_volume,
        COUNT(*) as trade_count
      FROM qm_trade_history
      WHERE user_address = ANY($1)
    `, [stakerAddresses]);

    // 6. Get prices (using cached services)
    const solPrice = await SolPriceService.getInstance().getSolPrice();
    const zcPrice = await ZcPriceService.getInstance().getZcPrice();

    // 7. Calculate USD volume
    // Note: amounts in qm_trade_history are already in human-readable decimal form
    const baseVolume = parseFloat(result.rows[0]?.total_base_volume || '0');
    const quoteVolume = parseFloat(result.rows[0]?.total_quote_volume || '0');

    const volumeUsd = (baseVolume * zcPrice) + (quoteVolume * solPrice);

    const responseData = {
      volumeUsd,
      stakerCount: stakerAddresses.length,
      tradeCount: parseInt(result.rows[0]?.trade_count || '0'),
      // Debug info (can be removed in production)
      baseVolume,
      quoteVolume,
      zcPrice,
      solPrice
    };

    // Update cache
    volumeCache = { data: responseData, timestamp: Date.now() };

    res.json(responseData);
  } catch (error) {
    console.error('Failed to fetch staker volume:', error);
    res.status(500).json({ error: 'Failed to fetch staker volume' });
  }
});

/**
 * GET /api/stakers/trades
 * Returns all trades made by stakers across all QMs
 */
router.get('/trades', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const period = (req.query.period as string) || 'ALL';

    // Calculate cutoff date based on period
    let cutoffDate: Date | null = null;
    if (period === '1D') {
      cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    } else if (period === '1W') {
      cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    // 1. Get shareMint PDA
    const [shareMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint")],
      PROGRAM_ID
    );

    // 2. Get ALL staker addresses using getProgramAccounts
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    const tokenAccounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [
        { dataSize: 165 },
        { memcmp: { offset: 0, bytes: shareMint.toBase58() } }
      ]
    });

    // 3. Parse staker addresses
    const stakerAddresses: string[] = [];
    for (const { account } of tokenAccounts) {
      const owner = new PublicKey(account.data.slice(32, 64));
      const amount = account.data.readBigUInt64LE(64);
      if (amount > 0n) {
        stakerAddresses.push(owner.toBase58());
      }
    }

    if (stakerAddresses.length === 0) {
      return res.json({ trades: [], count: 0 });
    }

    // 4. Query trades for all stakers across ALL moderators, with market labels from proposals
    const pool = getPool();
    const params: (string[] | number | Date)[] = [stakerAddresses];
    let query = `
      SELECT
        t.id,
        t.timestamp,
        t.moderator_id,
        t.proposal_id,
        t.market,
        t.user_address,
        t.is_base_to_quote,
        t.amount_in,
        t.amount_out,
        t.price,
        t.tx_signature,
        p.market_labels
      FROM qm_trade_history t
      LEFT JOIN qm_proposals p ON t.moderator_id = p.moderator_id AND t.proposal_id = p.proposal_id
      WHERE t.user_address = ANY($1)
    `;

    if (cutoffDate) {
      params.push(cutoffDate);
      query += ` AND t.timestamp >= $${params.length}`;
    }

    params.push(limit);
    query += ` ORDER BY t.timestamp DESC LIMIT $${params.length}`;

    const result = await pool.query(query, params);

    // 5. Format response with ticker from pool config and market label from proposal
    const trades = result.rows.map(row => {
      const marketLabels = row.market_labels || [];
      const marketLabel = marketLabels[row.market] || `Coin ${row.market + 1}`;

      return {
        id: row.id,
        timestamp: row.timestamp,
        moderatorId: row.moderator_id,
        ticker: getTickerForModerator(row.moderator_id),
        proposalId: row.proposal_id,
        market: row.market,
        marketLabel,
        userAddress: row.user_address,
        isBaseToQuote: row.is_base_to_quote,
        amountIn: row.amount_in,
        amountOut: row.amount_out,
        price: row.price,
        txSignature: row.tx_signature
      };
    });

    res.json({ trades, count: trades.length });
  } catch (error) {
    console.error('Failed to fetch staker trades:', error);
    res.status(500).json({ error: 'Failed to fetch staker trades' });
  }
});

// Cache for staker list data (30 second TTL)
let stakersListCache: { data: any; timestamp: number } | null = null;

/**
 * GET /api/stakers/list
 * Returns all stakers with their sZC balances
 */
router.get('/list', async (req, res) => {
  try {
    const period = (req.query.period as string) || 'ALL';

    // Calculate cutoff date based on period
    let cutoffDate: Date | null = null;
    if (period === '1D') {
      cutoffDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    } else if (period === '1W') {
      cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    // Check cache first (only for ALL period)
    if (period === 'ALL' && stakersListCache && Date.now() - stakersListCache.timestamp < CACHE_TTL) {
      return res.json(stakersListCache.data);
    }

    // 1. Get shareMint PDA
    const [shareMint] = PublicKey.findProgramAddressSync(
      [Buffer.from("share_mint")],
      PROGRAM_ID
    );

    // 2. Get ALL token accounts holding sZC using getProgramAccounts
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    const tokenAccounts = await connection.getProgramAccounts(TOKEN_PROGRAM_ID, {
      filters: [
        { dataSize: 165 },
        { memcmp: { offset: 0, bytes: shareMint.toBase58() } }
      ]
    });

    // 3. Parse accounts and collect staker data
    const stakers: { address: string; balance: string; balanceRaw: bigint }[] = [];
    let totalBalance = 0n;

    for (const { account } of tokenAccounts) {
      const owner = new PublicKey(account.data.slice(32, 64));
      const amount = account.data.readBigUInt64LE(64);

      if (amount > 0n) {
        const balanceNum = Number(amount) / 1e6; // sZC has 6 decimals
        stakers.push({
          address: owner.toBase58(),
          balance: balanceNum.toFixed(2),
          balanceRaw: amount
        });
        totalBalance += amount;
      }
    }

    // 4. Get trading volumes for each staker
    const stakerAddresses = stakers.map(s => s.address);
    const pool = getPool();

    // Query volume per staker (with optional time filter)
    const volumeParams: (string[] | Date)[] = [stakerAddresses];
    let volumeQuery = `
      SELECT
        user_address,
        SUM(CASE WHEN is_base_to_quote THEN amount_in ELSE amount_out END) as total_base_volume,
        SUM(CASE WHEN is_base_to_quote THEN amount_out ELSE amount_in END) as total_quote_volume
      FROM qm_trade_history
      WHERE user_address = ANY($1)
    `;

    if (cutoffDate) {
      volumeParams.push(cutoffDate);
      volumeQuery += ` AND timestamp >= $${volumeParams.length}`;
    }

    volumeQuery += ` GROUP BY user_address`;

    const volumeResult = await pool.query(volumeQuery, volumeParams);

    // Build volume map
    const volumeMap: Record<string, { baseVolume: number; quoteVolume: number }> = {};
    for (const row of volumeResult.rows) {
      volumeMap[row.user_address] = {
        baseVolume: parseFloat(row.total_base_volume || '0'),
        quoteVolume: parseFloat(row.total_quote_volume || '0')
      };
    }

    // Get prices
    const solPrice = await SolPriceService.getInstance().getSolPrice();
    const zcPrice = await ZcPriceService.getInstance().getZcPrice();

    // 5. Calculate percentage, volume, and sort by balance descending
    const stakersWithData = stakers
      .map(s => {
        const volumes = volumeMap[s.address] || { baseVolume: 0, quoteVolume: 0 };
        const volumeUsd = (volumes.baseVolume * zcPrice) + (volumes.quoteVolume * solPrice);

        return {
          address: s.address,
          balance: s.balance,
          percentage: totalBalance > 0n
            ? ((Number(s.balanceRaw) / Number(totalBalance)) * 100).toFixed(2)
            : '0',
          volumeUsd: volumeUsd.toFixed(2)
        };
      })
      .sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance));

    const responseData = {
      stakers: stakersWithData,
      count: stakersWithData.length,
      totalStaked: (Number(totalBalance) / 1e6).toFixed(2)
    };

    // Update cache (only for ALL period)
    if (period === 'ALL') {
      stakersListCache = { data: responseData, timestamp: Date.now() };
    }

    res.json(responseData);
  } catch (error) {
    console.error('Failed to fetch stakers list:', error);
    res.status(500).json({ error: 'Failed to fetch stakers list' });
  }
});

/**
 * GET /api/stakers/slashed/:walletAddress
 * Returns total ZC amount slashed for a specific wallet
 */
router.get('/slashed/:walletAddress', async (req, res) => {
  try {
    const { walletAddress } = req.params;

    if (!walletAddress || walletAddress.length < 32 || walletAddress.length > 44) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const pool = getPool();
    const result = await pool.query(`
      SELECT COALESCE(SUM(zc_amount_slashed), 0) as total_slashed
      FROM qm_slashed
      WHERE target_wallet = $1
    `, [walletAddress]);

    const totalSlashed = parseFloat(result.rows[0]?.total_slashed || '0');

    res.json({ totalSlashed });
  } catch (error) {
    console.error('Failed to fetch slashed amount:', error);
    res.status(500).json({ error: 'Failed to fetch slashed amount' });
  }
});

export default router;
