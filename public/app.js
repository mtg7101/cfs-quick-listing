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
const batchSection = $('#batch');
const batchInput = $('#batch-input');
const batchMode = $('#batch-mode');
const batchGrid = $('#batch-grid');
const batchSummary = $('#batch-summary');

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
const truncate = (value, max = 100) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};
const escapeHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const OPERATION_PROFILES = {
  publish_product_listing: { icon: '🛒', label: 'Listing flow' },
  optimize_product_listing: { icon: '✍️', label: 'Writing the description' },
  build_product_payload:    { icon: '📦', label: 'Preparing the payload' },
  search_products:          { icon: '🔎', label: 'Searching BigCommerce' },
  create_product:           { icon: '🆕', label: 'Adding new product' },
  update_product:           { icon: '🔄', label: 'Saving product changes' },
  list_price_lists:         { icon: '📋', label: 'Loading price lists' },
  get_wholesale_price:      { icon: '💰', label: 'Reading wholesale price' },
  set_wholesale_price:      { icon: '🏷️', label: 'Saving wholesale price' },
  'ui:create.preview':      { icon: '👤', label: 'You · Generate Preview (new product)' },
  'ui:create.confirm':      { icon: '👤', label: 'You · Confirm publish (new product)' },
  'ui:update.query':        { icon: '👤', label: 'You · Look up SKU' },
  'ui:update.preview':      { icon: '👤', label: 'You · Generate Preview (changes)' },
  'ui:update.confirm':      { icon: '👤', label: 'You · Confirm publish (changes)' },
};
function profile(op) { return OPERATION_PROFILES[op] || { icon: '⚙️', label: op || 'Activity' }; }

const KIND_BADGES = {
  start: { label: 'Working' },
  retry: { label: 'Retrying' },
  done:  { label: 'Done' },
  error: { label: 'Failed' },
  ui:    { label: 'You' },
};

function chip(label, value, tone = '') {
  if (value === undefined || value === null || value === '') return '';
  const cls = tone ? ` ${tone}` : '';
  return `<span class="chip${cls}">${escapeHtml(label)} <strong>${escapeHtml(value)}</strong></span>`;
}

function fmtMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : null;
}

function describeStart(event) {
  const input = event.input || {};
  const product = input.product || {};
  const sku = product.sku || product.stock_number || input.sku;
  const op = event.operation;
  switch (op) {
    case 'publish_product_listing':
      if (input.dry_run === false) {
        return {
          lede: `Saving <code>${escapeHtml(sku || '')}</code> to BigCommerce${input.skip_optimize ? ' (using your reviewed payload)' : ' (with fresh AI optimization)'}.`,
          chips: [
            chip('Mode', 'Live publish', 'pos'),
            input.skip_optimize ? chip('AI', 'skipped') : chip('AI', 'optimizing'),
            input.wholesale_price ? chip('Wholesale', fmtMoney(input.wholesale_price)) : '',
          ].filter(Boolean).join(''),
        };
      }
      return {
        lede: `Building a preview for <code>${escapeHtml(sku || '')}</code>. The agent will optimize copy, look up the channel, and merge changes — nothing is saved yet.`,
        chips: [
          chip('Mode', 'Preview only'),
          input.skip_optimize ? chip('AI', 'skipped') : chip('AI', 'optimizing'),
          input.instructions ? chip('You said', truncate(input.instructions, 50)) : '',
        ].filter(Boolean).join(''),
      };
    case 'optimize_product_listing':
      return { lede: `Asking Gemini to write the title, description, SEO copy, and tags${sku ? ` for <code>${escapeHtml(sku)}</code>` : ''}.`, chips: '' };
    case 'build_product_payload':
      return { lede: 'Composing the BigCommerce payload from the AI output and your existing data.', chips: '' };
    case 'search_products':
      return { lede: `Looking up SKU <code>${escapeHtml(input.sku || sku || '')}</code> on BigCommerce…`, chips: '' };
    case 'list_price_lists':
      return { lede: 'Fetching every price list the store has configured.', chips: '' };
    case 'get_wholesale_price':
      return { lede: `Reading the current wholesale price for <code>${escapeHtml(input.sku || '')}</code>.`, chips: '' };
    case 'set_wholesale_price':
      return {
        lede: `Saving wholesale ${fmtMoney(input.wholesale_price)} for <code>${escapeHtml(input.sku || '')}</code>.`,
        chips: chip('Price list', `#${input.price_list_id || 2}`),
      };
    case 'create_product':
      return { lede: `Creating a brand-new product on BigCommerce${sku ? ` (<code>${escapeHtml(sku)}</code>)` : ''}.`, chips: '' };
    case 'update_product':
      return { lede: `Updating the existing BigCommerce product${sku ? ` for <code>${escapeHtml(sku)}</code>` : ''}.`, chips: '' };
    default:
      return { lede: 'Running an agent operation…', chips: '' };
  }
}

