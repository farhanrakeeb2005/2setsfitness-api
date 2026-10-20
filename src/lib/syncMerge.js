// Merge rules for the app's cloud backup (routes/sync.js). The app runs the
// same rules (formcoach-app src/lib/syncMerge.js): keep the two in step.
// A merge never drops an item just because one side doesn't have it; only a
// deletion (a tombstone) at least as new as the item removes it.
//
// Every collection is sent as a small document of one of these kinds:
//  list     { items: [{ id?, ts?, updatedAt? }], tombstones: { key: deletedAtMs } }
//           union by key (itemKey); of two copies the newer wins (updatedAt,
//           else ts); ties keep the first side's copy.
//  doc      { data, updatedAt }   the newer one wins; ties keep the first side.
//  profile  { data, updatedAt }   like doc, but fields only the older copy has
//           are kept (a new phone's setup answers don't drop the weight,
//           avatar… saved before), and the best streak / Form 90 badge never
//           go down.
//  prs      { data: { exercise: { weight, date } } }  heavier record per exercise
//  maxMap   { data: { key: number } }  larger number per key (water cups per day)
//  union    { data: [string] }  set union (built-in routine ids already offered)
//  bank     { data: { legacy: number, ids: { key: points } } }  max of each

const COLLECTIONS = {
  routines:       { kind: 'list', order: 'keep' },
  seededRoutines: { kind: 'union' },
  history:        { kind: 'list', order: 'ts-desc' },
  sports:         { kind: 'list', order: 'ts-desc' },
  recovery:       { kind: 'list', order: 'ts-desc' },
  nutrition:      { kind: 'list', order: 'ts-desc' },
  formScores:     { kind: 'list', order: 'ts-desc' },
  measurements:   { kind: 'list', order: 'ts-desc' },
  bodyWeights:    { kind: 'list', order: 'ts-desc' },
  prs:            { kind: 'prs' },
  water:          { kind: 'maxMap' },
  schedule:       { kind: 'doc' },
  profile:        { kind: 'profile' },
  prefs:          { kind: 'doc' },
  fighter:        { kind: 'doc' },
  pointsBank:     { kind: 'bank' },
};

const TOMBSTONE_CAP = 2000;

const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The key an item is matched on: its id, else its time (+ exercise/name). */
function itemKey(item) {
  if (item && item.id != null && item.id !== '') return String(item.id);
  return `ts:${item?.ts}:${item?.exercise ?? item?.name ?? ''}`;
}

/** When an item last changed: updatedAt, else when it was made (ts). */
function stamp(item) {
  const u = Number(item?.updatedAt);
  if (Number.isFinite(u) && u > 0) return u;
  const t = Number(item?.ts);
  return Number.isFinite(t) ? t : 0;
}

function capTombstones(t) {
  const entries = Object.entries(t);
  if (entries.length <= TOMBSTONE_CAP) return t;
  return Object.fromEntries(entries.sort((x, y) => y[1] - x[1]).slice(0, TOMBSTONE_CAP));
}

function mergeList(a, b, order) {
  const itemsOf = (d) => (Array.isArray(d?.items) ? d.items.filter(isObj) : []);
  const tombOf = (d) => (isObj(d?.tombstones) ? d.tombstones : {});
  const tombstones = {};
  for (const t of [tombOf(a), tombOf(b)]) {
    for (const [k, v] of Object.entries(t)) {
      const n = Number(v);
      if (Number.isFinite(n) && !(tombstones[k] >= n)) tombstones[k] = n;
    }
  }
  const byKey = new Map();
  for (const it of itemsOf(a)) {
    const k = itemKey(it);
    if (!byKey.has(k)) byKey.set(k, it);
  }
  for (const it of itemsOf(b)) {
    const k = itemKey(it);
    const cur = byKey.get(k);
    if (!cur || stamp(it) > stamp(cur)) byKey.set(k, it);
  }
  let items = [...byKey.values()].filter((it) => !(tombstones[itemKey(it)] >= stamp(it)));
  if (order === 'ts-desc') {
    items = items.map((it, i) => [it, i])
      .sort((x, y) => (num(y[0].ts) - num(x[0].ts)) || (x[1] - y[1]))
      .map(([it]) => it);
  }
  return { items, tombstones: capTombstones(tombstones) };
}

const hasData = (d) => d != null && d.data !== undefined && d.data !== null;

function mergeDoc(a, b) {
  if (!hasData(b)) return hasData(a) ? a : (b || a || { data: null, updatedAt: 0 });
  if (!hasData(a)) return b;
  return num(b.updatedAt) > num(a.updatedAt) ? b : a;
}

function mergeProfile(a, b) {
  if (!hasData(a) || !hasData(b) || !isObj(a.data) || !isObj(b.data)) return mergeDoc(a, b);
  const ua = num(a.updatedAt), ub = num(b.updatedAt);
  const [win, lose] = ua >= ub ? [a, b] : [b, a];
  const data = { ...lose.data, ...win.data };
  const best = Math.max(num(a.data.bestStreak), num(b.data.bestStreak), num(data.streak));
  if (best > 0) data.bestStreak = best;
  if (a.data.form90 || b.data.form90) data.form90 = true;
  return { data, updatedAt: Math.max(ua, ub) };
}

function mergePrs(a, b) {
  const pa = isObj(a?.data) ? a.data : {};
  const pb = isObj(b?.data) ? b.data : {};
  const data = {};
  for (const [k, v] of Object.entries(pa)) if (isObj(v)) data[k] = v;
  for (const [k, v] of Object.entries(pb)) {
    if (!isObj(v)) continue;
    if (!data[k] || num(v.weight) > num(data[k].weight)) data[k] = v;
  }
  return { data };
}

function mergeMaxMap(a, b) {
  const data = {};
  for (const d of [a?.data, b?.data]) {
    if (!isObj(d)) continue;
    for (const [k, v] of Object.entries(d)) {
      const n = Number(v);
      if (Number.isFinite(n) && !(data[k] >= n)) data[k] = n;
    }
  }
  return { data };
}

function mergeUnion(a, b) {
  const out = [];
  const seen = new Set();
  for (const d of [a?.data, b?.data]) {
    if (!Array.isArray(d)) continue;
    for (const v of d) {
      if (typeof v === 'string' && !seen.has(v)) { seen.add(v); out.push(v); }
    }
  }
  return { data: out };
}

function mergeBank(a, b) {
  const da = isObj(a?.data) ? a.data : {};
  const db = isObj(b?.data) ? b.data : {};
  return {
    data: {
      legacy: Math.max(num(da.legacy), num(db.legacy)),
      ids: mergeMaxMap({ data: da.ids }, { data: db.ids }).data,
    },
  };
}

/** Merges two copies of a collection; `a` wins ties. */
function mergeCollection(name, a, b) {
  const c = COLLECTIONS[name];
  if (!c) throw new Error(`unknown collection ${name}`);
  switch (c.kind) {
    case 'list': return mergeList(a, b, c.order);
    case 'doc': return mergeDoc(a, b);
    case 'profile': return mergeProfile(a, b);
    case 'prs': return mergePrs(a, b);
    case 'maxMap': return mergeMaxMap(a, b);
    case 'union': return mergeUnion(a, b);
    case 'bank': return mergeBank(a, b);
    default: throw new Error(`unknown kind ${c.kind}`);
  }
}

/** Small, fast string hash (FNV-1a) for change detection, not security. */
function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ':' + s.length.toString(36);
}

module.exports = { COLLECTIONS, TOMBSTONE_CAP, itemKey, stamp, mergeCollection, hashString };
