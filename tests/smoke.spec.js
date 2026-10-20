// smoke.spec.js — tool-specific checks for Split PDF by Pages, on the fictional fixtures in tests/fixtures/
// (regenerate them with `node tests/make-fixtures.cjs`). Output PDFs and ZIPs are opened with the vendored
// pdf-lib and jszip to check page counts and page order.
const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const PDFLib = require('../vendor/pdf-lib/pdf-lib.min.js');
const JSZip = require('../vendor/jszip/jszip.min.js');

const fixture = (name) => path.join(__dirname, 'fixtures', name);
const SAMPLE = fixture('trip-itinerary-lisbon.pdf');

// Returns the "Page N of 6" numbers printed on each page, in order (text is hex-encoded in the content stream).
async function pageNumbers(bytes) {
  const doc = await PDFLib.PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = doc.context.lookup(page.node.get(PDFLib.PDFName.of('Contents')));
    const streams = (contents instanceof PDFLib.PDFArray ? contents.asArray() : [contents]).map((r) => doc.context.lookup(r));
    const text = streams.map((st) => {
      const raw = Buffer.from(st.getContents());
      try { return zlib.inflateSync(raw).toString('latin1'); } catch { return raw.toString('latin1'); }
    }).join('\n');
    for (let n = 1; n <= 6; n++) {
      if (text.includes(`<${Buffer.from(`Page ${n} of 6`).toString('hex').toUpperCase()}>`)) return n;
    }
    return null;
  });
}

async function load(page) {
  await page.goto('./');
  await page.setInputFiles('#file-input', SAMPLE);
  await expect(page.locator('#page-count')).toHaveText('6 pages');
}

async function saveDownload(page, click) {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  const bytes = fs.readFileSync(await download.path());
  return { name: download.suggestedFilename(), bytes };
}

