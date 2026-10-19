// Vercel serverless function — set OPENAI_API_KEY or ANTHROPIC_API_KEY in the project's env vars.
import { handleNpc, rateLimitedShared } from '../server/handlers.mjs';
import { createStore } from '../server/store.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const ip = String(req.headers['x-forwarded-for'] || '?').split(',')[0].trim();
  if (await rateLimitedShared(`llm:${ip}`, Number(process.env.LLM_RATE_PER_MIN) || 20, { store: createStore(process.env) })) return res.status(429).json({ error: 'slow down' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const r = await handleNpc(body, process.env);
    return res.status(r.status).json(r.json);
  } catch (e) { return res.status(502).json({ error: e.message }); }
}
