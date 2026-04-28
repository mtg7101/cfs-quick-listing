'use strict';

const $ = (sel, root = document) => root.querySelector(sel);

const createForm = $('#create-form');
const createOutput = $('#create-output');
const lookupForm = $('#lookup-form');
const updateForm = $('#update-form');
const lookupOutput = $('#lookup-output');
const healthStatus = $('#health-status');

function formData(form) {
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    data[el.name] = el.type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value;
  }
  return data;
}

function showOutput(node, payload, isError = false) {
  node.hidden = false;
  node.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  node.classList.toggle('error', isError);
  node.classList.toggle('ok', !isError);
}

function setBusy(form, busy) {
  for (const btn of form.querySelectorAll('button')) {
    btn.disabled = busy;
  }
}

async function callJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  return { ok: res.ok, status: res.status, body };
}

async function submitListing(form, output, dryRun, url = '/api/listing', extra = {}) {
  setBusy(form, true);
  showOutput(output, dryRun ? 'Generating preview…' : 'Publishing…');
  try {
    const payload = { ...formData(form), ...extra, dryRun };
    const result = await callJson(url, { method: 'POST', body: JSON.stringify(payload) });
    showOutput(output, result.body, !result.ok);
    return result;
  } catch (err) {
    showOutput(output, String(err?.message || err), true);
  } finally {
    setBusy(form, false);
  }
}

createForm.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  event.preventDefault();
  if (btn.dataset.action === 'generate') void submitListing(createForm, createOutput, true);
  if (btn.dataset.action === 'publish') void submitListing(createForm, createOutput, false);
});

lookupForm.addEventListener('click', async (event) => {
  const btn = event.target.closest('button[data-action="query"]');
  if (!btn) return;
  event.preventDefault();
  const sku = formData(lookupForm).sku?.trim();
  if (!sku) return;
  setBusy(lookupForm, true);
  showOutput(lookupOutput, 'Querying…');
  try {
    const result = await callJson(`/api/product/${encodeURIComponent(sku)}`);
    showOutput(lookupOutput, result.body, !result.ok);
    if (result.ok) {
      const product = (result.body?.products || [])[0] || {};
      updateForm.hidden = false;
      updateForm.elements.title.value = product.name || '';
      updateForm.elements.sku.value = sku;
      updateForm.elements.upc.value = product.upc || '';
      updateForm.elements.price.value = product.price ?? '';
      updateForm.elements.context.value = '';
    } else {
      updateForm.hidden = true;
    }
  } finally {
    setBusy(lookupForm, false);
  }
});

updateForm.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  event.preventDefault();
  const sku = formData(updateForm).sku?.trim();
  if (!sku) return;
  const dryRun = btn.dataset.action === 'generate';
  void submitListing(
    updateForm,
    lookupOutput,
    dryRun,
    `/api/product/${encodeURIComponent(sku)}/update`,
  );
});

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
