/**
 * AGEROUS — tiny key/value + list store for the leaderboard and chat.
 *
 * Production: any Upstash-Redis-compatible REST endpoint (Vercel's "Upstash for Redis" / KV
 * integration sets KV_REST_API_URL + KV_REST_API_TOKEN; Upstash itself uses
 * UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).  Zero dependencies — plain fetch.
 * Without those variables it falls back to process memory, which is fine for local runs but
 * is per-instance and NOT durable on serverless platforms (the API reports `durable:false`).
 */
const mem = globalThis.__agerousMem ??= { kv: new Map(), lists: new Map() };

export function createStore(env = process.env, fetchImpl = globalThis.fetch) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) {
    const cmd = async args => {
      const r = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
      if (!r.ok) throw new Error(`store ${r.status}`);
      return (await r.json()).result;
    };
    return {
      durable: true,
      get: async k => { const v = await cmd(['GET', k]); return v == null ? null : JSON.parse(v); },
      set: async (k, v) => { await cmd(['SET', k, JSON.stringify(v)]); },
      push: async (k, v, keep) => { await cmd(['LPUSH', k, JSON.stringify(v)]); await cmd(['LTRIM', k, 0, keep - 1]); },
      list: async (k, n) => ((await cmd(['LRANGE', k, 0, n - 1])) || []).map(x => JSON.parse(x)),
      del: async k => { await cmd(['DEL', k]); },
    };
  }
  return {
    durable: false,
    get: async k => (mem.kv.has(k) ? structuredClone(mem.kv.get(k)) : null),
    set: async (k, v) => { mem.kv.set(k, structuredClone(v)); },
    push: async (k, v, keep) => { const a = mem.lists.get(k) || []; a.unshift(structuredClone(v)); mem.lists.set(k, a.slice(0, keep)); },
    list: async (k, n) => structuredClone((mem.lists.get(k) || []).slice(0, n)),
    del: async k => { mem.kv.delete(k); mem.lists.delete(k); },
  };
}
