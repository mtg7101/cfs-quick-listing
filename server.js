'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Tiny .env loader so we don't pull in dotenv. Each line is KEY=VALUE; values
// keep their case and special chars verbatim (single-quoted JSON works fine).
function loadDotenv(file) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotenv(path.join(__dirname, '.env'));

const express = require('express');
const { callAgent, events } = require('./lib/agent');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT) || 4100;

function buildProduct(body = {}) {
  const product = {
    sku: String(body.sku || '').trim(),
    stock_number: String(body.sku || '').trim(),
    name: String(body.title || '').trim(),
    title: String(body.title || '').trim(),
    upc: String(body.upc || '').trim(),
    upc_code: String(body.upc || '').trim(),
    price: Number(body.price) || 0,
    normal_retail_price: Number(body.price) || 0,
    ai_context: String(body.context || '').trim(),
  };
  if (Array.isArray(body.images)) product.images = body.images;
  return product;
}

function wholesaleParams(body = {}) {
  const wholesale = body.wholesale_price ?? body.wholesalePrice;
  const num = wholesale === '' || wholesale == null ? null : Number(wholesale);
  return {
    wholesale_price: Number.isFinite(num) ? num : null,
    wholesale_price_list_id: body.wholesale_price_list_id ?? body.wholesalePriceListId ?? null,
    currency: body.currency ?? null,
  };
}

function defaultChannel() {
  return {
    slug: 'cw-bigcommerce',
    kind: 'bigcommerce',
    storefront_channel_id: 1,
    live_mode: true,
    outbound_enabled: true,
  };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'cfs-quick-listing', port: PORT });
});

// Server-sent events: every agent call emits start / retry / done / error
// here. The right-hand "Agent activity" pane subscribes to render them live.
app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`: connected ${Date.now()}\n\n`);
  const send = (event) => {
    try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* client gone */ }
  };
  events.on('event', send);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    events.off('event', send);
  });
});

app.post('/api/listing', async (req, res) => {
  const product = buildProduct(req.body || {});
  if (!product.sku) {
    return res.status(400).json({ ok: false, error: 'missing_sku' });
  }
  if (!product.name) {
    return res.status(400).json({ ok: false, error: 'missing_title' });
  }
  const dryRun = req.body?.dryRun === true;
  const skipOptimize = req.body?.skipOptimize === true;
  const suppliedPayload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : null;
  const ws = wholesaleParams(req.body || {});
  try {
    const output = await callAgent('publish_product_listing', {
      product,
      channel: defaultChannel(),
      payload: suppliedPayload,
      instructions: String(req.body?.instructions || req.body?.context || '').trim(),
      skip_optimize: skipOptimize,
      wholesale_price: ws.wholesale_price,
      wholesale_price_list_id: ws.wholesale_price_list_id,
      currency: ws.currency,
      dry_run: dryRun,
    });
    res.json({ ok: true, dry_run: dryRun, ...output });
  } catch (err) {
    res.status(err.status || 500).json({
      ok: false,
      error: err.message,
      body: err.body || null,
    });
  }
});

app.get('/api/product/:sku', async (req, res) => {
  const sku = String(req.params.sku || '').trim();
  if (!sku) return res.status(400).json({ ok: false, error: 'missing_sku' });
  try {
    const output = await callAgent('search_products', {
      sku,
      limit: 1,
      channel: defaultChannel(),
    });
    res.json({ ok: true, ...output });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message, body: err.body || null });
  }
});

app.post('/api/product/:sku/update', async (req, res) => {
  const sku = String(req.params.sku || '').trim();
  if (!sku) return res.status(400).json({ ok: false, error: 'missing_sku' });
  const product = { ...buildProduct({ ...req.body, sku }) };
  const dryRun = req.body?.dryRun === true;
  const skipOptimize = req.body?.skipOptimize === true;
  const suppliedPayload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : null;
  const ws = wholesaleParams(req.body || {});
  try {
    const output = await callAgent('publish_product_listing', {
      product,
      channel: defaultChannel(),
      payload: suppliedPayload,
      instructions: String(req.body?.instructions || req.body?.context || '').trim(),
      skip_optimize: skipOptimize,
      wholesale_price: ws.wholesale_price,
      wholesale_price_list_id: ws.wholesale_price_list_id,
      currency: ws.currency,
      dry_run: dryRun,
    });
    res.json({ ok: true, dry_run: dryRun, ...output });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message, body: err.body || null });
  }
});

// Direct passthroughs for the price-list tools — handy for "just adjust the
// wholesale price" without optimizing or republishing the product.
app.get('/api/price-lists', async (_req, res) => {
  try {
    const output = await callAgent('list_price_lists', { channel: defaultChannel() });
    res.json({ ok: true, ...output });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message, body: err.body || null });
  }
});

app.get('/api/wholesale/:sku', async (req, res) => {
  const sku = String(req.params.sku || '').trim();
  if (!sku) return res.status(400).json({ ok: false, error: 'missing_sku' });
  try {
    const output = await callAgent('get_wholesale_price', { sku, channel: defaultChannel() });
    res.json({ ok: true, ...output });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message, body: err.body || null });
  }
});

app.post('/api/wholesale/:sku', async (req, res) => {
  const sku = String(req.params.sku || '').trim();
  if (!sku) return res.status(400).json({ ok: false, error: 'missing_sku' });
  const ws = wholesaleParams(req.body || {});
  if (ws.wholesale_price == null) {
    return res.status(400).json({ ok: false, error: 'missing_wholesale_price' });
  }
  try {
    const output = await callAgent('set_wholesale_price', {
      sku,
      wholesale_price: ws.wholesale_price,
      channel: defaultChannel(),
      price_list_id: ws.wholesale_price_list_id,
      currency: ws.currency,
      dry_run: req.body?.dryRun === true,
    });
    res.json({ ok: true, ...output });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message, body: err.body || null });
  }
});

app.listen(PORT, () => {
  console.log(`[cfs-quick-listing] listening on http://0.0.0.0:${PORT}`);
});
