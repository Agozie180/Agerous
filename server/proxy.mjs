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
import { buildSystemPrompt } from '../src/simulation/interpreter.js';

export function createProxy({ fetch: fetchImpl = globalThis.fetch, env = process.env } = {}) {
  return http.createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (req.method !== 'POST' || req.url !== '/interpret') { res.writeHead(404, cors); return res.end('not found'); }
    let body = '';
    for await (const c of req) { body += c; if (body.length > 4000) { res.writeHead(413, cors); return res.end(); } }
    try {
      const { text, context } = JSON.parse(body);
      const system = buildSystemPrompt(context || {});
      let rawText, model;
      if (env.ANTHROPIC_API_KEY) {
        model = env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
        const r = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: 400, temperature: 0, system, messages: [{ role: 'user', content: String(text).slice(0, 400) }] }) });
        if (!r.ok) throw new Error(`upstream ${r.status}`);
        rawText = (await r.json()).content?.map(b => b.text ?? '').join('');
      } else if (env.OPENAI_API_KEY) {
        model = env.OPENAI_MODEL || 'gpt-4o-mini';
        const r = await fetchImpl('https://api.openai.com/v1/chat/completions', { method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
          body: JSON.stringify({ model, temperature: 0, max_tokens: 400, response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: system }, { role: 'user', content: String(text).slice(0, 400) }] }) });
        if (!r.ok) throw new Error(`upstream ${r.status}`);
        rawText = (await r.json()).choices?.[0]?.message?.content;
      } else throw new Error('no provider key configured on the server');
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ rawText, model }));
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
