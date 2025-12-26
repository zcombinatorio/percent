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
import proposalRoutes from './proposals';
import swapRoutes from './swap';
import historyRoutes from './history';
import poolRoutes from './pools';
import routerRoutes from './router';
import leaderboardRoutes from './leaderboard';
import whitelistRoutes from './whitelist';
import stakersRoutes from './stakers';
import proposalRequestsRoutes from './proposal-requests';
import { SolPriceService } from '../../app/services/sol-price.service';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ status: 'OK' });
});

// SOL/USD price endpoint
router.get('/sol-price', async (_req, res) => {
  try {
    const solPriceService = SolPriceService.getInstance();
    const price = await solPriceService.getSolPrice();
    res.json({ price });
  } catch (error) {
    console.error('Error fetching SOL price:', error);
    res.status(500).json({ error: 'Failed to fetch SOL price' });
  }
});

router.use('/proposals', proposalRoutes);
router.use('/swap', swapRoutes);
router.use('/history', historyRoutes);
router.use('/pools', poolRoutes);
router.use('/router', routerRoutes);
router.use('/leaderboard', leaderboardRoutes);
router.use('/whitelist', whitelistRoutes);
router.use('/stakers', stakersRoutes);
router.use('/proposal-requests', proposalRequestsRoutes);

export default router;