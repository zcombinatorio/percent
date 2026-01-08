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
import { requireAdminKey } from './lib/middleware';
import { logError, readErrors, clearErrors, LOG_FILES, LogFile } from './lib/logger';
import { SSEManager } from './lib/sse';
import { Monitor } from './monitor';
import { LifecycleService } from './services/lifecycle.service';
import { TWAPService } from './services/twap.service';
import { PriceService } from './services/price.service';
import historyRoutes from './routes/history';

// ============================================================================
// CLI Arguments
// ============================================================================

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
const DEV = !!args.dev;
const LISTEN_ONLY = !!args.listen;

// ============================================================================
// Express Setup
// ============================================================================

const app = express();
app.use(cors());
app.use(express.json());

// SSE endpoint (public, no auth required)
const sse = new SSEManager();
app.get('/events', (req, res) => {
  const client = sse.connect(req, res);
  client.send('CONNECTED', { clientId: client.clientId });
});

// History routes (public, no auth required)
app.use('/api/history', historyRoutes);

// Auth middleware for other endpoints
if (!NO_AUTH) app.use(requireAdminKey);

// ============================================================================
// Services
// ============================================================================

let monitor: Monitor;
let lifecycle: LifecycleService;
let twap: TWAPService;
let price: PriceService;

// ============================================================================
// Endpoints
// ============================================================================

// GET /status - Monitor status and tracked proposals
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

// GET /logs?file=lifecycle&limit=50 - Read error logs
app.get('/logs', (req, res) => {
  const file = req.query.file as string | undefined;
  const limit = Math.min(Number(req.query.limit) || 50, 500);

  if (!file || !LOG_FILES.includes(file as LogFile)) {
    return res.status(400).json({ error: 'Invalid file', valid: LOG_FILES });
  }

  const entries = readErrors(file as LogFile);
  const newest = entries.reverse().slice(0, limit);
  res.json({ file, count: newest.length, entries: newest });
});

// POST /clean?file=lifecycle - Clear error logs (specific or all)
app.post('/clean', (req, res) => {
  const file = req.query.file as string | undefined;

  if (file) {
    if (!LOG_FILES.includes(file as LogFile)) {
      return res.status(400).json({ error: 'Invalid file', valid: LOG_FILES });
    }
    clearErrors(file as LogFile);
    return res.json({ cleared: [file] });
  }

  LOG_FILES.forEach((f) => clearErrors(f));
  res.json({ cleared: LOG_FILES });
});

// ============================================================================
// Startup
// ============================================================================

const printStartupBanner = () => {
  console.log('\n========================================');
  console.log('  Monitor');
  console.log('========================================\n');

  console.log('Options:');
  console.log(`  --port <n>     Server port (default: 4000)`);
  console.log(`  --dev          Dev mode`);
  console.log(`  --no-auth      Disable API key auth`);
  console.log(`  --listen       Listen-only mode (no writes, no cranking, no finalization)\n`);

  console.log('Config:');
  console.log(`  Port:          ${PORT}`);
  console.log(`  Auth:          ${NO_AUTH ? 'disabled' : 'enabled'}`);
  console.log(`  Mode:          ${DEV ? 'development' : 'production'}`);
  console.log(`  Listen-only:   ${LISTEN_ONLY ? 'enabled' : 'disabled'}\n`);

  console.log('Endpoints:');
  console.log(`  GET  /status`);
  console.log(`  GET  /logs?file={${LOG_FILES.join('|')}}`);
  console.log(`  POST /clean?file={${LOG_FILES.join('|')}}`);
  console.log(`  GET  /events (SSE)`);
  console.log(`  GET  /api/history/:pda/twap`);
  console.log(`  GET  /api/history/:pda/trades`);
  console.log(`  GET  /api/history/:pda/volume`);
  console.log(`  GET  /api/history/:pda/chart\n`);

  console.log('========================================\n');
};

const startServer = async () => {
  try {
    // ENV validation
    if (!process.env.DB_URL) throw Error('Missing DB_URL');
    if (!process.env.SOLANA_RPC_URL) throw Error('Missing SOLANA_RPC_URL');
    if (!NO_AUTH && !process.env.ADMIN_API_KEY) throw Error('Missing ADMIN_API_KEY');

    // Create monitor instance
    monitor = new Monitor(process.env.SOLANA_RPC_URL);

    // Load existing pending proposals from API (blocking)
    await monitor.loadPendingProposals();

    // Start event listeners for new proposals
    await monitor.start();

    // Start lifecycle service
    lifecycle = new LifecycleService(sse, LISTEN_ONLY);
    lifecycle.start(monitor);

    // Start TWAP cranking service (skip in listen-only mode)
    if (!LISTEN_ONLY) {
      twap = new TWAPService(sse);
      twap.start(monitor);
    }

    // Start price SSE service
    price = new PriceService(sse, process.env.SOLANA_RPC_URL, LISTEN_ONLY);
    price.start(monitor);

    app.listen(PORT, () => {
      printStartupBanner();
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// ============================================================================
// Shutdown & Error Handling
// ============================================================================

process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  price?.stop();
  twap?.stop();
  lifecycle?.stop();
  await monitor?.stop();
  sse.closeAll();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  logError('server', { type: 'uncaught_exception', error: String(err), stack: err.stack });
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
  logError('server', { type: 'unhandled_rejection', error: String(err) });
});

// ============================================================================
// Start
// ============================================================================

startServer();
