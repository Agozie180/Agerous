// Vercel serverless function — GET /api/health: is storage durable and reachable, is an LLM configured?
import { handleHealth } from '../server/handlers.mjs';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOW_ORIGIN || '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try { const r = await handleHealth(process.env); return res.status(r.status).json(r.json); }
  catch (e) { return res.status(502).json({ ok: false, error: e.message }); }
}
