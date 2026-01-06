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
import { Monitor } from './monitor';
import { LifecycleService } from './lifecycle.service';
import { TWAPService } from './twap.service';
import { logError } from './logger';

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
const NO_AUTH = !!args['no-auth'];
const DEV = !!args.dev; // Uses dev db tables

const app = express();
app.use(cors());
app.use(express.json());

// Apply auth middleware unless --no-auth
if (!NO_AUTH) app.use(requireAdminKey);

let monitor: Monitor;
let lifecycle: LifecycleService;
let twap: TWAPService;

// Status endpoint
app.get('/status', (_req, res) => {
  const proposals = monitor.getMonitored();
  res.json({
    monitored: proposals.length,
    proposals: proposals.map((p) => ({
      pda: p.proposalPda,
      id: p.proposalId,
      endsAt: new Date(p.endTime).toISOString(),
      timeRemaining: Math.max(0, p.endTime - Date.now()),
    })),
  });
});

const startServer = async () => {
  try {
    // ENV validation
    if (!process.env.DB_URL) throw Error('Missing DB_URL');
    if (!process.env.SOLANA_RPC_URL) throw Error('Missing SOLANA_RPC_URL');
    if (!NO_AUTH && !process.env.ADMIN_API_KEY) throw Error('Missing ADMIN_API_KEY');

    // Start monitor
    monitor = new Monitor(process.env.SOLANA_RPC_URL);
    await monitor.start();

    // Start lifecycle service
    lifecycle = new LifecycleService();
    lifecycle.start(monitor);

    // Start TWAP cranking service
    twap = new TWAPService();
    twap.start(monitor);

    app.listen(PORT, () => {
      const flags = [DEV && 'dev', NO_AUTH && 'no-auth'].filter(Boolean);
      const suffix = flags.length ? ` (${flags.join(', ')})` : '';
      console.log(`Monitor running on port ${PORT}${suffix}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  twap?.stop();
  lifecycle?.stop();
  await monitor?.stop();
  process.exit(0);
});

// Log uncaught errors
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  logError('server', { type: 'uncaught_exception', error: String(err), stack: err.stack });
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  logError('server', { type: 'unhandled_rejection', error: String(err) });
});

startServer();