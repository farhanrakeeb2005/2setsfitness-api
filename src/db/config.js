// Postgres pool settings from the environment, kept apart from the pool so
// `npm test` can check them without a database.
//  - DATABASE_URL set (Neon, or any hosted Postgres): TLS on. A Neon URL is
//    verified properly (sslmode=require/prefer become verify-full, which is
//    what pg does anyway, minus its warning; channel_binding=require turns on
//    pg's own channel binding). Other hosts without an sslmode keep the old
//    Railway behaviour (TLS without certificate checks); sslmode=disable or
//    a localhost URL means no TLS.
//  - no DATABASE_URL: local Postgres over its Unix socket, as before.
// The pool is small: on Cloud Run each instance serves its requests with a
// few connections, and Neon's free tier caps connections (use its pooled
// "-pooler" URL). PG_POOL_MAX overrides it.
function poolConfig(env = process.env) {
  const max = Math.max(1, Number(env.PG_POOL_MAX) || 3);
  const common = {
    max,
    idleTimeoutMillis: 10_000,        // let an idle Neon compute suspend
    connectionTimeoutMillis: 10_000,  // a waking Neon compute takes ~1 s
  };
  const raw = env.DATABASE_URL;
  if (!raw) return { ...common, database: '2setsfitness', host: '/var/run/postgresql' };

  let url;
  try { url = new URL(raw); } catch { url = null; }
  if (!url) return { ...common, connectionString: raw, ssl: { rejectUnauthorized: false } };

  const params = url.searchParams;
  const host = url.hostname;
  const sslmode = params.get('sslmode');
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  const isNeon = /\.neon\.tech$/i.test(host);
  const out = { ...common };

  if (params.get('channel_binding') === 'require') out.enableChannelBinding = true;
  params.delete('channel_binding');           // a libpq option pg doesn't take from the URL

  if (sslmode === 'disable' || (isLocal && !sslmode)) {
    params.delete('sslmode');
    out.ssl = false;
  } else if (isNeon) {
    params.delete('sslmode');
    out.ssl = true;                           // verify the certificate and host name
  } else if (!sslmode) {
    out.ssl = { rejectUnauthorized: false };  // old Railway behaviour
  }
  // any other explicit sslmode stays in the URL: pg follows it
  out.connectionString = url.toString();
  return out;
}

module.exports = { poolConfig };
