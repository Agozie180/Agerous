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
import { handleInterpret, handleNpc, handleLeaderboard, handleChat, handleHealth, rateLimitedShared } from './handlers.mjs';
import { createStore } from './store.mjs';

export function createProxy({ fetch: fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const LLM = { '/interpret': handleInterpret, '/npc': handleNpc };
  const SOCIAL = { '/leaderboard': handleLeaderboard, '/chat': handleChat };
  const store = createStore(env);                       // one store per proxy (durable when KV/Upstash env vars are set)
  return http.createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const u = new URL(req.url, 'http://x'), ip = req.socket.remoteAddress || '?';
    const send = (status, json) => { res.writeHead(status, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(json)); };
    if (u.pathname === '/health' && req.method === 'GET') { const r = await handleHealth(env, store); return send(r.status, r.json); }
    const social = SOCIAL[u.pathname], llm = LLM[u.pathname];
    if (!social && !(llm && req.method === 'POST')) { res.writeHead(404, cors); return res.end('not found'); }
    let body = '';
    if (req.method === 'POST') for await (const c of req) { body += c; if (body.length > (social ? 20000 : 4000)) { res.writeHead(413, cors); return res.end(); } }
    try {
      if (social) { const r = await social({ method: req.method, body: body ? JSON.parse(body) : {}, query: Object.fromEntries(u.searchParams), ip }, env, store); return send(r.status, r.json); }
      if (await rateLimitedShared(`llm:${ip}`, Number(env.LLM_RATE_PER_MIN) || 20, { store })) return send(429, { error: 'slow down' });
      const r = await llm(JSON.parse(body), env, fetchImpl); return send(r.status, r.json);
    } catch (e) { send(502, { error: e.message }); }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 8787;
  createProxy().listen(port, () => console.log(`Agerous proxy listening on http://localhost:${port}/interpret`));
}
