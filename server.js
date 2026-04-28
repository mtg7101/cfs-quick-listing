'use strict';

const path = require('node:path');
const express = require('express');
const { callAgent } = require('./lib/agent');

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

app.post('/api/listing', async (req, res) => {
  const product = buildProduct(req.body || {});
  if (!product.sku) {
    return res.status(400).json({ ok: false, error: 'missing_sku' });
  }
  if (!product.name) {
    return res.status(400).json({ ok: false, error: 'missing_title' });
  }
  const dryRun = req.body?.dryRun === true;
  try {
    const output = await callAgent('publish_product_listing', {
      product,
      channel: defaultChannel(),
      instructions: String(req.body?.instructions || '').trim(),
      skip_optimize: false,
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
  try {
    const output = await callAgent('publish_product_listing', {
      product,
      channel: defaultChannel(),
      instructions: String(req.body?.instructions || '').trim(),
      skip_optimize: false,
      dry_run: dryRun,
    });
    res.json({ ok: true, dry_run: dryRun, ...output });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message, body: err.body || null });
  }
});

app.listen(PORT, () => {
  console.log(`[cfs-quick-listing] listening on http://0.0.0.0:${PORT}`);
});