test.describe('Split PDF by Pages', () => {
  test('loading the bundled 6 page sample shows 6 pages', async ({ page }) => {
    await load(page);
    await expect(page.locator('#file-name')).toHaveText('trip-itinerary-lisbon.pdf');
    await expect(page.locator('#options')).toBeVisible();
    // Default mode is every page: the preview lists 6 files with derived names.
    await expect(page.locator('#preview li')).toHaveCount(6);
    await expect(page.locator('#preview li').first()).toContainText('trip-itinerary-lisbon_part1_p1.pdf');
  });

  test('every page produces a ZIP containing 6 one-page PDFs in order', async ({ page }) => {
    await load(page);
    await page.click('#split');
    await expect(page.locator('#results .result')).toHaveCount(6);
    await expect(page.locator('#progress-text')).toContainText('Done: 6 files');
    const { name, bytes } = await saveDownload(page, () => page.click('#download-zip'));
    expect(name).toBe('trip-itinerary-lisbon_split.zip');
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    expect(names).toEqual([1, 2, 3, 4, 5, 6].map((n) => `trip-itinerary-lisbon_part${n}_p${n}.pdf`));
    for (const [i, n] of names.entries()) {
      const pdf = await zip.file(n).async('uint8array');
      expect(await pageNumbers(pdf)).toEqual([i + 1]);
    }
  });

  test('ranges 1-2, 3-6 produce two PDFs with 2 and 4 pages', async ({ page }) => {
    await load(page);
    await page.click('label[for="mode-ranges"]');
    await page.fill('#ranges', '1-2, 3-6');
    await page.press('#ranges', 'Enter');
    await expect(page.locator('#preview li')).toHaveCount(2);
    await expect(page.locator('#preview li').nth(1)).toContainText('trip-itinerary-lisbon_part2_p3-6.pdf');
    // Enter on the focused Split button starts it.
    await page.focus('#split');
    await page.keyboard.press('Enter');
    await expect(page.locator('#results .result')).toHaveCount(2);

    const first = await saveDownload(page, () => page.getByRole('button', { name: 'Download trip-itinerary-lisbon_part1_p1-2.pdf' }).click());
    expect(first.name).toBe('trip-itinerary-lisbon_part1_p1-2.pdf');
    expect(first.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await pageNumbers(first.bytes)).toEqual([1, 2]);

    const second = await saveDownload(page, () => page.getByRole('button', { name: 'Download trip-itinerary-lisbon_part2_p3-6.pdf' }).click());
    expect(await pageNumbers(second.bytes)).toEqual([3, 4, 5, 6]);

    const zip = await JSZip.loadAsync((await saveDownload(page, () => page.click('#download-zip'))).bytes);
    expect(Object.keys(zip.files)).toHaveLength(2);
  });

  test('an invalid range such as 9-12 shows an inline error', async ({ page }) => {
    await load(page);
    await page.click('label[for="mode-ranges"]');
    await page.fill('#ranges', '9-12');
    await page.press('#ranges', 'Enter');
    await expect(page.locator('#ranges-error')).toBeVisible();
    await expect(page.locator('#ranges-error')).toContainText('out of range');
    await expect(page.locator('#ranges')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#split')).toBeDisabled();

    await page.fill('#ranges', '5-3');
    await page.press('#ranges', 'Enter');
    await expect(page.locator('#ranges-error')).toContainText('reversed');

    await page.fill('#ranges', ' , ');
    await page.press('#ranges', 'Enter');
    await expect(page.locator('#ranges-error')).toContainText('at least one page');

    // Tolerant input: spaces, en dash, "end" and a trailing comma are fine.
    await page.fill('#ranges', '1 – 2, 4-end,');
    await page.press('#ranges', 'Enter');
    await expect(page.locator('#ranges-error')).toBeHidden();
    await expect(page.locator('#preview li')).toHaveCount(2);
    await expect(page.locator('#preview li').nth(1)).toContainText('p4-6.pdf');
    await expect(page.locator('#split')).toBeEnabled();
  });

  test('merge ranges into one file downloads a single PDF directly', async ({ page }) => {
    await load(page);
    await page.click('label[for="mode-ranges"]');
    await page.fill('#ranges', '5, 1-2, 2');
    await page.check('#merge');
    await expect(page.locator('#preview li')).toHaveCount(1);
    const out = await saveDownload(page, () => page.click('#split'));
    expect(out.name).toBe('trip-itinerary-lisbon_p5_1-2_2.pdf');
    expect(await pageNumbers(out.bytes)).toEqual([5, 1, 2, 2]);
    await expect(page.locator('#download-zip')).toHaveCount(0);
  });

  test('fixed chunks of 4 pages make files of 4 and 2 pages', async ({ page }) => {
    await load(page);
    await page.click('label[for="mode-chunk"]');
    await expect(page.locator('#chunk')).toHaveValue('1');
    await page.fill('#chunk', '4');
    await expect(page.locator('#preview li')).toHaveCount(2);
    await page.click('#split');
    await expect(page.locator('#results .result')).toHaveCount(2);
    await expect(page.locator('#results .result').nth(0)).toContainText('4 pages');
    await expect(page.locator('#results .result').nth(1)).toContainText('2 pages');
    await page.fill('#chunk', '9');
    await expect(page.locator('#chunk-error')).toContainText('out of range');
  });

  test('rejects non-PDF files and encrypted PDFs with a visible error', async ({ page }) => {
    await page.goto('./');
    await page.setInputFiles('#file-input', fixture('sample.png'));
    await expect(page.locator('#results .alert--error')).toContainText('not a PDF');
    await expect(page.locator('#options')).toBeHidden();

    await page.setInputFiles('#file-input', fixture('encrypted-sample.pdf'));
    await expect(page.locator('#results .alert--error')).toContainText('encrypted');
    await expect(page.locator('#options')).toBeHidden();
  });

  test('a dropped mix of files keeps the PDF and reports the rejected one', async ({ page }) => {
    await page.goto('./');
    const files = [
      { name: 'notes.png', mimeType: 'image/png', buffer: fs.readFileSync(fixture('sample.png')) },
      { name: 'trip-itinerary-lisbon.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(SAMPLE) },
    ];
    const dt = await page.evaluateHandle((list) => {
      const d = new DataTransfer();
      list.forEach((f) => d.items.add(new File([new Uint8Array(f.data)], f.name, { type: f.mimeType })));
      return d;
    }, files.map((f) => ({ name: f.name, mimeType: f.mimeType, data: [...f.buffer] })));
    await page.dispatchEvent('#dropzone', 'drop', { dataTransfer: dt });
    await expect(page.locator('#page-count')).toHaveText('6 pages');
    await expect(page.locator('#results .alert--error')).toContainText('notes.png');
  });

  test('layout works at 390px wide', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page);
    await page.click('label[for="mode-ranges"]');
    await page.fill('#ranges', '1-2, 3-6');
    await page.press('#ranges', 'Enter');
    await page.click('#split');
    await expect(page.locator('#results .result')).toHaveCount(2);
    const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
    expect(widths.doc).toBeLessThanOrEqual(widths.win);
    for (const sel of ['#mode-every + label', '#mode-chunk + label', '#ranges', '#split', '#download-zip']) {
      const box = await page.locator(sel).boundingBox();
      expect(box.x, sel).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, sel).toBeLessThanOrEqual(390);
    }
  });

  test('__demo shows a finished split of the sample', async ({ page }) => {
    await page.goto('./');
    await page.evaluate(() => window.__demo());
    await expect(page.locator('#page-count')).toHaveText('6 pages');
    await expect(page.locator('#results .result')).toHaveCount(3);
    await expect(page.locator('#download-zip')).toBeVisible();
  });
});
