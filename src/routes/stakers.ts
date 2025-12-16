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

const router = Router();

// Vault program ID and ZC token mint
const PROGRAM_ID = new PublicKey("6CETAFdgoMZgNHCcjnnQLN2pu5pJgUz8QQd7JzcynHmD");
const ZC_TOKEN_MINT = new PublicKey("GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC");

// Cache for staker volume data (30 second TTL)
let volumeCache: { data: any; timestamp: number } | null = null;
const CACHE_TTL = 30000; // 30 seconds

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

export default router;
