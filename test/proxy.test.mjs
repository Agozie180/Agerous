import test from 'node:test';
import assert from 'node:assert/strict';
import { createProxy } from '../server/proxy.mjs';
import { interpret } from '../src/simulation/interpreter.js';

function listen(server) { return new Promise(r => server.listen(0, '127.0.0.1', () => r(server.address().port))); }

test('proxy: the key stays server-side, the game still validates the result', async () => {
  let upstream;
  const fakeProvider = async (url, init) => { upstream = { url, init }; return { ok: true, json: async () => ({ choices: [{ message: { content: '{"events":[{"event_type":"flood","severity":"high"},{"event_type":"meteor"}]}' } }] }) }; };
  const server = createProxy({ fetch: fakeProvider, env: { OPENAI_API_KEY: 'sk-secret' } });
  const port = await listen(server);
  try {
    const r = await interpret('huge flood', { proxyUrl: `http://127.0.0.1:${port}/interpret`, context: { day: 1, hour: 8 } });
    assert.equal(r.source, 'ai');
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].severity, 'high');
    assert.equal(r.rejected.length, 1, 'hallucinated event dropped by the client-side validator');
    assert.match(upstream.init.headers.authorization, /sk-secret/);       // key used server-side only
    assert.ok(!JSON.stringify(r).includes('sk-secret'), 'key never reaches the browser side');
  } finally { server.close(); }
});

test('proxy without a configured key degrades to offline rules', async () => {
  const server = createProxy({ fetch: async () => { throw new Error('nope'); }, env: {} });
  const port = await listen(server);
  try {
    const r = await interpret('A severe flood is coming', { proxyUrl: `http://127.0.0.1:${port}/interpret` });
    assert.equal(r.source, 'rules');
    assert.match(r.notes[0], /AI interpreter unavailable/);
  } finally { server.close(); }
});
