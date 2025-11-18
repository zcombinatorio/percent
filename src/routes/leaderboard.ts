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
import { requireModeratorId } from '@src/middleware/validation';
import { LoggerService } from '../../app/services/logger.service';
import { getPool } from '../../app/utils/database';

const router = Router();
const logger = new LoggerService('api').createChild('leaderboard');
router.use(requireModeratorId); // require moderatorId for all leaderboard routes

/**
 * Get the total arb profit (pot)
 * GET /pot
 */
router.get('/pot', async (req, res, next) => {
  try {
    const moderatorId = req.moderatorId;
    const pool = getPool();

    const result = await pool.query<{ total_profit_sol: string }>(
      'SELECT total_profit_sol FROM arb_profits WHERE id = 1'
    );

    const totalProfit = result.rows.length > 0 ? parseFloat(result.rows[0].total_profit_sol) : 0;

    logger.info('[GET /pot] Total arb profit retrieved', {
      moderatorId,
      totalProfit
    });

    res.json({
      moderatorId,
      totalProfitSol: totalProfit.toString()
    });
  } catch (error) {
    logger.error('[GET /pot] Failed to get total arb profit', {
      error: error instanceof Error ? error.message : String(error)
    });
    next(error);
  }
});

export default router;
