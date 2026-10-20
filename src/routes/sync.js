// Cloud backup of the app's local data, one JSON document per user and
// collection (routines, history, sports/recovery/nutrition logs, schedule,
// profile, fighter…; the list is COLLECTIONS in lib/syncMerge.js).
//
//   GET    /sync?since=<ms>  collections changed after `since` (server clock)
//                            -> { collections: { name: doc }, serverTime }
//   PUT    /sync             { collections: { name: doc } } merged into the
//                            stored copies -> { collections: merged, errors, serverTime }
//   DELETE /sync             removes the user's backup
//
// A PUT never replaces the stored copy: it is merged into it with the same
// rules the app uses (union by id, the newer copy wins, deletions only by
// tombstone), so a phone with less data can't wipe the backup.
const express = require('express');
const { COLLECTIONS, mergeCollection } = require('../lib/syncMerge');

const LIMITS = {
  docBytes: 3 * 1024 * 1024,   // one collection, stored
  items: 10000,                // list items, tombstones, map keys
  keyLength: 300,
  unionItems: 1000,
};

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** null when `doc` is a valid document for collection `name`, else why not. */
function validateDoc(name, doc) {
  const c = COLLECTIONS[name];
  if (!c) return 'unknown collection';
  if (!isObj(doc)) return 'not an object';
  if (Buffer.byteLength(JSON.stringify(doc)) > LIMITS.docBytes) return 'too large';
  const mapOk = (m, valueOk) => isObj(m)
    && Object.keys(m).length <= LIMITS.items
    && Object.entries(m).every(([k, v]) => k.length <= LIMITS.keyLength && valueOk(v));
  switch (c.kind) {
    case 'list': {
      if (!Array.isArray(doc.items) || doc.items.length > LIMITS.items) return 'items must be a list';
      const badItem = doc.items.some((it) => !isObj(it)
        || (it.id != null && !((typeof it.id === 'string' && it.id.length <= LIMITS.keyLength) || finite(it.id))));
      if (badItem) return 'bad item';
      if (doc.tombstones != null && !mapOk(doc.tombstones, finite)) return 'bad tombstones';
      return null;
    }
    case 'doc':
    case 'profile':
      if (doc.updatedAt != null && !finite(doc.updatedAt)) return 'bad updatedAt';
      if (c.kind === 'profile' && doc.data != null && !isObj(doc.data)) return 'profile must be an object';
      if (doc.data != null && typeof doc.data !== 'object') return 'data must be an object or list';
      return null;
    case 'prs':
      return mapOk(doc.data, isObj) ? null : 'bad records';
    case 'maxMap':
      return mapOk(doc.data, finite) ? null : 'bad map';
    case 'union':
      return Array.isArray(doc.data) && doc.data.length <= LIMITS.unionItems
        && doc.data.every((v) => typeof v === 'string' && v.length <= LIMITS.keyLength) ? null : 'bad list';
    case 'bank':
      return isObj(doc.data) && (doc.data.legacy == null || finite(doc.data.legacy))
        && (doc.data.ids == null || mapOk(doc.data.ids, finite)) ? null : 'bad bank';
    default:
      return 'unknown kind';
  }
}

async function serverTime(db) {
  const { rows } = await db.query('SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS now_ms');
  return Number(rows[0].now_ms);
}

// `auth` sets req.user (middleware/auth.js); `limiter`, optional, runs after
// it, so it can count per user
function createSyncRouter({ pool, auth, limiter }) {
  const router = express.Router();
  router.use(auth);
  if (limiter) router.use(limiter);

  router.get('/', async (req, res) => {
    const since = Math.max(0, Number(req.query.since) || 0);
    const now = await serverTime(pool);
    const { rows } = await pool.query(
      `SELECT collection, data FROM user_sync
       WHERE user_id = $1 AND updated_at > to_timestamp($2::double precision / 1000.0)`,
      [req.user.id, since]
    );
    const collections = {};
    for (const r of rows) if (COLLECTIONS[r.collection] && r.data != null) collections[r.collection] = r.data;
    res.json({ collections, serverTime: now });
  });

  router.put('/', async (req, res) => {
    const incoming = req.body && req.body.collections;
    if (!isObj(incoming)) return res.status(400).json({ error: 'collections is required' });
    const names = Object.keys(incoming);
    if (names.length > Object.keys(COLLECTIONS).length) return res.status(400).json({ error: 'too many collections' });

    const collections = {};
    const errors = {};
    const client = await pool.connect();
    try {
      for (const name of names) {
        const invalid = validateDoc(name, incoming[name]);
        if (invalid) { errors[name] = invalid; continue; }
        await client.query('BEGIN');
        try {
          // the row first, so two phones syncing at once queue on its lock
          await client.query(
            `INSERT INTO user_sync (user_id, collection, data) VALUES ($1, $2, 'null'::jsonb)
             ON CONFLICT (user_id, collection) DO NOTHING`,
            [req.user.id, name]
          );
          const { rows } = await client.query(
            'SELECT data FROM user_sync WHERE user_id = $1 AND collection = $2 FOR UPDATE',
            [req.user.id, name]
          );
          const stored = rows[0] ? rows[0].data : null;
          const merged = mergeCollection(name, incoming[name], stored);
          const json = JSON.stringify(merged);
          if (Buffer.byteLength(json) > LIMITS.docBytes) {
            await client.query('ROLLBACK');
            errors[name] = 'too large';
            continue;
          }
          await client.query(
            `UPDATE user_sync SET data = $3::jsonb, updated_at = NOW()
             WHERE user_id = $1 AND collection = $2`,
            [req.user.id, name, json]
          );
          await client.query('COMMIT');
          collections[name] = merged;
        } catch (e) {
          await client.query('ROLLBACK').catch(() => {});
          throw e;
        }
      }
    } finally {
      client.release();
    }
    res.json({ collections, errors, serverTime: await serverTime(pool) });
  });

  router.delete('/', async (req, res) => {
    await pool.query('DELETE FROM user_sync WHERE user_id = $1', [req.user.id]);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { createSyncRouter, validateDoc, LIMITS };
