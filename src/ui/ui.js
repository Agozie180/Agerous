/**
 * AGEROUS — HUD / panels.  Reads world state; never writes to it.
 */
import { LOCATION_SPECS, ROAD_SPECS, terrainHeight, weekdayName, WORLD_HALF_SIZE } from '../simulation/geography.js';
import { day, hour, minute } from '../simulation/world.js';
import { weatherOf } from '../simulation/hazard.js';
import { communityScore, evaluateChallenges } from '../simulation/challenges.js';

const $ = id => document.getElementById(id);
const WEATHER = { clear: ['☀', 'Clear'], cloudy: ['⛅', 'Cloudy'], drizzle: ['🌦', 'Drizzle'], rain: ['🌧', 'Rain'], storm: ['⛈', 'Storm'] };
const ACT = { idle: 'Resting', working: 'Working', studying: 'In class', shopping: 'Shopping', praying: 'At church', voting: 'Voting', evacuating: 'Evacuating', sheltering: 'In shelter', sleeping: 'Asleep', traveling: 'Walking', campaigning: 'Campaigning', staying_home: 'Staying home', stranded: 'STRANDED' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hh = (h, m) => `${String(h).padStart(2, '0')}:${String(m ?? 0).padStart(2, '0')}`;

export class UI {
  constructor() {
    this.histLen = 0; this._acc = 0; this.selected = null;
    this.mini = $('minimap').getContext('2d');
    this._buildMiniBase();
  }

  // ── per-frame ───────────────────────────────────────────────────────
  update(world, dt, player) {
    $('clock-time').textContent = hh(hour(world), minute(world));
    $('clock-day').textContent = `Day ${day(world)} · ${weekdayName(day(world))}`;
    const [ic, lb] = WEATHER[weatherOf(world)];
    $('weather-icon').textContent = ic; $('weather-label').textContent = `${lb}${world.env.stage > 0.05 ? ` · river +${world.env.stage.toFixed(1)} m` : ''}`;
    const a = world.institutions.civil.alert, al = $('alert');
    al.classList.toggle('hidden', a === 0);
    al.className = a === 0 ? 'hidden' : (a === 1 ? 'l1' : '');
    al.textContent = ['', 'FLOOD WATCH', 'FLOOD WARNING', 'FLOOD EMERGENCY'][a];
    this._acc += dt;
    if (this._acc > 0.25) {
      this._acc = 0;
      $('score-val').textContent = communityScore(world);
      this.status(world); this.now(world); this.chain(world); this.challenges(world); this.history(world); this.minimap(world, player);
      if (this.selected && world.npcs[this.selected]) this.npcCard(world.npcs[this.selected], world);
    }
  }

  status(w) {
    const { school, market, church, civil, election } = w.institutions;
    const count = id => Object.values(w.npcs).filter(n => n.location === id).length;
    const rows = [
      ['🏫 School', school.open ? `Open · ${count('school')} inside${school.exam ? ' · exams' : ''}` : `CLOSED — ${school.reasons.join('; ')}`, school.open ? '' : 'warn'],
      ['🛒 Market', market.open ? `Open · stock ${market.stock} · price ${market.price.toFixed(2)}×` : `CLOSED — ${market.reasons.join('; ')}`, market.open ? '' : 'warn'],
      ['', `Today: ${market.customersToday} customers · takings ${market.revenueToday}`, ''],
      ['⛪ Church', civil.shelters.includes('church') ? `SHELTER · ${count('church')} inside` : church.service?.begun ? `Service · ${count('church')} inside` : 'Quiet', civil.shelters.includes('church') ? 'good' : ''],
      ['🌊 River', w.env.stage > 0.05 ? `+${w.env.stage.toFixed(2)} m (forecast ${civil.forecast.toFixed(1)} m)` : 'Normal', civil.alert >= 2 ? 'warn' : ''],
      ['🏠 Shelters', civil.shelters.length ? civil.shelters.map(id => LOCATION_SPECS[id].name).join(', ') : 'None needed', civil.shelters.length ? 'good' : ''],
      ['🗳 Election', this.electionText(w, election), election.state === 'polling' ? 'good' : ''],
    ];
    $('status-rows').innerHTML = rows.map(([a, b, c]) => `<div class="row-s ${c}"><span>${a}</span><span>${esc(b)}</span></div>`).join('');
  }

  /** Chips: everything running right now — they all run together. */
  now(w) {
    const { school, market, church, civil, election } = w.institutions;
    const chips = [];
    if (civil.alert >= 1) chips.push(['w', `🌊 ${['', 'Flood watch', 'Flood warning', 'Flood emergency'][civil.alert]}`]);
    if (w.env.rain > 0.05) chips.push(['a', '🌧 Raining']);
    if (civil.shelters.length) chips.push(['g', `🏠 ${civil.shelters.length} shelter${civil.shelters.length > 1 ? 's' : ''}`]);
    if (election.state === 'campaign') chips.push(['a', '🗳 Campaign']);
    if (election.state === 'polling') chips.push(['g', '🗳 Polls open']);
    chips.push([school.open ? 'g' : 'w', school.open ? '🏫 School' : '🏫 School closed']);
    chips.push([market.open ? 'g' : 'w', market.open ? '🛒 Market' : '🛒 Market shut']);
    if (church.service?.begun || civil.shelters.includes('church')) chips.push(['g', '⛪ Church']);
    const html = chips.map(([c, t]) => `<span class="${c}">${t}</span>`).join('');
    if (html !== this._nowHtml) { $('now').innerHTML = html; this._nowHtml = html; }
  }

  /** Consequence chain: what your last sentence set off, as it happens. */
  chain(w) {
    const box = $('chain');
    let i = w.history.length - 1;
    while (i >= 0 && w.history[i].kind !== 'you') i--;
    if (i < 0 || w.t - w.history[i].t > 360) { box.classList.add('hidden'); this._chainHtml = ''; return; }
    const items = [w.history[i], ...w.history.slice(i + 1).filter(e => ['warn', 'major', 'good'].includes(e.kind))].slice(0, 6);
    const short = t => (t.length > 46 ? t.slice(0, 44) + '…' : t);
    const html = items.map((e, k) => `${k ? '<span class="arr">→</span>' : ''}<span class="c ${e.kind === 'you' ? 'you' : e.kind}">${esc(short(e.text))}</span>`).join('');
    if (html === this._chainHtml) return;
    box.innerHTML = html; box.classList.remove('hidden'); this._chainHtml = html;
  }

  electionText(w, e) {
    const [a, b] = e.candidates;
    if (e.state === 'none') return w.elections.length ? `Last: ${w.elections.at(-1).winner} won (${w.elections.at(-1).turnout}% turnout)` : 'None called';
    if (e.state === 'campaign') return `Campaigning · polls Day ${e.electionDay}`;
    if (e.state === 'polling') return `POLLS OPEN · ${e.voted}/${e.eligible} voted`;
    const r = e.result; return `${r.winner} won · ${r.a}–${r.b} · ${r.turnout}% turnout`;
  }

  challenges(w) {
    $('challenges').innerHTML = evaluateChallenges(w).map(c =>
      `<div class="ch ${c.done ? 'done' : ''}"><b>${esc(c.title)}</b>${esc(c.brief)}<small>${esc(c.progress)}</small></div>`).join('');
  }

  history(w) {
    const box = $('history');
    if (w.history.length < this.histLen) { box.innerHTML = ''; this.histLen = 0; }
    if (w.history.length === this.histLen) return;
    const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    for (const e of w.history.slice(this.histLen)) {
      if (e.hour === 0 && e.minute === 0 && /begins\.$/.test(e.text) && e.text.startsWith('Day')) { box.insertAdjacentHTML('beforeend', `<div class="h-day">Day ${e.day} · ${weekdayName(e.day)}</div>`); continue; }
      if (this.histLen === 0 && !box.children.length) box.insertAdjacentHTML('beforeend', `<div class="h-day">Day ${e.day} · ${weekdayName(e.day)}</div>`);
      box.insertAdjacentHTML('beforeend', `<div class="h-e ${e.kind}"><small>${hh(e.hour, e.minute)}</small>${esc(e.text)}</div>`);
    }
    this.histLen = w.history.length;
    if (stick) box.scrollTop = box.scrollHeight;
  }

  // ── NPC inspector ───────────────────────────────────────────────────
  npcCard(n, w) {
    const card = $('npc-card');
    const bar = (l, v) => `<div class="bar ${v < 0.4 ? 'low' : ''}"><span>${l}</span><i><u style="width:${Math.round(v * 100)}%"></u></i>${Math.round(v * 100)}%</div>`;
    const info = `<h4>${esc(n.name)}</h4><div class="sub">${esc(n.occupation)} · ${n.age} · lives at ${esc(LOCATION_SPECS[n.home].name)}</div>
      <span class="act">${ACT[n.activity] ?? n.activity}</span>
      <div class="why">${esc(n.reason)}</div>
      ${bar('Safety', n.needs.safety)}${bar('Food', n.needs.food)}${bar('Social', n.needs.social)}
      <div class="sub" style="margin-top:8px">Money ${n.money} · Routine: ${esc(n.routine)}${n.voter ? ` · ${n.voted ? 'has voted' : 'eligible voter'}` : ''}</div>`;
    if (this.selected !== n.id || card.classList.contains('hidden')) {
      this.selected = n.id;
      card.classList.remove('hidden');
      // the talk form lives outside the live-updating info block so typing is never wiped
      card.innerHTML = `<button class="x" id="npc-x">×</button><div id="npc-info"></div>
        <form id="npc-talk"><input id="npc-q" maxlength="120" placeholder="Ask ${esc(n.name.split(' ')[0])} something…" autocomplete="off"/><button>Ask</button></form><div id="npc-reply"></div>`;
      $('npc-x').onclick = () => this.clearSelection();
      const q = $('npc-q'); q.addEventListener('keydown', e => e.stopPropagation());
      q.addEventListener('focus', () => this.onTyping?.(true)); q.addEventListener('blur', () => this.onTyping?.(false));
      $('npc-talk').onsubmit = async e => {
        e.preventDefault(); const text = q.value; q.value = ''; if (!text.trim()) return;
        $('npc-reply').innerHTML = `<i>…</i>`;
        const r = await this.onAsk?.(n.id, text);
        if (r && this.selected === n.id) $('npc-reply').innerHTML = `<b>${esc(n.name.split(' ')[0])}:</b> “${esc(r.reply)}” <small>${r.source === 'ai' ? 'AI-voiced' : 'rule-voiced'}</small>`;
      };
    }
    $('npc-info').innerHTML = info;
  }
  clearSelection() { this.selected = null; $('npc-card').classList.add('hidden'); }

  talkHint(npc) {
    const el = $('talk-hint');
    if (!npc) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden'); el.textContent = `E — talk to ${npc.name}`;
  }

  // ── prompt result ───────────────────────────────────────────────────
  showInterpretation(r, outcomes = []) {
    const box = $('interp'); box.classList.remove('hidden');
    const src = r.source === 'ai' ? `Interpreted by AI (${r.model})` : r.source === 'rules' ? 'Interpreted by offline rules' : '';
    box.innerHTML = `<div class="src">${esc(src)}</div>` +
      r.events.map(e => `<span class="ev">${esc(e.event_type.replace(/_/g, ' '))}${Object.entries(e).filter(([k, v]) => k !== 'event_type' && v !== 0 && v !== false).map(([k, v]) => ` · ${esc(k.replace(/_/g, ' '))}: ${esc(v)}`).join('')}</span>`).join('') +
      r.rejected.map(x => `<div class="rej">✗ ${esc(x.reason)}</div>`).join('') +
      outcomes.filter(o => o && o.ok === false).map(o => `<div class="rej">✗ ${esc(o.message)}</div>`).join('') +
      r.notes.map(n => `<div class="note">${esc(n)}</div>`).join('');
    clearTimeout(this._interpT);
    this._interpT = setTimeout(() => box.classList.add('hidden'), r.rejected.length || r.notes.length ? 14000 : 7000);
  }

  // ── minimap ─────────────────────────────────────────────────────────
  _buildMiniBase() {
    const S = 176, N = 88, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'); this.heights = [];
    const cell = S / N;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i / N - 0.5) * 2 * WORLD_HALF_SIZE, z = (j / N - 0.5) * 2 * WORLD_HALF_SIZE;
      const h = terrainHeight(x, z); this.heights.push(h);
      const t = Math.min(1, Math.max(0, h / 3.6));
      g.fillStyle = `rgb(${Math.round(70 + t * 60)},${Math.round(110 + t * 50)},${Math.round(60 + t * 30)})`;
      g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
    }
    this.miniBase = c; this.miniN = N;
  }

  minimap(w, player) {
    const g = this.mini, S = 176, k = S / (WORLD_HALF_SIZE * 2);
    const X = x => (x + WORLD_HALF_SIZE) * k, Z = z => (z + WORLD_HALF_SIZE) * k;
    g.drawImage(this.miniBase, 0, 0);
    const N = this.miniN, cell = S / N;
    g.fillStyle = 'rgba(60,140,220,0.75)';
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (this.heights[j * N + i] < w.env.stage) g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
    g.strokeStyle = 'rgba(40,36,30,0.9)'; g.lineWidth = 1.5;
    for (const r of Object.values(ROAD_SPECS)) { g.beginPath(); r.points.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke(); }
    for (const [id, s] of Object.entries(LOCATION_SPECS)) {
      if (s.kind === 'river' || s.kind === 'plaza') continue;
      const loc = w.locations[id];
      g.fillStyle = loc.isShelter ? '#ffc14d' : loc.flooded ? '#6ec1ff' : '#f2f2f2';
      g.fillRect(X(s.x) - 2.5, Z(s.z) - 2.5, 5, 5);
    }
    for (const n of Object.values(w.npcs)) {
      g.fillStyle = n.activity === 'stranded' ? '#ff4d4d' : n.activity === 'evacuating' ? '#ff9f43' : n.id === this.selected ? '#fff' : '#fde68a';
      g.fillRect(X(n.x) - 1.5, Z(n.z) - 1.5, 3, 3);
    }
    g.save(); g.translate(X(player.x), Z(player.z)); g.rotate(-player.heading + Math.PI);
    g.fillStyle = '#35e0ff'; g.beginPath(); g.moveTo(0, -6); g.lineTo(4, 4); g.lineTo(-4, 4); g.fill(); g.restore();
  }
}
