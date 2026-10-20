// app.js — Split PDF by Pages (ES module). Everything runs on this device; the PDF work happens in worker.js.
import { toast, downloadBlob, formatBytes, wireDropzone } from './site.js';

const $ = (id) => document.getElementById(id);
const zone = $('dropzone');
const input = $('file-input');
const zoneTitle = $('dropzone-title');
const fileInfo = $('file-info');
const options = $('options');
const rangesField = $('ranges-field');
const chunkField = $('chunk-field');
const rangesInput = $('ranges');
const rangesError = $('ranges-error');
const mergeInput = $('merge');
const chunkInput = $('chunk');
const chunkError = $('chunk-error');
const previewTitle = $('preview-title');
const previewList = $('preview');
const splitBtn = $('split');
const progressWrap = $('progress');
const progressBar = $('progress-bar');
const progressText = $('progress-text');
const results = $('results');

const BIG_FILE = 200 * 1024 * 1024;
const MANY_FILES = 100;
const PREVIEW_LIMIT = 60;

const state = { file: null, pageCount: 0, base: 'document', groups: [], outputs: null, zip: null, jobId: 0 };

// ---------- Range parsing ----------

const DASH = /\s*[-‐-―−]\s*/;

function parsePage(token, pageCount) {
  const t = token.trim().toLowerCase();
  if (t === 'end' || t === 'last') return pageCount;
  if (!/^\d+$/.test(t)) return NaN;
  return Number(t);
}

/** Parses "1-3, 4, 5-end" into [{ from, to }] (1-based) or returns { errors }. */
export function parseRanges(text, pageCount) {
  const errors = [];
  const groups = [];
  const tokens = String(text).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (!tokens.length) return { groups, errors: ['Enter at least one page or range, for example 1-3, 4.'] };
  for (const tok of tokens) {
    const parts = tok.split(DASH);
    if (parts.length > 2) { errors.push(`"${tok}" is not a valid range.`); continue; }
    const from = parsePage(parts[0] || '1', pageCount);
    const to = parts.length === 2 ? parsePage(parts[1] || 'end', pageCount) : from;
    if (Number.isNaN(from) || Number.isNaN(to)) { errors.push(`"${tok}" is not a page number or range.`); continue; }
    if (from < 1 || to < 1 || from > pageCount || to > pageCount) {
      errors.push(`"${tok}" is out of range: this PDF has ${pageCount} page${pageCount === 1 ? '' : 's'}.`);
      continue;
    }
    if (from > to) { errors.push(`"${tok}" is reversed: write it as ${to}-${from}.`); continue; }
    groups.push({ from, to });
  }
  return { groups, errors };
}

// ---------- Naming ----------

export function safeBase(name) {
  const base = String(name).replace(/\.pdf$/i, '')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');
  return base.slice(0, 120) || 'document';
}

const span = (from, to) => (from === to ? `${from}` : `${from}-${to}`);
const pagesOf = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function mode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

/** Builds the list of output files for the current settings, or returns an error for the active input. */
function buildGroups() {
  const n = state.pageCount;
  const base = state.base;
  const m = mode();
  if (m === 'every') {
    return { groups: pagesOf(1, n).map((p) => ({ name: `${base}_part${p}_p${p}.pdf`, label: `Page ${p}`, pages: [p] })) };
  }
  if (m === 'chunk') {
    const raw = chunkInput.value.trim();
    const size = Number(raw);
    if (!raw) return { error: 'Enter how many pages each file should have.' };
    if (!Number.isInteger(size) || size < 1) return { error: 'Pages per file must be a whole number of 1 or more.' };
    if (size > n) return { error: `Pages per file is out of range: this PDF has ${n} page${n === 1 ? '' : 's'}.` };
    const groups = [];
    for (let from = 1, i = 1; from <= n; from += size, i++) {
      const to = Math.min(n, from + size - 1);
      groups.push({ name: `${base}_part${i}_p${span(from, to)}.pdf`, label: from === to ? `Page ${from}` : `Pages ${from}–${to}`, pages: pagesOf(from, to) });
    }
    return { groups };
  }
  const { groups: ranges, errors } = parseRanges(rangesInput.value, n);
  if (errors.length) return { error: errors.slice(0, 3).join(' ') + (errors.length > 3 ? ` (${errors.length - 3} more)` : '') };
  if (mergeInput.checked) {
    const label = ranges.map((r) => span(r.from, r.to)).join(', ');
    const tag = ranges.map((r) => span(r.from, r.to)).join('_');
    const name = `${base}_p${tag.length > 60 ? `${tag.slice(0, 60)}_etc` : tag}.pdf`;
    return { groups: [{ name, label: `Pages ${label}`, pages: ranges.flatMap((r) => pagesOf(r.from, r.to)) }] };
  }
  return {
    groups: ranges.map((r, i) => ({
      name: `${base}_part${i + 1}_p${span(r.from, r.to)}.pdf`,
      label: r.from === r.to ? `Page ${r.from}` : `Pages ${r.from}–${r.to}`,
      pages: pagesOf(r.from, r.to),
    })),
  };
}