function describeDone(event) {
  const out = event.output || {};
  const op = event.operation;
  const elapsed = event.duration_ms != null ? `${(event.duration_ms / 1000).toFixed(1)}s` : null;

  const elapsedChip = elapsed ? chip('Took', elapsed) : '';

  switch (op) {
    case 'publish_product_listing': {
      const opt = out.optimization || {};
      if (out.dry_run) {
        const titleSnippet = opt.title ? truncate(opt.title, 70) : null;
        const lede = titleSnippet
          ? `Preview ready. Proposed title: <strong>${escapeHtml(titleSnippet)}</strong>`
          : 'Preview ready. Review the diff on the left before confirming.';
        const cats = Array.isArray(out.payload?.categories) ? out.payload.categories.length : null;
        return {
          lede,
          chips: [
            chip('Categories', cats != null ? cats : null),
            chip('Brand id', out.payload?.brand_id),
            out.wholesale ? chip('Wholesale', fmtMoney(out.wholesale.price)) : '',
            elapsedChip,
          ].filter(Boolean).join(''),
        };
      }
      const verb = out.mode === 'created' ? 'Created' : 'Updated';
      const id = out.external_product_id ? `BigCommerce #${out.external_product_id}` : '';
      return {
        lede: `${verb} on BigCommerce. ${id ? `Live at ${escapeHtml(id)}.` : ''}`,
        chips: [
          chip('Mode', out.mode || 'updated'),
          out.wholesale && out.wholesale.ok !== false ? chip('Wholesale', fmtMoney(out.wholesale.price), 'pos') : '',
          out.wholesale && out.wholesale.ok === false ? chip('Wholesale', 'failed', 'neg') : '',
          elapsedChip,
        ].filter(Boolean).join(''),
      };
    }
    case 'search_products': {
      const products = out.products || [];
      const first = products[0];
      if (!products.length) return { lede: 'No matching product on BigCommerce. Confirming will create a new one.', chips: elapsedChip };
      return {
        lede: `Found <strong>${escapeHtml(truncate(first.name || '', 80))}</strong> (BigCommerce #${first.id}).`,
        chips: [
          chip('Current price', fmtMoney(first.price)),
          chip('Categories', Array.isArray(first.categories) ? first.categories.length : null),
          elapsedChip,
        ].filter(Boolean).join(''),
      };
    }
    case 'optimize_product_listing':
      return {
        lede: out.title ? `New title proposed: <strong>${escapeHtml(truncate(out.title, 90))}</strong>` : 'AI returned an optimization.',
        chips: [
          out.condition ? chip('Condition', out.condition) : '',
          Array.isArray(out.categories) ? chip('Categories', out.categories.length) : '',
          out.brand_name ? chip('Brand', truncate(out.brand_name, 40)) : '',
          elapsedChip,
        ].filter(Boolean).join(''),
      };
    case 'build_product_payload':
      return {
        lede: 'Payload assembled and ready for BigCommerce.',
        chips: [
          out.payload?.sku ? chip('SKU', out.payload.sku) : '',
          Array.isArray(out.payload?.categories) ? chip('Categories', out.payload.categories.length) : '',
          elapsedChip,
        ].filter(Boolean).join(''),
      };
    case 'list_price_lists':
      return {
        lede: `Found <strong>${(out.price_lists || []).length}</strong> price lists. Wholesale list id: <strong>${out.wholesale_price_list_id ?? '—'}</strong>.`,
        chips: elapsedChip,
      };
    case 'get_wholesale_price':
      return {
        lede: out.found ? `Current wholesale: <strong>${fmtMoney(out.record?.price) ?? '—'}</strong>.` : 'No wholesale record exists for this SKU yet.',
        chips: [chip('Variant id', out.variant_id), elapsedChip].filter(Boolean).join(''),
      };
    case 'set_wholesale_price':
      return {
        lede: out.ok === false ? 'Wholesale save failed.' : 'Wholesale price saved.',
        chips: [
          chip('Price list', `#${out.price_list_id}`),
          chip('Variant id', out.variant_id),
          elapsedChip,
        ].filter(Boolean).join(''),
      };
    case 'create_product':
    case 'update_product':
      return {
        lede: `${op === 'create_product' ? 'Created' : 'Updated'} BigCommerce #${out.external_product_id || '?'}.`,
        chips: elapsedChip,
      };
    default:
      return { lede: 'Done.', chips: elapsedChip };
  }
}

