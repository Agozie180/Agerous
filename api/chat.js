// Vercel serverless function. Durable storage: add Upstash Redis / Vercel KV (see README); otherwise in-memory.
import { handleChat } from '../server/handlers.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  const ip = String(req.headers['x-forwarded-for'] || '?').split(',')[0].trim();
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const r = await handleChat({ method: req.method, body, query: req.query || {}, ip }, process.env);
    return res.status(r.status).json(r.json);
  } catch (e) { return res.status(502).json({ error: e.message }); }
}
