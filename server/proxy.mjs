#!/usr/bin/env node
/**
 * AGEROUS — optional key-safe interpreter proxy (zero dependencies)
 *
 *   OPENAI_API_KEY=sk-... node server/proxy.mjs          # or ANTHROPIC_API_KEY=...
 *   → POST http://localhost:8787/interpret  { "text": "...", "context": {day, hour} }
 *   ← { "rawText": "<model JSON>", "model": "..." }
 *
 * The browser never sees the key.  The proxy returns the model's raw JSON; the game
 * still runs it through the schema validator, so a compromised proxy cannot make the
 * simulation do anything outside the event schema either.
 * In the game: AI settings → Provider "Proxy" → URL http://localhost:8787/interpret
 */
import http from 'node:http';
import { handleInterpret, handleNpc, rateLimited } from './handlers.mjs';

export function createProxy({ fetch: fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const ROUTES = { '/interpret': handleInterpret, '/npc': handleNpc };
  return http.createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const handler = ROUTES[req.url];
    if (req.method !== 'POST' || !handler) { res.writeHead(404, cors); return res.end('not found'); }
    if (rateLimited(req.socket.remoteAddress || '?', env)) { res.writeHead(429, cors); return res.end('{"error":"slow down"}'); }
    let body = '';
    for await (const c of req) { body += c; if (body.length > 4000) { res.writeHead(413, cors); return res.end(); } }
    try {
      const r = await handler(JSON.parse(body), env, fetchImpl);
      res.writeHead(r.status, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify(r.json));
    } catch (e) {
      res.writeHead(502, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 8787;
  createProxy().listen(port, () => console.log(`Agerous proxy listening on http://localhost:${port}/interpret`));
}
