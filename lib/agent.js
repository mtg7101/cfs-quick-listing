'use strict';

const { GoogleAuth } = require('google-auth-library');

const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

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
        if (payload && typeof payload === 'object' && 'output' in payload) return payload.output;
        return payload;
      }

      const message = typeof payload === 'object' && payload && 'error' in payload
        ? JSON.stringify(payload.error)
        : text || response.statusText;
      const err = new Error(`Agent ${operation} failed (${response.status}): ${message}`);
      err.status = response.status;
      err.body = payload;
      err.retryable = RETRYABLE_STATUSES.has(response.status);
      lastErr = err;
      if (!err.retryable || attempt === MAX_ATTEMPTS) throw err;
    } catch (err) {
      lastErr = err;
      if (!err?.retryable || attempt === MAX_ATTEMPTS) throw err;
    }
    // Exponential backoff: 600ms, 1.4s, 3s.
    const delay = Math.min(3000, 300 * 2 ** attempt) + Math.floor(Math.random() * 200);
    await sleep(delay);
  }
  throw lastErr;
}

module.exports = { callAgent };
