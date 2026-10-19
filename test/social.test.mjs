import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLeaderboard, handleChat } from '../server/handlers.mjs';
import { createStore } from '../server/store.mjs';
import { replayRun, createScenarioWorld, recordRun, scoreScenario, SCENARIO } from '../src/simulation/scenario.js';
import { advanceMinutes } from '../src/simulation/engine.js';
import { queueEvent } from '../src/simulation/events.js';
import { fresh } from './helpers.mjs';

const REC = { t: 500, event: { event_type: 'recovery', delay_days: 0 } };

test('determinism: any chunking of time gives the identical world (the basis of server verification)', () => {
  const plan = [[300, { event_type: 'recovery', delay_days: 0 }], [900, { event_type: 'build', structure: 'levee', target: 'market', delay_days: 0 }]];
  const A = createScenarioWorld(); const B = createScenarioWorld();
  let seed = 3; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const run = (w, jitter) => {
    const base = w.t;
    for (const [dt, e] of plan) { const T = base + dt; while (w.t < T) advanceMinutes(w, jitter ? Math.min(T - w.t, 0.2 + r() * 29) : T - w.t); queueEvent(w, e); }
    const END = base + 3000; while (w.t < END) advanceMinutes(w, jitter ? Math.min(END - w.t, 0.2 + r() * 29) : END - w.t);
    const j = JSON.parse(JSON.stringify(w)); delete j.carry; return JSON.stringify(j);
  };
  assert.equal(run(A, false), run(B, true));
});

test('replay: same run → same score; different runs → different scores; tampered runs are rejected', () => {
  const a = replayRun([REC]), b = replayRun([REC]), none = replayRun([]);
  assert.equal(a.score.total, b.score.total);
  assert.notEqual(a.score.total, none.score.total);
  assert.ok(a.score.total > none.score.total, 'a timely recovery order helps');
  assert.equal(replayRun([{ t: 500, event: { event_type: 'meteor' } }]).ok, false);
  assert.equal(replayRun([{ ...REC, t: -5 }]).ok, false);
  assert.equal(replayRun([{ ...REC, t: 9e9 }]).ok, false);
  assert.equal(replayRun(Array(50).fill(REC)).ok, false);
  assert.equal(replayRun('nope').ok, false);
});

test('game-side recording matches server replay exactly', () => {
  const w = createScenarioWorld();
  advanceMinutes(w, 20);
  const ev = { event_type: 'recovery', delay_days: 0 };
  recordRun(w, [ev]); queueEvent(w, ev);
  advanceMinutes(w, SCENARIO.endT - w.t);
  const server = replayRun(w.scenario.run);
  assert.ok(server.ok);
  // live world scored directly vs server replay
  assert.equal(scoreScenario(w).total, server.score.total, 'live world and server replay agree exactly');
  assert.equal(recordRun(w, [ev]) && w.scenario.prompts, 2);
});

test('leaderboard: server computes the score (client claims ignored), keeps best per name, ranks', async () => {
  const store = createStore({});
  const post = body => handleLeaderboard({ method: 'POST', body, ip: Math.random().toString() }, {}, store);
  const lie = await post({ name: 'Cheater', run: [], score: 999999, total: 999999 });
  assert.equal(lie.status, 200);
  assert.ok(lie.json.score.total < 700, 'claimed score is ignored');
  const good = await post({ name: 'Ada', run: [REC] });
  assert.equal(good.json.rank, 1);
  assert.equal((await post({ name: 'ada', run: [] })).json.rank, 1, 'worse resubmission does not replace the best');
  const board = (await handleLeaderboard({ method: 'GET' }, {}, store)).json;
  assert.equal(board.entries.length, 2);
  assert.equal(board.entries[0].name, 'Ada');
  assert.equal((await post({ name: '', run: [] })).status, 400);
  assert.equal((await post({ name: 'X', run: [{ t: 1, event: { event_type: 'nuke' } }] })).status, 400);
});

test('leaderboard: submissions are rate limited per IP', async () => {
  const store = createStore({});
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push((await handleLeaderboard({ method: 'POST', body: { name: 'N' + i, run: [] }, ip: '5.5.5.5' }, { LB_RATE_PER_MIN: '3' }, store)).status);
  assert.deepEqual(codes.slice(0, 3), [200, 200, 200]);
  assert.equal(codes[7], 429);
});

test('chat: post, read in order, sanitise, mask abuse, strip links, rate limit, admin clear', async () => {
  const store = createStore({});
  const post = (text, ip = '1.1.1.1', name = 'Ada') => handleChat({ method: 'POST', body: { name, text }, ip }, { CHAT_ADMIN_KEY: 'sek' }, store);
  assert.equal((await post('hello <script>alert(1)</script> world')).status, 200);
  await post('visit https://spam.example now', '2.2.2.2'); await post('what the fuck', '3.3.3.3');
  const msgs = (await handleChat({ method: 'GET', query: {} }, {}, store)).json.messages;
  assert.equal(msgs.length, 3);
  assert.ok(!msgs[0].text.includes('<'));
  assert.match(msgs[1].text, /link removed/); assert.match(msgs[2].text, /•••/);
  assert.ok(msgs[0].id < msgs[1].id && msgs[1].id < msgs[2].id);
  const after = (await handleChat({ method: 'GET', query: { after: msgs[1].id } }, {}, store)).json.messages;
  assert.equal(after.length, 1);
  assert.equal((await post('')).status, 400);
  assert.equal((await handleChat({ method: 'POST', body: { action: 'clear', key: 'wrong' }, ip: 'x' }, { CHAT_ADMIN_KEY: 'sek' }, store)).status, 403);
  await handleChat({ method: 'POST', body: { action: 'clear', key: 'sek' }, ip: 'x' }, { CHAT_ADMIN_KEY: 'sek' }, store);
  assert.equal((await handleChat({ method: 'GET', query: {} }, {}, store)).json.messages.length, 0);
  assert.equal((await handleChat({ method: 'GET' }, { CHAT_DISABLED: '1' }, store)).status, 503);
});

test('chat flood: 30 rapid messages from one IP are throttled', async () => {
  const store = createStore({}); const out = [];
  for (let i = 0; i < 30; i++) out.push((await handleChat({ method: 'POST', body: { name: 'a', text: 'm' + i }, ip: '9.9.9.9' }, { CHAT_RATE_PER_MIN: '10', CHAT_MIN_GAP_SEC: '0' }, store)).status);
  assert.equal(out.filter(s => s === 200).length, 10);
});

test('store: Upstash REST adapter speaks the documented command protocol', async () => {
  const sent = []; const data = new Map();
  const f = async (url, init) => {
    const a = JSON.parse(init.body); sent.push({ url, auth: init.headers.Authorization, a });
    if (a[0] === 'SET') { data.set(a[1], a[2]); return { ok: true, json: async () => ({ result: 'OK' }) }; }
    if (a[0] === 'GET') return { ok: true, json: async () => ({ result: data.get(a[1]) ?? null }) };
    return { ok: true, json: async () => ({ result: a[0] === 'LRANGE' ? ['{"id":1}'] : 1 }) };
  };
  const s = createStore({ KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'tok' }, f);
  assert.equal(s.durable, true);
  await s.set('k', { a: 1 }); assert.deepEqual(await s.get('k'), { a: 1 });
  await s.push('l', { id: 1 }, 100); assert.deepEqual(await s.list('l', 5), [{ id: 1 }]);
  assert.equal(sent[0].auth, 'Bearer tok');
  assert.ok(sent.some(x => x.a[0] === 'LTRIM'));
});
