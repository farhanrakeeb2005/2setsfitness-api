require('dotenv').config();
const { Pool } = require('pg');

console.log('DATABASE_URL:', process.env.DATABASE_URL);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.query('SELECT NOW()')
  .then(r => { console.log('DB connected OK:', r.rows[0].now); pool.end(); })
  .catch(e => { console.error('DB ERROR:', e.message); pool.end(); });
