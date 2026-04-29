'use strict';

const $ = (sel, root = document) => root.querySelector(sel);

const createForm = $('#create-form');
const createPreviewBox = $('#create-preview');
const createDiff = $('#create-diff');
const createOutput = $('#create-output');

const lookupForm = $('#lookup-form');
const updateShell = $('#update-shell');
const updateForm = $('#update-form');
const updatePreviewBox = $('#update-preview');
const updateDiff = $('#update-diff');
const lookupOutput = $('#lookup-output');

const healthStatus = $('#health-status');
const activityFeed = $('#activity-feed');
const eventStatus = $('#event-status');
const eventClear = $('#event-clear');

// Cached agent proposals so the Confirm button can re-send the exact payload.
const state = {
  create: { payload: null, optimization: null, wholesale: null },
  update: { payload: null, optimization: null, existing: null, sku: '', wholesale: null },
};

const FIELD_LABELS = [
  ['name', 'Listing Title'],
  ['sku', 'SKU'],
  ['price', 'Regular Price'],
  ['sale_price', 'Sale Price'],
  ['condition', 'Condition'],
  ['is_visible', 'Visible'],
  ['categories', 'Categories'],
  ['brand_id', 'Brand'],
  ['upc', 'UPC'],
  ['mpn', 'MPN'],
  ['weight', 'Weight'],
  ['width', 'Width'],
  ['height', 'Height'],
  ['depth', 'Depth'],
  ['meta_description', 'SEO Meta Description'],
  ['search_keywords', 'Search Keywords'],
  ['description', 'Listing Description'],
  ['custom_url', 'Custom URL'],
  ['wholesale_price', 'Wholesale Price'],
];

function formData(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'number') data[el.name] = el.value === '' ? null : Number(el.value);
    else data[el.name] = el.value;
  }
  return data;
}

function setBusy(form, busy) {
  for (const btn of form.querySelectorAll('button')) btn.disabled = busy;
}

function setBusyAll(busy) {
  for (const btn of document.querySelectorAll('button')) btn.disabled = busy;
}

function showOutput(node, payload, isError = false) {
  node.hidden = false;
  node.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  node.classList.toggle('error', isError);
  node.classList.toggle('ok', !isError);
}

function hideOutput(node) {
  node.hidden = true;
  node.textContent = '';
  node.classList.remove('error', 'ok');
}

async function callJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { ok: res.ok, status: res.status, body };
}

function fmtValue(value) {
  if (value === null || value === undefined || value === '') return { text: '—', empty: true };
  if (typeof value === 'boolean') return { text: value ? 'Visible' : 'Hidden', empty: false };
  if (Array.isArray(value)) {
    if (value.length === 0) return { text: '—', empty: true };
    return { text: value.join(', '), empty: false };
  }
  if (typeof value === 'object') {
    if (value.url && 'is_customized' in value) return { text: value.url, empty: false };
    return { text: JSON.stringify(value), empty: false };
  }
  return { text: String(value), empty: false };
}

function renderDiff(node, oldObj, newObj, { showOld = true } = {}) {
  node.innerHTML = '';
  if (showOld) {
    const head = document.createElement('div');
    head.className = 'diff-head';
    head.innerHTML = '<div class="col">Field</div><div class="col">Current value</div><div class="col">Proposed value</div>';
    node.appendChild(head);
  }
  const newRecord = newObj || {};
  const oldRecord = oldObj || {};
  const seen = new Set();
  const order = FIELD_LABELS.map(([k]) => k).filter((k) => k in newRecord || k in oldRecord);
  for (const key of order) seen.add(key);
  for (const key of Object.keys(newRecord)) if (!seen.has(key)) order.push(key);

  for (const key of order) {
    const labelEntry = FIELD_LABELS.find((entry) => entry[0] === key);
    const label = labelEntry ? labelEntry[1] : key.replace(/_/g, ' ');
    const oldVal = fmtValue(oldRecord[key]);
    const newVal = fmtValue(newRecord[key]);
    const changed = showOld && oldVal.text !== newVal.text;

    const fieldEl = document.createElement('div');
    fieldEl.className = 'field';
    fieldEl.textContent = label;
    node.appendChild(fieldEl);

    if (showOld) {
      const oldEl = document.createElement('div');
      oldEl.className = `old${oldVal.empty ? ' empty' : ''}`;
      oldEl.textContent = oldVal.text;
      node.appendChild(oldEl);
    }
    const newEl = document.createElement('div');
    newEl.className = `new${newVal.empty ? ' empty' : ''}${changed ? ' changed' : ''}`;
    newEl.textContent = newVal.text;
    node.appendChild(newEl);
  }
}