function describeRetry(event) {
  const reason = event.status === 503 || /UNAVAILABLE/.test(event.message || '')
    ? 'BigCommerce-agent gateway was busy.'
    : 'Transient hiccup.';
  return {
    lede: `${reason} Retrying automatically (attempt ${event.attempt + 1}).`,
    chips: chip('Status', event.status || '—'),
  };
}

function describeError(event) {
  return {
    lede: `Couldn't complete this step. ${truncate(event.message || 'Unknown error', 240)}`,
    chips: chip('Status', event.status || '—', 'neg'),
  };
}

function renderEventCard(event, kind, parts, body) {
  const { icon, label } = profile(event.operation || event.type);
  const badge = KIND_BADGES[kind] || { label: kind };
  const card = document.createElement('div');
  card.className = `activity-card kind-${kind}`;
  card.innerHTML = `
    <div class="icon">${icon}</div>
    <div class="body">
      <div class="top">
        <span class="title">${escapeHtml(label)}</span>
        <span class="badge">${escapeHtml(badge.label)}</span>
      </div>
      <div class="meta">
        <time>${escapeHtml(fmtTime(event.t || Date.now()))}</time>
        ${event.duration_ms != null ? `<span class="dot"></span><span>${(event.duration_ms / 1000).toFixed(1)}s</span>` : ''}
        ${event.attempt ? `<span class="dot"></span><span>attempt ${event.attempt}</span>` : ''}
      </div>
      <div class="lede">${parts.lede || ''}</div>
      ${parts.chips ? `<div class="chips">${parts.chips}</div>` : ''}
    </div>
  `;
  if (body) {
    const details = document.createElement('details');
    const summaryToggle = document.createElement('summary');
    summaryToggle.textContent = 'Inspect raw payload';
    const pre = document.createElement('pre');
    pre.textContent = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
    details.append(summaryToggle, pre);
    card.querySelector('.body').appendChild(details);
  }
  const empty = activityFeed.querySelector('.activity-empty');
  if (empty) empty.remove();
  activityFeed.prepend(card);
  while (activityFeed.children.length > 60) activityFeed.lastChild.remove();
}

function logUiEvent(operation, lede, body) {
  renderEventCard({ operation: `ui:${operation}`, t: Date.now() }, 'ui', { lede, chips: '' }, body);
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

// ---------------- Bulk multi-agent batch ----------------

function parseBatchInput(text) {
  const products = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('|').map((p) => p.trim());
    const [title, sku, upc, price, wholesale, ...contextParts] = parts;
    if (!sku && !title) continue;
    products.push({
      title: title || sku || '',
      sku: sku || '',
      upc: upc || '',
      price: price ? Number(price) : null,
      wholesale_price: wholesale ? Number(wholesale) : null,
      context: contextParts.join(' | ').trim(),
    });
  }
  return products;
}

function ensureRow(idx, product) {
  let row = batchGrid.querySelector(`[data-row="${idx}"]`);
  if (!row) {
    row = document.createElement('div');
    row.className = 'batch-row';
    row.dataset.row = String(idx);
    row.dataset.status = 'pending';
    row.innerHTML = `
      <span class="row-index">${idx + 1}</span>
      <div class="row-body">
        <div class="row-title"></div>
        <div class="row-meta"></div>
      </div>
      <span class="pill">Pending</span>
    `;
    batchGrid.appendChild(row);
  }
  if (product) {
    row.querySelector('.row-title').textContent = product.title || product.sku || `Item ${idx + 1}`;
    row.querySelector('.row-meta').textContent = [product.sku, product.upc, product.price ? `$${product.price}` : null].filter(Boolean).join(' · ');
  }
  return row;
}

function setRowStatus(idx, status, meta) {
  const row = ensureRow(idx);
  row.dataset.status = status;
  const pill = row.querySelector('.pill');
  pill.className = `pill ${status === 'running' ? 'running' : status === 'done' ? 'done' : status === 'error' ? 'error' : ''}`;
  pill.textContent = status === 'running' ? 'Working' : status === 'done' ? 'Done' : status === 'error' ? 'Failed' : 'Pending';
  if (meta) row.querySelector('.row-meta').textContent = meta;
}

