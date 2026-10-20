const { Pool } = require('pg');
require('dotenv').config();
const { poolConfig } = require('./config');

// DATABASE_URL (Neon on Cloud Run, or any hosted Postgres) or, without it,
// local Postgres over its Unix socket. Settings: src/db/config.js.
const pool = new Pool(poolConfig());

// Neon closes idle connections when its compute suspends; without a
// listener that error on an idle client would crash the process.
pool.on('error', (err) => console.error('Postgres idle client error:', err.message));

module.exports = pool;
