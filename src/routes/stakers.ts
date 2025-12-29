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
import bs58 from 'bs58';
import { getPool } from '../../app/utils/database';
import { SolPriceService } from '../../app/services/sol-price.service';
import { ZcPriceService } from '../../app/services/zc-price.service';
import { POOL_METADATA } from '../config/pools';

const router = Router();

// Vault program ID
const PROGRAM_ID = new PublicKey("47rZ1jgK7zU6XAgffAfXkDX1JkiiRi4HRPBytossWR12");

// UserStake account discriminator from IDL: [102, 53, 163, 107, 9, 138, 87, 153]
const USER_STAKE_DISCRIMINATOR = Buffer.from([102, 53, 163, 107, 9, 138, 87, 153]);

// UserStake account layout offsets:
// discriminator (8) + owner (32) + shares (8) + unbonding_shares (8) + ...
const USER_STAKE_OWNER_OFFSET = 8;
const USER_STAKE_SHARES_OFFSET = 40;
const USER_STAKE_UNBONDING_SHARES_OFFSET = 48;

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

    // Get ALL UserStake accounts from the staking vault program
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    // Query UserStake accounts by discriminator
    const userStakeAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(USER_STAKE_DISCRIMINATOR) } }
      ]
    });

    // Parse accounts and filter for shares > 0
    const stakerAddresses: string[] = [];
    for (const { account } of userStakeAccounts) {
      // UserStake layout: discriminator (8) + owner (32) + shares (8) + unbonding_shares (8) + ...
      const owner = new PublicKey(account.data.slice(USER_STAKE_OWNER_OFFSET, USER_STAKE_OWNER_OFFSET + 32));
      const shares = account.data.readBigUInt64LE(USER_STAKE_SHARES_OFFSET);
      const unbondingShares = account.data.readBigUInt64LE(USER_STAKE_UNBONDING_SHARES_OFFSET);

      // Include stakers with either active shares or unbonding shares
      if (shares > 0n || unbondingShares > 0n) {
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

    // Get ALL UserStake accounts from the staking vault program
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    // Query UserStake accounts by discriminator
    const userStakeAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(USER_STAKE_DISCRIMINATOR) } }
      ]
    });

    // Parse staker addresses (include those with shares or unbonding shares)
    const stakerAddresses: string[] = [];
    for (const { account } of userStakeAccounts) {
      const owner = new PublicKey(account.data.slice(USER_STAKE_OWNER_OFFSET, USER_STAKE_OWNER_OFFSET + 32));
      const shares = account.data.readBigUInt64LE(USER_STAKE_SHARES_OFFSET);
      const unbondingShares = account.data.readBigUInt64LE(USER_STAKE_UNBONDING_SHARES_OFFSET);

      if (shares > 0n || unbondingShares > 0n) {
        stakerAddresses.push(owner.toBase58());
      }
    }

    if (stakerAddresses.length === 0) {
      return res.json({ trades: [], count: 0 });
    }

    // Query trades for all stakers across ALL moderators, with market labels from proposals
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

    // Get ALL UserStake accounts from the staking vault program
    const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    // Fetch VaultState to get exchange rate (total_assets / total_shares)
    const [vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_state")],
      PROGRAM_ID
    );
    const vaultStateAccount = await connection.getAccountInfo(vaultState);

    let exchangeRate = 1;
    if (vaultStateAccount) {
      // VaultState layout: discriminator(8) + admin(32) + underlying_mint(32) + pda_bump(1) +
      // operations_enabled(1) + is_frozen(1) + total_shares(8) + total_assets(8) + reserved_assets(8) +
      // unbonding_period(8) + queued_rewards(8) + last_update_ts(8) + stream_start_ts(8) + stream_end_ts(8) + reward_rate(8)
      const totalSharesOffset = 8 + 32 + 32 + 1 + 1 + 1; // 75
      const totalAssetsOffset = totalSharesOffset + 8; // 83
      const lastUpdateTsOffset = totalAssetsOffset + 8 + 8 + 8 + 8; // 83 + 32 = 115
      const streamEndTsOffset = lastUpdateTsOffset + 8 + 8; // 131
      const rewardRateOffset = streamEndTsOffset + 8; // 139

      const totalShares = Number(vaultStateAccount.data.readBigUInt64LE(totalSharesOffset));
      const totalAssets = Number(vaultStateAccount.data.readBigUInt64LE(totalAssetsOffset));
      const lastUpdateTs = Number(vaultStateAccount.data.readBigInt64LE(lastUpdateTsOffset));
      const streamEndTs = Number(vaultStateAccount.data.readBigInt64LE(streamEndTsOffset));
      const rewardRate = Number(vaultStateAccount.data.readBigUInt64LE(rewardRateOffset));

      // Calculate accrued rewards since last update (same as on-chain previewUnstake)
      const now = Math.floor(Date.now() / 1000);
      const effectiveTime = Math.min(now, streamEndTs);
      const timeElapsed = Math.max(0, effectiveTime - lastUpdateTs);
      const accruedRewards = rewardRate * timeElapsed;

      // Live total assets = stored total_assets + accrued streaming rewards
      const liveTotalAssets = totalAssets + accruedRewards;

      if (totalShares > 0) {
        exchangeRate = liveTotalAssets / totalShares;
      }
    }

    // Query UserStake accounts by discriminator
    const userStakeAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: bs58.encode(USER_STAKE_DISCRIMINATOR) } }
      ]
    });

    // Parse accounts and collect staker data
    const stakers: { address: string; balance: string; balanceRaw: bigint }[] = [];
    let totalBalance = 0n;

    for (const { account } of userStakeAccounts) {
      const owner = new PublicKey(account.data.slice(USER_STAKE_OWNER_OFFSET, USER_STAKE_OWNER_OFFSET + 32));
      const shares = account.data.readBigUInt64LE(USER_STAKE_SHARES_OFFSET);
      const unbondingShares = account.data.readBigUInt64LE(USER_STAKE_UNBONDING_SHARES_OFFSET);

      // Total staked = active shares + unbonding shares
      const totalShares = shares + unbondingShares;

      if (totalShares > 0n) {
        // Convert shares to ZC value using exchange rate
        const sharesNum = Number(totalShares) / 1e6;
        const zcValue = sharesNum * exchangeRate;
        stakers.push({
          address: owner.toBase58(),
          balance: zcValue.toFixed(2),
          balanceRaw: totalShares
        });
        totalBalance += totalShares;
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
      totalStaked: ((Number(totalBalance) / 1e6) * exchangeRate).toFixed(2)
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
