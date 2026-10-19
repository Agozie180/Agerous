#!/usr/bin/env node
/**
 * A tiny Upstash-Redis-compatible REST server for local testing — lets you run the whole app
 * (leaderboard, chat, rate limits, /health) against the *durable* code path with no account:
 *
 *   node scripts/fake-upstash.mjs &                       # listens on :8788, token "local"
 *   KV_REST_API_URL=http://localhost:8788 KV_REST_API_TOKEN=local node server/proxy.mjs
 *
 * Data lives in this process only. It implements just the commands server/store.mjs uses.
 */
import http from 'node:http';

export function createFakeUpstash({ token = 'local' } = {}) {
  const kv = new Map(), lists = new Map(), hashes = new Map(), exp = new Map();
  const alive = k => { const e = exp.get(k); if (e && e <= Date.now()) { kv.delete(k); exp.delete(k); } };
  return http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const send = (status, json) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: 'Unauthorized' });
    const [c, k, ...a] = JSON.parse(body); alive(k);
    let result = null;
    switch (c) {
      case 'SET': kv.set(k, a[0]); result = 'OK'; break;
      case 'GET': result = kv.get(k) ?? null; break;
      case 'DEL': kv.delete(k); lists.delete(k); hashes.delete(k); result = 1; break;
      case 'LPUSH': { const l = lists.get(k) || []; l.unshift(a[0]); lists.set(k, l); result = l.length; break; }
      case 'LTRIM': lists.set(k, (lists.get(k) || []).slice(a[0], a[1] + 1)); result = 'OK'; break;
      case 'LRANGE': result = (lists.get(k) || []).slice(a[0], a[1] + 1); break;
      case 'HSET': { const h = hashes.get(k) || new Map(); h.set(a[0], a[1]); hashes.set(k, h); result = 1; break; }
      case 'HGET': result = hashes.get(k)?.get(a[0]) ?? null; break;
      case 'HGETALL': result = [...(hashes.get(k) || new Map())].flat(); break;
      case 'HDEL': hashes.get(k)?.delete(a[0]); result = 1; break;
      case 'INCR': kv.set(k, String(Number(kv.get(k) || 0) + 1)); result = Number(kv.get(k)); break;
      case 'EXPIRE': exp.set(k, Date.now() + a[0] * 1000); result = 1; break;
      default: return send(200, { error: `ERR unknown command '${c}'` });
    }
    send(200, { result });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 8788;
  createFakeUpstash({ token: process.env.TOKEN || 'local' }).listen(port, () => console.log(`fake Upstash on http://localhost:${port} (token "${process.env.TOKEN || 'local'}")`));
}
