import { Pool } from 'pg';

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