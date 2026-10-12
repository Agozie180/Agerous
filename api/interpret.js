// Vercel serverless function — set OPENAI_API_KEY or ANTHROPIC_API_KEY in the project's env vars.
import { handleInterpret, rateLimited } from '../server/handlers.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const ip = String(req.headers['x-forwarded-for'] || '?').split(',')[0].trim();
  if (rateLimited(ip, process.env)) return res.status(429).json({ error: 'slow down' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const r = await handleInterpret(body, process.env);
    return res.status(r.status).json(r.json);
  } catch (e) { return res.status(502).json({ error: e.message }); }
}