// ---------------- Create section ----------------

createForm.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action="preview"]');
  if (!btn) return;
  event.preventDefault();
  hideOutput(createOutput);
  createPreviewBox.hidden = true;
  const data = formData(createForm);
  if (!data.sku || !data.title) {
    showOutput(createOutput, 'SKU and Title are required.', true);
    return;
  }
  logUiEvent('create.preview', `Operator clicked <kbd>Generate Preview</kbd> for SKU <code>${data.sku}</code>`);
  setBusyAll(true);
  try {
    const result = await callJson('/api/listing', {
      method: 'POST',
      body: JSON.stringify({ ...data, dryRun: true }),
    });
    if (!result.ok) {
      showOutput(createOutput, result.body, true);
      return;
    }
    const payload = { ...(result.body?.payload || {}) };
    if (result.body?.wholesale && Number.isFinite(Number(result.body.wholesale.price))) {
      payload.wholesale_price = Number(result.body.wholesale.price);
    }
    state.create.payload = payload;
    state.create.optimization = result.body?.optimization || null;
    state.create.wholesale = result.body?.wholesale || null;
    renderDiff(createDiff, {}, payload, { showOld: false });
    createPreviewBox.hidden = false;
  } finally {
    setBusyAll(false);
  }
});

createPreviewBox.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  event.preventDefault();
  if (btn.dataset.action === 'discard') {
    state.create.payload = null;
    state.create.optimization = null;
    createPreviewBox.hidden = true;
    return;
  }
  if (btn.dataset.action !== 'confirm') return;
  if (!state.create.payload) return;
  setBusyAll(true);
  showOutput(createOutput, 'Publishing…');
  try {
    const data = formData(createForm);
    logUiEvent('create.confirm', `Operator clicked <kbd>Confirm &amp; Publish</kbd> for SKU <code>${data.sku}</code>`);
    const result = await callJson('/api/listing', {
      method: 'POST',
      body: JSON.stringify({ ...data, payload: state.create.payload, skipOptimize: true, dryRun: false }),
    });
    showOutput(createOutput, result.body, !result.ok);
    if (result.ok) {
      createPreviewBox.hidden = true;
      state.create.payload = null;
    }
  } finally {
    setBusyAll(false);
  }
});

// ---------------- Update section ----------------

function pickExisting(record) {
  if (!record) return {};
  const r = record;
  const customFields = Array.isArray(r.custom_fields) ? r.custom_fields : [];
  const fieldByName = (name) => {
    const match = customFields.find((f) => String(f?.name || '').toLowerCase() === name.toLowerCase());
    return match ? match.value : undefined;
  };
  return {
    name: r.name,
    sku: r.sku,
    price: r.price,
    sale_price: r.sale_price,
    condition: r.condition,
    is_visible: r.is_visible,
    categories: r.categories,
    brand_id: r.brand_id,
    upc: r.upc,
    mpn: r.mpn,
    weight: r.weight,
    width: r.width,
    height: r.height,
    depth: r.depth,
    meta_description: r.meta_description || fieldByName('meta_description'),
    search_keywords: r.search_keywords,
    description: r.description,
    custom_url: r.custom_url,
  };
}

lookupForm.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action="query"]');
  if (!btn) return;
  event.preventDefault();
  hideOutput(lookupOutput);
  updatePreviewBox.hidden = true;
  updateShell.hidden = true;
  const sku = (formData(lookupForm).sku || '').trim();
  if (!sku) return;
  logUiEvent('update.query', `Operator queried SKU <code>${sku}</code>`);
  setBusyAll(true);
  try {
    const result = await callJson(`/api/product/${encodeURIComponent(sku)}`);
    if (!result.ok) {
      showOutput(lookupOutput, result.body, true);
      return;
    }
    const product = (result.body?.products || [])[0];
    state.update.sku = sku;
    state.update.existing = pickExisting(product);
    state.update.payload = null;
    state.update.optimization = null;

    updateForm.elements.sku.value = sku;
    updateForm.elements.title.value = '';
    updateForm.elements.upc.value = '';
    updateForm.elements.price.value = '';
    updateForm.elements.context.value = '';

    updateShell.hidden = false;
    if (!product) {
      showOutput(lookupOutput, `No channel product found for SKU ${sku}. The agent will create it on confirm.`);
    } else {
      showOutput(lookupOutput, `Loaded channel product #${product.id || ''} — ${product.name || sku}`);
    }
  } finally {
    setBusyAll(false);
  }
});

