'use strict';

const { EventEmitter } = require('node:events');
const { GoogleAuth } = require('google-auth-library');

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

// Anyone can subscribe to live agent activity (SSE endpoint, log shippers, etc).
const events = new EventEmitter();
events.setMaxListeners(0);

let nextId = 1;
function emit(type, payload) {
  events.emit('event', {
    id: nextId++,
    type,
    t: Date.now(),
    ...payload,
  });
}

let cachedClient;

function loadCredentials() {
  const raw = process.env.GOOGLE_AGENT_CREDENTIALS_JSON;
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  // Allow base64-encoded JSON for environments that mangle multi-line vars.
  return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
}

function authClient() {
  if (cachedClient) return cachedClient;
  cachedClient = new GoogleAuth({
    scopes: [SCOPE],
    credentials: loadCredentials(),
    projectId: process.env.AGENT_PROJECT || undefined,
  });
  return cachedClient;
}

// Reasoning Engine cold starts and transient gateway errors return 5xx /
// UNAVAILABLE. Retry with exponential backoff so the UI doesn't surface them.
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callAgent(operation, input) {
  const endpoint = process.env.AGENT_ENDPOINT_URL;
  if (!endpoint) throw new Error('AGENT_ENDPOINT_URL is not set.');
  const auth = authClient();
  const startedAt = Date.now();
  emit('agent_call_start', { operation, input });

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const client = await auth.getClient();
      const tokenResponse = await client.getAccessToken();
      const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
      if (!token) throw new Error('Could not obtain a Google access token.');

      const headers = {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      };
      const project = process.env.AGENT_PROJECT;
      if (project) headers['X-Goog-User-Project'] = project;

      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ classMethod: operation, input }),
        cache: 'no-store',
      });
      const text = await response.text();
      let payload = text;
      try { payload = text ? JSON.parse(text) : null; } catch { /* keep text */ }

      if (response.ok) {
        const output = payload && typeof payload === 'object' && 'output' in payload ? payload.output : payload;
        emit('agent_call_done', {
          operation,
          attempt,
          duration_ms: Date.now() - startedAt,
          output,
        });
        return output;
      }

      const message = typeof payload === 'object' && payload && 'error' in payload
        ? JSON.stringify(payload.error)
        : text || response.statusText;
      const err = new Error(`Agent ${operation} failed (${response.status}): ${message}`);
      err.status = response.status;
      err.body = payload;
      err.retryable = RETRYABLE_STATUSES.has(response.status);
      lastErr = err;
      if (err.retryable && attempt < MAX_ATTEMPTS) {
        emit('agent_retry', { operation, attempt, status: err.status, message });
      } else {
        emit('agent_call_error', { operation, attempt, status: err.status, message, body: err.body });
        throw err;
      }
    } catch (err) {
      lastErr = err;
      if (!err?.retryable || attempt === MAX_ATTEMPTS) {
        emit('agent_call_error', { operation, attempt, message: err?.message || String(err) });
        throw err;
      }
      emit('agent_retry', { operation, attempt, message: err?.message || String(err) });
    }
    // Exponential backoff: ~600ms, 1.4s, 3s.
    const delay = Math.min(3000, 300 * 2 ** attempt) + Math.floor(Math.random() * 200);
    await sleep(delay);
  }
  throw lastErr;
}

// Stream a multi-agent run: the agent's :streamQuery endpoint emits SSE
// chunks, one per event the BatchCoordinator / ParallelAgent yields. Each
// chunk is a JSON object — we forward it to the caller and to the activity
// bus so the UI can paint per-worker progress live.
async function* streamAgent(operation, input) {
  const baseEndpoint = process.env.AGENT_ENDPOINT_URL;
  if (!baseEndpoint) throw new Error('AGENT_ENDPOINT_URL is not set.');
  // The configured URL ends in :query; swap it for :streamQuery?alt=sse.
  const streamUrl = `${baseEndpoint.replace(/:query(\?.*)?$/, ':streamQuery')}?alt=sse`;
  const auth = authClient();
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
  if (!token) throw new Error('Could not obtain a Google access token.');

  emit('agent_call_start', { operation, input, streaming: true });

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  const project = process.env.AGENT_PROJECT;
  if (project) headers['X-Goog-User-Project'] = project;

  const response = await fetch(streamUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ classMethod: operation, input }),
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    const err = new Error(`Agent stream ${operation} failed (${response.status}): ${text || response.statusText}`);
    err.status = response.status;
    emit('agent_call_error', { operation, status: err.status, message: err.message });
    throw err;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalChunk;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Reasoning Engine returns one JSON object per line (NDJSON-ish, even
      // when alt=sse is requested), so split on newlines and skip blanks /
      // SSE comments.
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        const payloadStr = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (!payloadStr || payloadStr === '[DONE]') continue;
        let event;
        try { event = JSON.parse(payloadStr); } catch { continue; }
        emit('agent_stream_chunk', { operation, chunk: event });
        if (event && (event.type === 'summary' || event.kind === 'summary')) finalChunk = event;
        yield event;
      }
    }
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer.trim().replace(/^data:\s*/, ''));
        emit('agent_stream_chunk', { operation, chunk: event });
        if (event && event.type === 'summary') finalChunk = event;
        yield event;
      } catch { /* trailing noise */ }
    }
  } finally {
    emit('agent_call_done', { operation, streaming: true, output: finalChunk });
  }
}

module.exports = { callAgent, streamAgent, events };
