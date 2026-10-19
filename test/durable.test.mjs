import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, findUpstash } from '../server/store.mjs';
import { handleLeaderboard, handleChat, handleHealth, rateLimitedShared } from '../server/handlers.mjs';
import { moderate, isCleanName } from '../server/moderation.mjs';

/** A fake Upstash Redis REST endpoint: enough commands to run the whole app against it. */
function fakeUpstash() {
  const kv = new Map(), lists = new Map(), hashes = new Map(), exp = new Map(), log = [];
  const alive = k => { const e = exp.get(k); if (e && e <= Date.now()) { kv.delete(k); exp.delete(k); } };
  const fetch = async (url, init) => {
    if (init.headers.Authorization !== 'Bearer secret') return { ok: false, status: 401, json: async () => ({ error: 'unauthorized' }) };
    const [c, k, ...a] = JSON.parse(init.body); log.push(c);
    let result = null; alive(k);
    switch (c) {
      case 'SET': kv.set(k, a[0]); result = 'OK'; break;
      case 'GET': result = kv.get(k) ?? null; break;
      case 'DEL': kv.delete(k); lists.delete(k); hashes.delete(k); result = 1; break;
      case 'LPUSH': { const l = lists.get(k) || []; l.unshift(a[0]); lists.set(k, l); result = l.length; break; }
      case 'LTRIM': lists.set(k, (lists.get(k) || []).slice(a[0], a[1] + 1)); result = 'OK'; break;
      case 'LRANGE': result = (lists.get(k) || []).slice(a[0], a[1] + 1); break;
      case 'HSET': { const h = hashes.get(k) || new Map(); h.set(a[0], a[1]); hashes.set(k, h); result = 1; break; }
      case 'HGET': result = hashes.get(k)?.get(a[0]) ?? null; break;
      case 'HGETALL': result = [...(hashes.get(k) || new Map())].flat(); break;
      case 'HDEL': hashes.get(k)?.delete(a[0]); result = 1; break;
      case 'INCR': kv.set(k, String(Number(kv.get(k) || 0) + 1)); result = Number(kv.get(k)); break;
      case 'EXPIRE': exp.set(k, Date.now() + a[0] * 1000); result = 1; break;
      default: return { ok: true, status: 200, json: async () => ({ error: `ERR unknown command ${c}` }) };
    }
    return { ok: true, status: 200, json: async () => ({ result }) };
  };
  return { fetch, log, kv, lists, hashes };
}
const ENV = { KV_REST_API_URL: 'https://fake.upstash.io', KV_REST_API_TOKEN: 'secret' };
const REC = [{ t: 500, event: { event_type: 'recovery', delay_days: 0 } }];

test('store: finds Upstash / Vercel KV credentials, including custom prefixes', () => {
  assert.deepEqual(findUpstash({ UPSTASH_REDIS_REST_URL: 'u', UPSTASH_REDIS_REST_TOKEN: 't' }), { url: 'u', token: 't' });
  assert.deepEqual(findUpstash({ KV_REST_API_URL: 'u2', KV_REST_API_TOKEN: 't2' }), { url: 'u2', token: 't2' });
  assert.deepEqual(findUpstash({ STORAGE_KV_REST_API_URL: 'u3', STORAGE_KV_REST_API_TOKEN: 't3', OTHER: 'x' }), { url: 'u3', token: 't3' });
  assert.equal(findUpstash({ KV_REST_API_URL: 'only-url' }), null);
  assert.equal(findUpstash({}), null);
  assert.equal(createStore({}).durable, false);
});

