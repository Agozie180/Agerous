/**
 * AGEROUS — one LLM client for every provider.
 *
 * Works with the official OpenAI / Anthropic APIs AND with any third-party gateway that
 * speaks one of those two wire formats (OpenRouter, Groq, Together, DeepSeek, Mistral,
 * Gemini's OpenAI endpoint, Ollama, LM Studio, AgentRouter-style routers, "free model"
 * relays, …): give it a base URL, a key and a model name.
 *
 * Used in the browser (bring-your-own-key) and on the server (Vercel functions / proxy).
 */

export const PRESETS = {
  openai:     { label: 'OpenAI', style: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic:  { label: 'Anthropic', style: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5' },
  openrouter: { label: 'OpenRouter', style: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  groq:       { label: 'Groq', style: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant' },
  together:   { label: 'Together AI', style: 'openai', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  deepseek:   { label: 'DeepSeek', style: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  mistral:    { label: 'Mistral', style: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest' },
  gemini:     { label: 'Google Gemini (OpenAI endpoint)', style: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  ollama:     { label: 'Ollama (local)', style: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
  lmstudio:   { label: 'LM Studio (local)', style: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'local-model' },
};

/** Trim whitespace and a pasted endpoint tail so "https://x.com/v1/chat/completions" still works. */
export function normalizeBase(url, style = 'openai') {
  let u = String(url || '').trim().replace(/\/+$/, '');
  u = u.replace(/\/(chat\/completions|messages|completions)$/i, '');
  if (style === 'anthropic') u = u.replace(/\/v1$/i, '');   // we add /v1/messages ourselves
  return u;
}

export function endpointFor(style, baseUrl) {
  const base = normalizeBase(baseUrl, style);
  return style === 'anthropic' ? `${base}/v1/messages` : `${base}/chat/completions`;
}

async function errorOf(res) {
  const body = await res.json().catch(() => ({}));
  const msg = body?.error?.message || body?.error || body?.message || '';
  return `${res.status ?? ''} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`.trim().slice(0, 160) || `HTTP ${res.status}`;
}

const textOf = c => (typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => p?.text ?? '').join('') : '');

/**
 * One chat completion. Returns { text, model }.
 * @param {{style?:'openai'|'anthropic', baseUrl?:string, apiKey?:string, model?:string, system:string, user:string,
 *          json?:boolean, max?:number, temperature?:number, fetch?:Function, browser?:boolean}} o
 */
export async function chatComplete(o) {
  const style = o.style === 'anthropic' ? 'anthropic' : 'openai';
  const preset = PRESETS[style];
  const baseUrl = o.baseUrl || preset.baseUrl;
  const model = o.model || preset.model;
  const f = o.fetch ?? globalThis.fetch;
  const key = String(o.apiKey ?? '').trim();
  const temperature = o.temperature ?? (o.json === false ? 0.7 : 0);
  const max = o.max ?? 400;
  const url = endpointFor(style, baseUrl);

  if (style === 'anthropic') {
    const headers = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
    if (key) { headers['x-api-key'] = key; headers.Authorization = `Bearer ${key}`; }   // official uses x-api-key; many gateways want Bearer
    if (o.browser) headers['anthropic-dangerous-direct-browser-access'] = 'true';
    const res = await f(url, { method: 'POST', headers, body: JSON.stringify({ model, max_tokens: max, temperature, system: o.system, messages: [{ role: 'user', content: o.user }] }) });
    if (!res.ok) throw new Error(await errorOf(res));
    const data = await res.json();
    return { text: textOf(data.content), model };
  }

  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const body = { model, temperature, max_tokens: max, messages: [{ role: 'system', content: o.system }, { role: 'user', content: o.user }] };
  const send = b => f(url, { method: 'POST', headers, body: JSON.stringify(b) });
  let res = await send(o.json === false ? body : { ...body, response_format: { type: 'json_object' } });
  // Many third-party gateways reject response_format — retry plain; our parser extracts JSON anyway.
  if (!res.ok && o.json !== false && [400, 404, 415, 422].includes(res.status)) res = await send(body);
  if (!res.ok) throw new Error(await errorOf(res));
  const data = await res.json();
  const m = data.choices?.[0]?.message;
  return { text: textOf(m?.content) || m?.reasoning_content || data.choices?.[0]?.text || '', model };
}

/** Friendly explanation for the failure every browser-to-gateway setup hits first. */
export function explainNetworkError(err) {
  const m = String(err?.message || err);
  return /Failed to fetch|NetworkError|Load failed/i.test(m)
    ? 'the browser could not reach that API — usually CORS or a wrong base URL. Use the server proxy (set LLM_BASE_URL on the server) if the gateway blocks browsers'
    : m;
}
