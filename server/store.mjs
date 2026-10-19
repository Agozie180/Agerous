/**
 * AGEROUS — tiny key/value + list + hash + counter store for the leaderboard, chat and rate limits.
 *
 * Production: any Upstash-Redis-compatible REST endpoint. Vercel's "Upstash for Redis" / KV
 * integration sets KV_REST_API_URL + KV_REST_API_TOKEN (optionally with a custom prefix, e.g.
 * STORAGE_KV_REST_API_URL); Upstash itself uses UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN.
 * Zero dependencies — plain fetch with a timeout.
 * Without those variables it falls back to process memory, which is fine for local runs but is
 * per-instance and NOT durable on serverless platforms (every API reports `durable:false`).
 *
 * Interface (identical for both back ends):
 *   get/set/del      one JSON value per key
 *   push/list        capped newest-first list (chat)
 *   hset/hget/hall/hdel/hlen   hash of JSON values — one field per player, so two players
 *                    finishing at the same moment can never overwrite each other (leaderboard)
 *   hit(key, secs)   fixed-window counter: returns how many times `key` was hit in this window
 *                    (rate limiting that survives serverless cold starts when the store is durable)
 */
const mem = globalThis.__agerousMem ??= { kv: new Map(), lists: new Map(), hashes: new Map(), hits: new Map() };

/** Find an Upstash/Vercel-KV REST url+token pair in the environment, honouring custom prefixes. */
export function findUpstash(env = process.env) {
  const pairs = [['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], ['KV_REST_API_URL', 'KV_REST_API_TOKEN']];
  for (const [u, t] of pairs) if (env[u] && env[t]) return { url: env[u], token: env[t] };
  for (const key of Object.keys(env)) {                        // e.g. STORAGE_KV_REST_API_URL
    const m = key.match(/^(.*)(KV_REST_API_URL|UPSTASH_REDIS_REST_URL)$/);
    if (!m || !env[key]) continue;
    const token = env[`${m[1]}${m[2].replace('_URL', '_TOKEN')}`];
    if (token) return { url: env[key], token };
  }
  return null;
}

export function createStore(env = process.env, fetchImpl = globalThis.fetch) {
  const up = findUpstash(env);
  if (up) {
    const cmd = async args => {
      const r = await fetchImpl(up.url, {
        method: 'POST', headers: { Authorization: `Bearer ${up.token}`, 'content-type': 'application/json' }, body: JSON.stringify(args),
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(5000) : undefined,
      });
      if (!r.ok) throw new Error(`store ${r.status}`);
      const j = await r.json();
      if (j.error) throw new Error(`store: ${j.error}`);
      return j.result;
    };
    const parse = x => { try { return JSON.parse(x); } catch { return null; } };
    return {
      durable: true,
      get: async k => { const v = await cmd(['GET', k]); return v == null ? null : parse(v); },
      set: async (k, v) => { await cmd(['SET', k, JSON.stringify(v)]); },
      push: async (k, v, keep) => { await cmd(['LPUSH', k, JSON.stringify(v)]); await cmd(['LTRIM', k, 0, keep - 1]); },
      list: async (k, n) => ((await cmd(['LRANGE', k, 0, n - 1])) || []).map(parse).filter(Boolean),
      del: async k => { await cmd(['DEL', k]); },
      hset: async (k, f, v) => { await cmd(['HSET', k, f, JSON.stringify(v)]); },
      hget: async (k, f) => { const v = await cmd(['HGET', k, f]); return v == null ? null : parse(v); },
      hall: async k => {                                        // Upstash returns [field, value, field, value…]
        const flat = (await cmd(['HGETALL', k])) || [], out = {};
        if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = parse(flat[i + 1]);
        else Object.assign(out, Object.fromEntries(Object.entries(flat).map(([f, v]) => [f, parse(v)])));
        return out;
      },
      hdel: async (k, f) => { await cmd(['HDEL', k, f]); },
      hit: async (k, secs) => {
        const n = Number(await cmd(['INCR', k]));
        if (n === 1) await cmd(['EXPIRE', k, Math.max(1, Math.ceil(secs))]);
        return n;
      },
    };
  }
  return {
    durable: false,
    get: async k => (mem.kv.has(k) ? structuredClone(mem.kv.get(k)) : null),
    set: async (k, v) => { mem.kv.set(k, structuredClone(v)); },
    push: async (k, v, keep) => { const a = mem.lists.get(k) || []; a.unshift(structuredClone(v)); mem.lists.set(k, a.slice(0, keep)); },
    list: async (k, n) => structuredClone((mem.lists.get(k) || []).slice(0, n)),
    del: async k => { mem.kv.delete(k); mem.lists.delete(k); mem.hashes.delete(k); },
    hset: async (k, f, v) => { const h = mem.hashes.get(k) || new Map(); h.set(f, structuredClone(v)); mem.hashes.set(k, h); },
    hget: async (k, f) => { const v = mem.hashes.get(k)?.get(f); return v === undefined ? null : structuredClone(v); },
    hall: async k => Object.fromEntries([...(mem.hashes.get(k) || new Map())].map(([f, v]) => [f, structuredClone(v)])),
    hdel: async (k, f) => { mem.hashes.get(k)?.delete(f); },
    hit: async (k, secs) => {
      const now = Date.now(), h = mem.hits.get(k);
      if (!h || h.exp <= now) { mem.hits.set(k, { n: 1, exp: now + secs * 1000 }); if (mem.hits.size > 20000) mem.hits.clear(); return 1; }
      return ++h.n;
    },
  };
}