test('durable store: leaderboard and chat report durable:true and survive a "cold start" (new store object)', async () => {
  const up = fakeUpstash();
  const a = createStore(ENV, up.fetch);
  assert.equal(a.durable, true);
  const lb = await handleLeaderboard({ method: 'POST', body: { name: 'Ada', run: REC }, ip: 'd1' }, ENV, a);
  assert.equal(lb.status, 200); assert.equal(lb.json.durable, true); assert.equal(lb.json.rank, 1);
  const chat = await handleChat({ method: 'POST', body: { name: 'Ada', text: 'hello durable world' }, ip: 'd1' }, { ...ENV, CHAT_MIN_GAP_SEC: '0' }, a);
  assert.equal(chat.status, 200);
  const b = createStore(ENV, up.fetch);                                   // a different serverless instance, same database
  const board = (await handleLeaderboard({ method: 'GET' }, ENV, b)).json;
  assert.equal(board.durable, true); assert.equal(board.entries[0].name, 'Ada');
  const msgs = (await handleChat({ method: 'GET', query: {}, ip: 'd2' }, ENV, b)).json;
  assert.equal(msgs.durable, true); assert.equal(msgs.messages[0].text, 'hello durable world');
});

test('durable store: a bad token surfaces as an error instead of silently falling back to memory', async () => {
  const up = fakeUpstash();
  const bad = createStore({ ...ENV, KV_REST_API_TOKEN: 'wrong' }, up.fetch);
  await assert.rejects(() => handleLeaderboard({ method: 'GET' }, ENV, bad), /store 401/);
  const h = await handleHealth({ ...ENV, KV_REST_API_TOKEN: 'wrong' }, bad);
  assert.equal(h.json.ok, false); assert.equal(h.json.store.reachable, false); assert.match(h.json.store.error, /401/);
});

test('health: reports durable + reachable storage and whether an LLM is configured', async () => {
  const up = fakeUpstash();
  const h = (await handleHealth({ ...ENV, LLM_BASE_URL: 'https://x/v1', LLM_API_KEY: 'k' }, createStore(ENV, up.fetch))).json;
  assert.deepEqual([h.ok, h.store.durable, h.store.reachable, h.llm.configured], [true, true, true, true]);
  const local = (await handleHealth({}, createStore({}))).json;
  assert.deepEqual([local.store.durable, local.store.reachable, local.llm.configured], [false, true, false]);
  assert.match(local.store.note, /memory/);
});

test('leaderboard: two players finishing at the same moment never overwrite each other', async () => {
  const up = fakeUpstash(), s = createStore(ENV, up.fetch);
  const names = Array.from({ length: 12 }, (_, i) => `P${i}`);
  await Promise.all(names.map(n => handleLeaderboard({ method: 'POST', body: { name: n, run: REC }, ip: `ip-${n}` }, ENV, s)));
  const board = (await handleLeaderboard({ method: 'GET' }, ENV, s)).json.entries;
  assert.equal(board.length, 12, 'all 12 concurrent submissions are kept');
});

test('leaderboard: offensive or link names are refused', async () => {
  const s = createStore({});
  for (const name of ['fuck', 'spam.com', 'f u c k']) {
    const r = await handleLeaderboard({ method: 'POST', body: { name, run: [] }, ip: 'nm' + name }, {}, s);
    assert.equal(r.status, 400, name);
  }
  assert.equal((await handleLeaderboard({ method: 'POST', body: { name: 'Grace Obi', run: [] }, ip: 'nm-ok' }, {}, s)).status, 200);
});

test('rate limit: shared across instances when the store is durable, per IP', async () => {
  const up = fakeUpstash();
  const inst = () => createStore(ENV, up.fetch);                          // three "serverless instances"
  const out = [];
  for (let i = 0; i < 9; i++) out.push(await rateLimitedShared('chat:7.7.7.7', 5, { store: inst() }));
  assert.deepEqual(out, [false, false, false, false, false, true, true, true, true]);
  assert.equal(await rateLimitedShared('chat:8.8.8.8', 5, { store: inst() }), false, 'another IP is unaffected');
  assert.ok(up.log.includes('INCR') && up.log.includes('EXPIRE'));
});

test('rate limit: fails open when the store is down (a legitimate player is never blocked)', async () => {
  const broken = createStore(ENV, async () => { throw new Error('network down'); });
  assert.equal(await rateLimitedShared('chat:fail-open', 5, { store: broken }), false);
});