// ---------- Preview ----------

function setFieldError(inputEl, errorEl, message) {
  errorEl.textContent = message || '';
  errorEl.hidden = !message;
  if (message) inputEl.setAttribute('aria-invalid', 'true');
  else inputEl.removeAttribute('aria-invalid');
}

function updatePreview() {
  if (!state.pageCount) return;
  const m = mode();
  rangesField.hidden = m !== 'ranges';
  chunkField.hidden = m !== 'chunk';
  const { groups, error } = buildGroups();
  setFieldError(rangesInput, rangesError, m === 'ranges' ? error : '');
  setFieldError(chunkInput, chunkError, m === 'chunk' ? error : '');
  state.groups = error ? [] : groups;
  previewList.replaceChildren();
  if (error) {
    previewTitle.textContent = 'Files to be created';
    splitBtn.disabled = true;
    return;
  }
  const count = groups.length;
  previewTitle.textContent = `Files to be created (${count})`;
  for (const g of groups.slice(0, PREVIEW_LIMIT)) {
    const li = document.createElement('li');
    li.className = 'split-preview__item';
    const name = document.createElement('span');
    name.className = 'split-preview__name';
    name.textContent = g.name;
    const info = document.createElement('span');
    info.className = 'split-preview__info';
    info.textContent = `${g.label} · ${g.pages.length} page${g.pages.length === 1 ? '' : 's'}`;
    li.append(name, info);
    previewList.appendChild(li);
  }
  if (count > PREVIEW_LIMIT) {
    const li = document.createElement('li');
    li.className = 'split-preview__more';
    li.textContent = `…and ${count - PREVIEW_LIMIT} more`;
    previewList.appendChild(li);
  }
  splitBtn.disabled = false;
  splitBtn.textContent = count === 1 ? 'Split and download 1 file' : `Split into ${count} files`;
}

let previewTimer = 0;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 150);
}

// ---------- Worker ----------

let worker = null;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker('./worker.js');
  worker.onmessage = (e) => {
    const msg = e.data;
    const job = pending.get(msg.id);
    if (!job) return;
    if (msg.type === 'progress') { job.onProgress?.(msg); return; }
    pending.delete(msg.id);
    if (msg.type === 'error') job.reject(Object.assign(new Error(msg.message), { code: msg.code }));
    else job.resolve(msg);
  };
  worker.onerror = (e) => {
    e.preventDefault();
    for (const job of pending.values()) job.reject(new Error('The PDF engine stopped unexpectedly. Reload the page and try again.'));
    pending.clear();
    worker = null;
  };
  return worker;
}

function run(message, transfer = [], onProgress) {
  const id = ++state.jobId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...message, id }, transfer);
  });
}

// ---------- UI helpers ----------

function showError(message) {
  const div = document.createElement('div');
  div.className = 'alert alert--error';
  div.setAttribute('role', 'alert');
  div.textContent = message;
  results.appendChild(div);
  div.scrollIntoView({ block: 'nearest' });
}

