const { Pool } = require('pg');
require('dotenv').config();

// Use DATABASE_URL when available (Railway). Locally, connect via Unix socket.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      database: '2setsfitness',
      host: '/var/run/postgresql',
    });

module.exports = pool;