updateForm.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action="preview"]');
  if (!btn) return;
  event.preventDefault();
  if (!state.update.sku) return;
  hideOutput(lookupOutput);
  updatePreviewBox.hidden = true;
  logUiEvent('update.preview', `Operator clicked <kbd>Generate Preview</kbd> for <code>${state.update.sku}</code>`);
  setBusyAll(true);
  try {
    const data = formData(updateForm);
    const result = await callJson(`/api/product/${encodeURIComponent(state.update.sku)}/update`, {
      method: 'POST',
      body: JSON.stringify({ ...data, dryRun: true }),
    });
    if (!result.ok) {
      showOutput(lookupOutput, result.body, true);
      return;
    }
    const payload = { ...(result.body?.payload || {}) };
    if (result.body?.wholesale && Number.isFinite(Number(result.body.wholesale.price))) {
      payload.wholesale_price = Number(result.body.wholesale.price);
    }
    state.update.payload = payload;
    state.update.optimization = result.body?.optimization || null;
    state.update.wholesale = result.body?.wholesale || null;
    renderDiff(updateDiff, state.update.existing || {}, payload, { showOld: true });
    updatePreviewBox.hidden = false;
  } finally {
    setBusyAll(false);
  }
});

updatePreviewBox.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  event.preventDefault();
  if (btn.dataset.action === 'discard') {
    state.update.payload = null;
    state.update.optimization = null;
    updatePreviewBox.hidden = true;
    return;
  }
  if (btn.dataset.action !== 'confirm') return;
  if (!state.update.payload || !state.update.sku) return;
  setBusyAll(true);
  showOutput(lookupOutput, 'Publishing…');
  try {
    const data = formData(updateForm);
    logUiEvent('update.confirm', `Operator clicked <kbd>Confirm &amp; Publish</kbd> for <code>${state.update.sku}</code>`);
    const result = await callJson(`/api/product/${encodeURIComponent(state.update.sku)}/update`, {
      method: 'POST',
      body: JSON.stringify({ ...data, payload: state.update.payload, skipOptimize: true, dryRun: false }),
    });
    showOutput(lookupOutput, result.body, !result.ok);
    if (result.ok) {
      updatePreviewBox.hidden = true;
      state.update.payload = null;
    }
  } finally {
    setBusyAll(false);
  }
});

// ---------------- Health ----------------

(async function checkHealth() {
  try {
    const result = await callJson('/api/health');
    healthStatus.dataset.state = result.ok ? 'ok' : 'bad';
    healthStatus.textContent = result.ok ? `port ${result.body.port}` : 'health check failed';
  } catch (err) {
    healthStatus.dataset.state = 'bad';
    healthStatus.textContent = String(err?.message || err);
  }
})();

// ---------------- Live agent activity ----------------

const fmtTime = (t) => new Date(t).toLocaleTimeString(undefined, { hour12: false });

function operationLabel(operation) {
  const map = {
    optimize_product_listing: 'Optimize listing',
    build_product_payload: 'Build payload',
    search_products: 'Search BigCommerce',
    create_product: 'Create product',
    update_product: 'Update product',
    publish_product_listing: 'Publish flow',
    list_price_lists: 'List price lists',
    get_wholesale_price: 'Read wholesale price',
    set_wholesale_price: 'Write wholesale price',
  };
  return map[operation] || operation;
}

function summarizeStart(event) {
  const input = event.input || {};
  const product = input.product || {};
  const sku = product.sku || product.stock_number || input.sku;
  const op = event.operation;
  const bits = [];
  if (sku) bits.push(`SKU <code>${sku}</code>`);
  if (op === 'publish_product_listing') {
    bits.push(input.dry_run === false ? 'live publish' : 'dry run');
    if (input.skip_optimize) bits.push('skip optimize');
    if (input.wholesale_price != null && input.wholesale_price !== '') bits.push(`wholesale $${Number(input.wholesale_price).toFixed(2)}`);
  } else if (op === 'set_wholesale_price') {
    bits.push(`$${Number(input.wholesale_price).toFixed(2)} on list ${input.price_list_id || 2}`);
  }
  return bits.length ? bits.join(' · ') : 'Calling agent…';
}

