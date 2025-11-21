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
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import RouterService from '../app/services/router.service';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.use('/api', routes);

app.use(errorHandler);

const startServer = async () => {
  try {
    console.log('Starting server ...');
    // Load moderators from database
    const router = RouterService.getInstance();
    await router.loadModerators();

    // Recover and reschedule tasks for pending proposals
    await router.recoverPendingProposals();

    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);

      if (process.env.DB_URL) {
        console.log('Database connection configured');
      } else {
        console.warn('WARNING: DB_URL not set - persistence disabled');
      }
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();