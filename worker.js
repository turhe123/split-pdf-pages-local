// worker.js — PDF splitting off the main thread (classic worker, vendored libraries only).
// Messages in:  { type: 'load', id, bytes }              -> { type: 'loaded', id, pageCount }
//               { type: 'split', id, groups, zip }        -> { type: 'progress', ... } then { type: 'done', id, files, zip }
// The original bytes are kept here once and reused for every split.
importScripts('vendor/pdf-lib/pdf-lib.min.js', 'vendor/jszip/jszip.min.js');

let source = null; // loaded PDFDocument

const tick = () => new Promise((r) => setTimeout(r, 0));

function describe(err) {
  const msg = String((err && err.message) || err || '');
  if (/encrypt/i.test(msg)) return { code: 'encrypted', message: 'This PDF is password protected or encrypted, which is not supported. Remove the protection in your PDF reader first, then try again.' };
  return { code: 'invalid', message: 'This file could not be read as a PDF. It may be damaged or not a real PDF.' };
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      source = null;
      source = await PDFLib.PDFDocument.load(msg.bytes, { updateMetadata: false });
      self.postMessage({ type: 'loaded', id: msg.id, pageCount: source.getPageCount() });
      return;
    }
    if (msg.type === 'split') {
      if (!source) throw new Error('No PDF loaded');
      const { groups } = msg;
      const total = groups.length;
      const files = [];
      for (let i = 0; i < total; i++) {
        const g = groups[i];
        const out = await PDFLib.PDFDocument.create();
        const pages = await out.copyPages(source, g.pages.map((p) => p - 1));
        pages.forEach((p) => out.addPage(p));
        const bytes = await out.save();
        files.push({ name: g.name, pages: g.pages.length, bytes });
        self.postMessage({ type: 'progress', id: msg.id, phase: 'split', done: i + 1, total });
        await tick(); // let progress messages flush
      }
      let zip = null;
      if (msg.zip && files.length > 1) {
        self.postMessage({ type: 'progress', id: msg.id, phase: 'zip', done: 0, total: 100 });
        const z = new JSZip();
        files.forEach((f) => z.file(f.name, f.bytes, { binary: true }));
        zip = await z.generateAsync({ type: 'uint8array', compression: 'STORE' }, (meta) => {
          self.postMessage({ type: 'progress', id: msg.id, phase: 'zip', done: meta.percent, total: 100 });
        });
      }
      const transfer = files.map((f) => f.bytes.buffer);
      if (zip) transfer.push(zip.buffer);
      self.postMessage({ type: 'done', id: msg.id, files, zip }, transfer);
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: msg.id, ...describe(err) });
  }
};