function showNote(message) {
  const div = document.createElement('div');
  div.className = 'alert split-note';
  div.textContent = message;
  results.appendChild(div);
}

function setProgress(fraction, text, busy = true) {
  progressWrap.hidden = false;
  progressWrap.classList.toggle('is-busy', busy);
  // Floor so the bar only reads 100% when everything is really done.
  const pct = Math.max(0, Math.min(100, Math.floor(fraction * 100)));
  progressBar.style.width = `${pct}%`;
  progressWrap.querySelector('.progress').setAttribute('aria-valuenow', String(pct));
  progressText.textContent = text.replace('{pct}', `${pct}%`);
}

function resetOutputs() {
  state.outputs = null;
  state.zip = null;
}

// ---------- Loading ----------

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

async function handleFiles(files) {
  results.replaceChildren();
  resetOutputs();
  const pdfs = files.filter(isPdf);
  const rejected = files.filter((f) => !isPdf(f));
  if (!pdfs.length) {
    showError(rejected.length === 1
      ? `"${rejected[0].name}" is not a PDF. Choose a .pdf file to split.`
      : `None of these files is a PDF (${rejected.map((f) => f.name).join(', ')}). Choose a .pdf file to split.`);
    return;
  }
  const file = pdfs[0];

  state.pageCount = 0;
  options.hidden = true;
  fileInfo.hidden = false;
  fileInfo.innerHTML = '<span class="spinner" aria-hidden="true"></span> <span>Reading PDF…</span>';
  try {
    const bytes = await file.arrayBuffer();
    const { pageCount } = await run({ type: 'load', bytes }, [bytes]);
    if (!pageCount) throw new Error('This PDF has no pages to split.');
    state.file = file;
    state.pageCount = pageCount;
    state.base = safeBase(file.name);
  } catch (err) {
    fileInfo.hidden = true;
    state.file = null;
    showError(err.code ? err.message : `Could not open ${file.name}: ${err.message}`);
    return;
  }

  renderFileInfo(file);
  zone.classList.add('dropzone--compact');
  zoneTitle.innerHTML = 'Drop another PDF or <span class="link">choose a file</span>';
  options.hidden = false;
  if (rejected.length) showError(`Skipped ${rejected.length === 1 ? 'a file that is' : `${rejected.length} files that are`} not a PDF: ${rejected.map((f) => f.name).join(', ')}.`);
  if (pdfs.length > 1) showNote(`Only one PDF can be split at a time, so ${file.name} was loaded and ${pdfs.length - 1} other PDF${pdfs.length > 2 ? 's were' : ' was'} ignored.`);
  if (file.size > BIG_FILE) showNote(`This PDF is ${formatBytes(file.size)}. Large files need a lot of memory; if the tab struggles, close other tabs or split into fewer files.`);
  progressWrap.hidden = true;
  updatePreview();
  toast(`${file.name} loaded, nothing was uploaded`);
}

function renderFileInfo(file) {
  fileInfo.replaceChildren();
  const name = document.createElement('span');
  name.className = 'file-info__name';
  name.id = 'file-name';
  name.textContent = file.name;
  const meta = document.createElement('span');
  meta.className = 'file-info__meta';
  const size = document.createElement('span');
  size.textContent = formatBytes(file.size);
  const pages = document.createElement('span');
  pages.id = 'page-count';
  pages.className = 'chip';
  pages.textContent = `${state.pageCount} page${state.pageCount === 1 ? '' : 's'}`;
  meta.append(size, pages);
  fileInfo.append(name, meta);
}

// ---------- Splitting ----------