test('chat: per-IP rate limit, minimum gap, duplicate guard and read throttle', async () => {
  const s = createStore({}), post = (text, ip, env = {}) => handleChat({ method: 'POST', body: { name: 'n', text }, ip }, env, s);
  // minimum gap (default 2 s): an immediate second message from the same IP is refused
  assert.equal((await post('first', 'g1')).status, 200);
  const fast = await post('second', 'g1'); assert.equal(fast.status, 429); assert.match(fast.json.error, /couple of seconds/);
  assert.equal((await post('from someone else', 'g2')).status, 200, 'other IPs are unaffected');
  // sustained limit
  const env = { CHAT_RATE_PER_MIN: '4', CHAT_MIN_GAP_SEC: '0' }, codes = [];
  for (let i = 0; i < 7; i++) codes.push((await post('msg ' + i, 'g3', env)).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 429, 429, 429]);
  // duplicates
  const e0 = { CHAT_MIN_GAP_SEC: '0' };
  assert.equal((await post('same words', 'g4', e0)).status, 200);
  assert.equal((await post('Same Words', 'g4', e0)).status, 429);
  // read throttle
  const reads = []; for (let i = 0; i < 5; i++) reads.push((await handleChat({ method: 'GET', query: {}, ip: 'g5' }, { CHAT_READ_PER_MIN: '3' }, s)).status);
  assert.deepEqual(reads, [200, 200, 200, 429, 429]);
});

test('chat: links and abuse are removed before anything is stored; link-only messages are refused', async () => {
  const s = createStore({}), env = { CHAT_MIN_GAP_SEC: '0' };
  const post = (text, ip) => handleChat({ method: 'POST', body: { name: 'n', text }, ip }, env, s);
  const ok = await post('buy at spam.xyz/free or www.x.com, mail a@b.com', 'm1');
  assert.equal(ok.status, 200); assert.ok(ok.json.filtered); assert.ok(!/spam|www|a@b/.test(ok.json.message.text), ok.json.message.text);
  assert.match((await post('you are a f u c k e r', 'm2')).json.message?.text ?? '', /•••/);
  assert.equal((await post('https://evil.example', 'm3')).status, 400);
  assert.equal((await post('fuck', 'm4')).status, 400);
  const bad = await handleChat({ method: 'POST', body: { name: 'shit', text: 'hi there' }, ip: 'm5' }, env, s);
  assert.equal(bad.json.message.name, 'visitor', 'an abusive display name is replaced');
  const stored = (await handleChat({ method: 'GET', query: {}, ip: 'm6' }, env, s)).json.messages.map(m => m.text).join(' | ');
  assert.ok(!/spam|evil|fuck/i.test(stored));
});

test('moderation: catches leetspeak, stretched and spaced-out abuse without flagging innocent words', () => {
  for (const bad of ['what the fuck', 'F@CK you', 'sh1t', 'fuuuuck', 'f.u.c.k', 'a b!tch', 'kill yourself']) assert.ok(moderate(bad).profanity, bad);
  for (const fine of ['assassin class', 'Scunthorpe cockpit', 'the shiitake mushrooms', 'This hit the market', 'the flood is coming', 'con artist', 'Grace Obi']) {
    const r = moderate(fine); assert.ok(!r.profanity && !r.links, fine + ' → ' + r.text);
  }
  for (const link of ['https://a.example/x', 'WWW.spam.io/free', 'spam dot com', 'join t.me/scam', 'bit.me/free', 'me@x.org']) assert.ok(moderate(link).links, link);
  for (const fine of ['Yes.In the morning', 'I like node.js', 'e.g. this']) assert.ok(!moderate(fine).links, fine);
  assert.equal(moderate('<b>hi</b>\u0007 there').text, 'b hi /b there');
  assert.equal(isCleanName('Ada'), true); assert.equal(isCleanName('spam.com'), false);
});
