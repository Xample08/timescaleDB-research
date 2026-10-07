import { Pool, PoolConfig } from 'pg';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (pool) return pool;

  let connectionString = process.env.DATABASE_URL || '';
  if (connectionString.includes('sslmode=')) {
    connectionString = connectionString.replace(/[\?&]sslmode=[^&]*/, '');
    if (connectionString.endsWith('?')) {
      connectionString = connectionString.slice(0, -1);
    }
  }

  const config: PoolConfig = {
    connectionString,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  };

  if (process.env.DB_SSL_VERIFY === 'true') {
    config.ssl = true;
  } else {
    config.ssl = { rejectUnauthorized: false };
  }

  pool = new Pool(config);

  pool.on('connect', (client) => {
    client.query("SET TIME ZONE 'UTC'").catch(() => {});
  });

  return pool;
}
