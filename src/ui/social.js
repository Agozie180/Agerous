/**
 * AGEROUS — leaderboard + global chat client.  Talks to /api/leaderboard and /api/chat.
 * Every failure degrades quietly: the game never depends on the network.
 */
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const API = (import.meta.env?.VITE_API_BASE || '/api').replace(/\/$/, '');

async function call(path, opts) {
  const r = await fetch(`${API}${path}`, { ...opts, headers: { 'content-type': 'application/json' } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
export const playerName = () => {
  let n = store.get('agerous.name');
  if (!n) { n = `Guest${Math.floor(1000 + Math.random() * 9000)}`; store.set('agerous.name', n); }
  return n;
};
export const setPlayerName = n => store.set('agerous.name', String(n).slice(0, 20));
export const bestLocal = () => Number(store.get('agerous.best') || 0);
export const saveBestLocal = n => { if (n > bestLocal()) store.set('agerous.best', String(n)); };

export const submitRun = (name, run) => call('/leaderboard', { method: 'POST', body: JSON.stringify({ name, run }) });

export async function renderBoard(me) {
  const box = $('board'), note = $('board-note');
  try {
    const d = await call('/leaderboard');
    box.innerHTML = d.entries.length
      ? `<table>${d.entries.map((e, i) => `<tr class="${e.name.toLowerCase() === me.toLowerCase() ? 'me' : ''}"><td class="n">${i + 1}</td><td>${i === 0 ? '👑 ' : ''}${esc(e.name)}<small>safety ${e.parts.safety} · services ${e.parts.services} · vote ${e.parts.democracy} · wellbeing ${e.parts.wellbeing} · ${e.used} sentence${e.used === 1 ? '' : 's'}</small></td><td class="s">${e.total}</td></tr>`).join('')}</table>`
      : '<p class="fine">No scores yet — be the first.</p>';
    note.textContent = `✔ Every score is verified by replaying the run on the server.${d.durable ? '' : ' (Demo storage: scores may reset when the server restarts.)'}`;
  } catch (e) {
    box.innerHTML = '<p class="fine">The leaderboard is offline here. Deploy with the API routes (see README) or run <code>node server/proxy.mjs</code> next to <code>npm run dev</code>.</p>';
    note.textContent = bestLocal() ? `Your best on this device: ${bestLocal()}` : '';
  }
}

export class Chat {
  constructor() { this.last = 0; this.timer = null; this.open = false; this.mine = '';
    $('chat-form').onsubmit = async e => { e.preventDefault(); const text = $('chat-input').value.trim(); if (!text) return; $('chat-input').value = '';
      try { await call('/chat', { method: 'POST', body: JSON.stringify({ name: playerName(), text }) }); await this.poll(); } catch (err) { $('chat-note').textContent = err.message; } };
    const inp = $('chat-input'); inp.addEventListener('keydown', e => e.stopPropagation());
  }
  setOpen(v) { this.open = v; if (v) $('chat-dot').classList.add('hidden'); this.poll(); }
  start() { if (this.timer) return; this.timer = setInterval(() => this.poll(), 4000); this.poll(); }
  async poll() {
    try {
      const d = await call(`/chat?after=${this.last}`);
      const log = $('chat-log');
      $('chat-note').textContent = d.durable ? '' : 'Demo storage: messages may reset when the server restarts.';
      if (!d.messages.length) { if (!log.children.length) log.innerHTML = '<p class="fine">No messages yet. Say hi 👋</p>'; return; }
      if (!this.last) log.innerHTML = '';
      const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30;
      for (const m of d.messages) { log.insertAdjacentHTML('beforeend', `<div class="${m.name === playerName() ? 'me' : ''}"><b>${esc(m.name)}</b> ${esc(m.text)}</div>`); this.last = Math.max(this.last, m.id); }
      if (stick) log.scrollTop = log.scrollHeight;
      if (!this.open && this.seen) $('chat-dot').classList.remove('hidden');
      this.seen = true;
    } catch { $('chat-note').textContent = 'Chat is offline here (needs the API routes — see README).'; }
  }
}
