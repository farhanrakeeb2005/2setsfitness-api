const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

// In production (Railway) use the DATABASE_URL connection string with SSL.
// Locally, connect via Unix socket — avoids SCRAM password auth on WSL.
const pool = isProduction
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      database: '2setsfitness',
      host: '/var/run/postgresql',
    });

module.exports = pool;
