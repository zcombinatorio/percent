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

import dotenv from 'dotenv';

// CRITICAL: Load environment variables BEFORE any other imports
// This ensures process.env is populated before modules that use it are loaded
dotenv.config();

import express from 'express';
import cors from 'cors';
import { requireAdminKey } from './middleware';

// Parse CLI args: --port 4000 --dev
const args = process.argv.slice(2).reduce((acc, arg, i, arr) => {
  if (arg.startsWith('--')) {
    const key = arg.slice(2);
    const next = arr[i + 1];
    acc[key] = next && !next.startsWith('--') ? next : true;
  }
  return acc;
}, {} as Record<string, string | boolean>);

const PORT = Number(args.port) || 4000;
const DEV = !!args.dev;

const app = express();
app.use(cors());
app.use(express.json());

// Apply auth middleware unless --dev
if (!DEV) app.use(requireAdminKey);

const startServer = async () => {
  try {
    // ENV validation
    if (!process.env.DB_URL) {
      throw Error('Missing DB_URL');
    }
    if (!DEV && !process.env.ADMIN_API_KEY) {
      throw Error('Missing ADMIN_API_KEY');
    }

    app.listen(PORT, () => {
      console.log(`Monitor running on port ${PORT}${DEV ? ' (developer mode)' : ''}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();