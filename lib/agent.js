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

async function callAgent(operation, input) {
  const endpoint = process.env.AGENT_ENDPOINT_URL;
  if (!endpoint) throw new Error('AGENT_ENDPOINT_URL is not set.');
  const auth = authClient();
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
  if (!response.ok) {
    const message = typeof payload === 'object' && payload && 'error' in payload
      ? JSON.stringify(payload.error)
      : text || response.statusText;
    const err = new Error(`Agent ${operation} failed (${response.status}): ${message}`);
    err.status = response.status;
    err.body = payload;
    throw err;
  }
  if (payload && typeof payload === 'object' && 'output' in payload) return payload.output;
  return payload;
}

module.exports = { callAgent };