async function split() {
  updatePreview();
  const groups = state.groups;
  if (!groups.length || !state.file) return;
  results.replaceChildren();
  resetOutputs();
  splitBtn.disabled = true;
  const total = groups.length;
  setProgress(0, `Creating file 0 of ${total} ({pct})`);
  if (total > MANY_FILES) showNote(`Creating ${total} files. On phones, building a large ZIP can be slow; larger chunks mean fewer files.`);
  try {
    const msg = await run({ type: 'split', groups: groups.map(({ name, pages }) => ({ name, pages })), zip: total > 1 }, [], (p) => {
      if (p.phase === 'split') setProgress((p.done / p.total) * 0.9, `Creating file ${p.done} of ${p.total} ({pct})`);
      else setProgress(0.9 + (p.done / 100) * 0.1, 'Building ZIP… ({pct})');
    });
    state.outputs = new Map(msg.files.map((f) => [f.name, { blob: new Blob([f.bytes], { type: 'application/pdf' }), pages: f.pages }]));
    state.zip = msg.zip ? new Blob([msg.zip], { type: 'application/zip' }) : null;
    setProgress(1, `Done: ${total} file${total === 1 ? '' : 's'} created on this device`, false);
    renderResults();
    if (total === 1 && !window.__demoRunning) {
      const [name, { blob }] = [...state.outputs][0];
      downloadBlob(blob, name);
    }
  } catch (err) {
    progressWrap.hidden = true;
    showError(`Splitting failed: ${err.message}`);
  } finally {
    splitBtn.disabled = !state.groups.length;
  }
}

function renderResults() {
  results.replaceChildren();
  const outputs = [...state.outputs];
  const head = document.createElement('div');
  head.className = 'split-results__head';
  const summary = document.createElement('p');
  summary.className = 'split-results__summary';
  const bytes = outputs.reduce((s, [, o]) => s + o.blob.size, 0);
  summary.textContent = `${outputs.length} PDF${outputs.length === 1 ? '' : 's'} ready · ${formatBytes(bytes)} total`;
  head.appendChild(summary);
  if (state.zip) {
    const zipBtn = document.createElement('button');
    zipBtn.type = 'button';
    zipBtn.id = 'download-zip';
    zipBtn.className = 'btn btn--primary';
    zipBtn.textContent = `Download all as ZIP (${formatBytes(state.zip.size)})`;
    zipBtn.addEventListener('click', () => downloadBlob(state.zip, `${state.base}_split.zip`));
    head.appendChild(zipBtn);
  }
  results.appendChild(head);

  const list = document.createElement('div');
  list.className = 'split-results__list';
  for (const [name, out] of outputs) {
    const row = document.createElement('div');
    row.className = 'result';
    const meta = document.createElement('div');
    meta.className = 'result__meta';
    const n = document.createElement('div');
    n.className = 'result__name';
    n.textContent = name;
    n.title = name;
    const info = document.createElement('div');
    info.className = 'result__info';
    info.textContent = `${out.pages} page${out.pages === 1 ? '' : 's'} · ${formatBytes(out.blob.size)}`;
    meta.append(n, info);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--small';
    btn.textContent = 'Download';
    btn.setAttribute('aria-label', `Download ${name}`);
    btn.addEventListener('click', () => downloadBlob(out.blob, name));
    row.append(meta, btn);
    list.appendChild(row);
  }
  results.appendChild(list);
  const first = list.querySelector('.result');
  if (first) first.scrollIntoView({ block: 'nearest' });
}

// ---------- Wiring ----------

wireDropzone(zone, input, handleFiles);
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', updatePreview));
rangesInput.addEventListener('input', schedulePreview);
rangesInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(previewTimer); updatePreview(); } });
chunkInput.addEventListener('input', schedulePreview);
chunkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(previewTimer); updatePreview(); } });
mergeInput.addEventListener('change', updatePreview);
splitBtn.addEventListener('click', split);

// Called by the factory's screenshot script: loads the fictional itinerary and shows a finished split.
window.__demo = async () => {
  const res = await fetch('./tests/fixtures/trip-itinerary-lisbon.pdf');
  const blob = await res.blob();
  await handleFiles([new File([blob], 'Trip Itinerary Lisbon.pdf', { type: 'application/pdf' })]);
  document.getElementById('mode-ranges').checked = true;
  rangesInput.value = '1-2, 3-4, 5-end';
  updatePreview();
  window.__demoRunning = true;
  try { await split(); } finally { window.__demoRunning = false; }
};

export { handleFiles };