function applyProgressUpdate(progress) {
  if (!Array.isArray(progress)) return;
  for (const slot of progress) {
    if (typeof slot?.index !== 'number') continue;
    const row = ensureRow(slot.index);
    const status = slot.status || 'pending';
    row.dataset.status = status;
    const pill = row.querySelector('.pill');
    pill.className = `pill ${status === 'running' ? 'running' : status === 'done' ? 'done' : status === 'error' ? 'error' : ''}`;
    pill.textContent = status === 'running' ? 'Working' : status === 'done' ? 'Done' : status === 'error' ? 'Failed' : 'Pending';
    const metaBits = [];
    if (slot.sku) metaBits.push(slot.sku);
    if (slot.mode) metaBits.push(slot.mode);
    if (slot.external_product_id) metaBits.push(`#${slot.external_product_id}`);
    if (slot.error) metaBits.push(`error: ${truncate(slot.error, 80)}`);
    if (metaBits.length) row.querySelector('.row-meta').textContent = metaBits.join(' · ');
  }
}

function renderSummary(summary) {
  if (!summary) return;
  batchSummary.hidden = false;
  const completed = summary.completed || [];
  const ok = completed.filter((c) => c.ok).length;
  const failed = completed.length - ok;
  batchSummary.innerHTML = `
    <div class="row"><span>Run id</span><strong>${escapeHtml(summary.run_id || '—')}</strong></div>
    <div class="row"><span>Items</span><strong>${summary.count ?? completed.length}</strong></div>
    <div class="row"><span>Succeeded</span><strong>${ok}</strong></div>
    <div class="row"><span>Failed</span><strong>${failed}</strong></div>
    <div class="row"><span>Brand cache</span><strong>${Object.keys(summary.brand_cache || {}).length} entries</strong></div>
  `;
}

async function runBatch(dryRun) {
  const products = parseBatchInput(batchInput.value);
  if (!products.length) {
    batchMode.textContent = 'Add at least one row';
    batchMode.className = 'pill error';
    return;
  }
  batchGrid.hidden = false;
  batchGrid.innerHTML = '';
  batchSummary.hidden = true;
  batchSummary.innerHTML = '';
  products.forEach((p, i) => ensureRow(i, p));
  batchMode.className = 'pill running';
  batchMode.textContent = dryRun ? 'Previewing (multi-agent)' : 'Publishing (multi-agent)';

  setBusyAll(true);
  try {
    const res = await fetch('/api/listing/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ products, dryRun }),
    });
    if (!res.ok || !res.body) {
      batchMode.className = 'pill error';
      batchMode.textContent = `HTTP ${res.status}`;
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let summary;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let event;
        try { event = JSON.parse(payload); } catch { continue; }
        if (event.type === 'started') {
          batchMode.textContent = `${event.count} workers spinning up`;
          continue;
        }
        if (event.type === 'closed') {
          batchMode.className = 'pill done';
          batchMode.textContent = 'Done';
          continue;
        }
        if (event.type === 'error') {
          batchMode.className = 'pill error';
          batchMode.textContent = truncate(event.error || 'failed', 60);
          continue;
        }
        if (event.type === 'summary') {
          summary = event.summary;
          renderSummary(summary);
          if (summary?.progress) applyProgressUpdate(summary.progress);
          continue;
        }
        if (event.type === 'event') {
          const delta = event.state_delta || {};
          if (Array.isArray(delta.progress)) applyProgressUpdate(delta.progress);
          if (event.message) {
            // Surface the agent's own narration as a UI log line.
            renderEventCard(
              { operation: `agent:${event.author || 'batch'}`, t: Date.now() },
              'start',
              { lede: escapeHtml(event.message), chips: '' },
            );
          }
        }
      }
    }
    if (!summary) {
      batchMode.className = 'pill done';
      batchMode.textContent = 'Stream ended';
    }
  } catch (err) {
    batchMode.className = 'pill error';
    batchMode.textContent = String(err?.message || err);
  } finally {
    setBusyAll(false);
  }
}

batchSection.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  event.preventDefault();
  if (btn.dataset.action === 'batch-preview') void runBatch(true);
  else if (btn.dataset.action === 'batch-publish') void runBatch(false);
});
