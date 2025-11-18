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

import { Pool } from 'pg';
// Note: dotenv should be configured at the application entry point (server.ts or server.test.ts)
// not in individual service files

let pool: Pool | null = null;

/**
 * Get or create the PostgreSQL connection pool
 * Uses DB_URL from environment variables
 */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DB_URL;
    
    if (!connectionString) {
      throw new Error('DB_URL environment variable is not set');
    }
    
    pool = new Pool({
      connectionString,
      max: 50, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 10000, // Fail connection attempts after 10 seconds
    });
    
    // Handle pool errors
    pool.on('error', (err) => {
      console.error('Unexpected error on idle client', err);
    });
  }
  
  return pool;
}

/**
 * Close the database connection pool
 * Useful for graceful shutdown
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Test the database connection
 */
export async function testConnection(): Promise<boolean> {
  try {
    const client = await getPool().connect();
    await client.query('SELECT NOW()');
    client.release();
    return true;
  } catch (error) {
    console.error('Database connection test failed:', error);
    return false;
  }
}