function summarizeDone(event) {
  const out = event.output || {};
  const op = event.operation;
  const bits = [];
  if (op === 'publish_product_listing') {
    if (out.dry_run) bits.push('preview ready');
    else if (out.mode) bits.push(`${out.mode} #${out.external_product_id || '?'}`);
    if (out.optimization?.title) bits.push(`title: ${truncate(out.optimization.title, 80)}`);
    if (Array.isArray(out.payload?.categories)) bits.push(`${out.payload.categories.length} categories`);
    if (out.payload?.brand_id) bits.push(`brand id ${out.payload.brand_id}`);
    if (out.wholesale && out.wholesale.price != null) {
      bits.push(`wholesale $${Number(out.wholesale.price).toFixed(2)}${out.wholesale.ok === false ? ' (failed)' : ''}`);
    }
  } else if (op === 'search_products') {
    const products = out.products || [];
    bits.push(`${products.length} match${products.length === 1 ? '' : 'es'}`);
    if (products[0]?.id) bits.push(`#${products[0].id}`);
  } else if (op === 'list_price_lists') {
    bits.push(`${(out.price_lists || []).length} lists`);
  } else if (op === 'get_wholesale_price') {
    if (out.found) bits.push(`$${out.record?.price ?? '?'}`);
    else bits.push('no record');
  } else if (op === 'set_wholesale_price') {
    bits.push(`list ${out.price_list_id} variant ${out.variant_id}`);
  } else if (op === 'create_product' || op === 'update_product') {
    bits.push(`#${out.external_product_id || '?'}`);
  }
  if (event.duration_ms != null) bits.push(`${(event.duration_ms / 1000).toFixed(2)}s`);
  return bits.length ? bits.join(' · ') : 'done';
}

function truncate(value, max = 80) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderEventCard(event, kind, summary, body) {
  const card = document.createElement('div');
  card.className = `activity-card kind-${kind}`;
  const head = document.createElement('div');
  head.className = 'head';
  const opEl = document.createElement('span');
  opEl.className = 'op';
  opEl.textContent = operationLabel(event.operation || event.type);
  const timeEl = document.createElement('span');
  timeEl.className = 'time';
  timeEl.textContent = fmtTime(event.t || Date.now());
  head.append(opEl, timeEl);
  card.appendChild(head);
  const summaryEl = document.createElement('div');
  summaryEl.className = 'summary';
  summaryEl.innerHTML = summary;
  card.appendChild(summaryEl);
  if (body) {
    const details = document.createElement('details');
    const summaryToggle = document.createElement('summary');
    summaryToggle.textContent = 'Show payload';
    const pre = document.createElement('pre');
    pre.textContent = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    details.append(summaryToggle, pre);
    card.appendChild(details);
  }
  // Newest at top.
  const empty = activityFeed.querySelector('.activity-empty');
  if (empty) empty.remove();
  activityFeed.prepend(card);
  while (activityFeed.children.length > 60) activityFeed.lastChild.remove();
}

function logUiEvent(operation, summary, body) {
  renderEventCard({ operation: `ui:${operation}`, t: Date.now() }, 'ui', summary, body);
}

function setEventStatus(state, text) {
  eventStatus.dataset.state = state;
  eventStatus.textContent = text;
}

eventClear.addEventListener('click', () => {
  activityFeed.innerHTML = '<div class="activity-empty">Cleared.</div>';
});

let eventSource;
function connectEvents() {
  if (eventSource) eventSource.close();
  setEventStatus('', 'connecting…');
  eventSource = new EventSource('/api/events');
  eventSource.addEventListener('open', () => setEventStatus('ok', 'live'));
  eventSource.addEventListener('error', () => setEventStatus('bad', 'reconnecting…'));
  eventSource.addEventListener('message', (msg) => {
    let data;
    try { data = JSON.parse(msg.data); } catch { return; }
    if (data.type === 'agent_call_start') {
      renderEventCard(data, 'start', `→ ${summarizeStart(data)}`, data.input);
    } else if (data.type === 'agent_retry') {
      renderEventCard(
        data,
        'retry',
        `↻ retry ${data.attempt} <code>${data.message ? truncate(data.message, 60) : data.status || ''}</code>`,
        data,
      );
    } else if (data.type === 'agent_call_done') {
      renderEventCard(data, 'done', `✓ ${summarizeDone(data)}`, data.output);
    } else if (data.type === 'agent_call_error') {
      renderEventCard(data, 'error', `✗ ${truncate(data.message || 'failed', 200)}`, data.body || data);
    }
  });
}
connectEvents();
