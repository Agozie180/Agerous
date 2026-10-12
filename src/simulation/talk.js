/**
 * AGEROUS — talking to residents.
 *
 * The LLM (when available) only supplies WORDS: a short in-character reply grounded in
 * facts read from the world.  It cannot change state, and with no model the reply is
 * built from the same facts by rules, so the feature always works.  Read-only on world.
 */
import { LOCATION_SPECS } from './geography.js';
import { weatherOf } from './hazard.js';
import { day, hour, minute } from './world.js';

const lvl = v => (v < 0.3 ? 'very low' : v < 0.55 ? 'low' : v < 0.8 ? 'okay' : 'good');
const hh = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

/** The grounded facts a reply may use. */
export function factsFor(npc, w) {
  const news = [];
  const { civil, school, market, election } = w.institutions;
  if (civil.alert) news.push(['', 'Flood watch', 'Flood warning', 'Flood emergency'][civil.alert]);
  if (!school.open) news.push('school is closed');
  if (!market.open) news.push('market is shut');
  if (civil.shelters.length) news.push(`shelter open at ${civil.shelters.map(id => LOCATION_SPECS[id].name).join(', ')}`);
  if (election.state === 'campaign') news.push(`election on day ${election.electionDay}`);
  if (election.state === 'polling') news.push('polls are open');
  return {
    npc: { name: npc.name, role: npc.occupation, activity: npc.activity, where: LOCATION_SPECS[npc.location]?.name ?? 'on the road', reason: npc.reason,
      hunger: npc.needs.food < 0.4 ? 'hungry' : 'fed', energy: 'normal', safety: lvl(npc.needs.safety) },
    scene: { time: hh(hour(w), minute(w)), weather: weatherOf(w), river: w.env.stage > 0.05 ? `+${w.env.stage.toFixed(1)} m` : 'normal', news: news.join('; ') || 'nothing unusual' },
  };
}

/** Rule-based reply — deterministic, grounded, in the resident's voice. */
export function offlineReply(npc, w, text = '') {
  const f = factsFor(npc, w), t = text.toLowerCase();
  const first = npc.name.split(' ')[0];
  if (/hungry|food|eat|meal/.test(t)) return npc.needs.food < 0.4 ? `Honestly, I'm running low on food. ${npc.reason}` : `I've been eating alright, thanks. ${npc.reason}`;
  if (/safe|danger|flood|water|river/.test(t)) return f.scene.river === 'normal' ? `The river's calm today. ${npc.reason}` : `The river is ${f.scene.river} above normal. ${npc.reason}`;
  if (/vote|elect/.test(t)) return npc.voter ? (npc.voted ? 'I already voted.' : 'I plan to vote, if I can get there.') : "I'm not voting in this one.";
  if (/who|name/.test(t)) return `I'm ${first}, the ${npc.occupation}.`;
  return `${npc.reason} (${f.scene.news}.)`;
}

async function viaLLM(npc, w, text, cfg, fetchImpl) {
  const f = factsFor(npc, w);
  if (cfg.proxyUrl) {
    const r = await fetchImpl(cfg.proxyUrl.replace(/\/interpret$/, '/npc'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, npc: f.npc, scene: f.scene }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).reply;
  }
  const system = `You are ${f.npc.name}, ${f.npc.role} in a small town. Reply in character, 1-2 short sentences. Use ONLY these facts, invent nothing: ${JSON.stringify(f)}`;
  if (cfg.provider === 'anthropic') {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: cfg.model || 'claude-haiku-5-5', max_tokens: 120, system, messages: [{ role: 'user', content: text }] }) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).content?.map(b => b.text ?? '').join('');
  }
  const r = await fetchImpl('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model || 'gpt-4o-mini', max_tokens: 120, messages: [{ role: 'system', content: system }, { role: 'user', content: text }] }) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).choices?.[0]?.message?.content;
}

export async function askResident(npc, w, text, cfg = {}) {
  const fetchImpl = cfg.fetch ?? globalThis.fetch;
  const q = String(text).slice(0, 200).trim();
  if (!q) return { reply: offlineReply(npc, w), source: 'rules' };
  if (cfg.proxyUrl || (cfg.provider && cfg.apiKey)) {
    try {
      const reply = String(await viaLLM(npc, w, q, cfg, fetchImpl) ?? '').replace(/[<>]/g, '').trim().slice(0, 280);
      if (reply) return { reply, source: 'ai' };
    } catch { /* fall through to rules */ }
  }
  return { reply: offlineReply(npc, w, q), source: 'rules' };
}
