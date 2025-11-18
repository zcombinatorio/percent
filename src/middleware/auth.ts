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

import { LoggerService } from '@app/services/logger.service';
import { Request, Response, NextFunction } from 'express';

export interface AuthRequest extends Request {
  isAuthenticated?: boolean;
}

const logger = new LoggerService('api').createChild('auth');

export const requireApiKey = (req: AuthRequest, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  const validApiKey = process.env.API_KEY;

  if (!validApiKey) {
    logger.error('API_KEY not configured in environment variables');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  if (apiKey !== validApiKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  req.isAuthenticated = true;
  next();
};