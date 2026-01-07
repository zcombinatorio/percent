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

import { Request, Response, NextFunction } from 'express';

export const requireAdminKey = (req: Request, res: Response, next: NextFunction) => {
  const valid = process.env.ADMIN_API_KEY;
  if (!valid) return next(); // No key configured, allow through

  const key = req.headers['x-api-key'];
  if (key !== valid) return res.status(401).json({ error: 'Unauthorized' });

  next();
};
