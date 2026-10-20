// make-fixtures.cjs — generates the small fictional PDFs used by __demo and smoke.spec.js.
// Run once with: node tests/make-fixtures.cjs  (uses only the vendored pdf-lib)
const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('../vendor/pdf-lib/pdf-lib.min.js');

const out = (name) => path.join(__dirname, 'fixtures', name);

const DAYS = [
  ['Day 1', 'Arrival, check in at the fictional Hotel Azulejo Example', 'Evening walk along the river'],
  ['Day 2', 'Tram ride to the old town', 'Lunch at a made-up seafood place'],
  ['Day 3', 'Day trip to the hills by train', 'Picnic in the palace gardens'],
  ['Day 4', 'Tile museum in the morning', 'Sunset at the viewpoint'],
  ['Day 5', 'Beach afternoon on the coast', 'Pastry tasting tour'],
  ['Day 6', 'Last-minute souvenirs', 'Taxi to the airport at 16:00'],
];

async function itinerary() {
  const doc = await PDFDocument.create();
  doc.setTitle('Trip Itinerary Lisbon (fictional sample)');
  doc.setAuthor('Sample Traveller');
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  DAYS.forEach(([day, a, b], i) => {
    const n = i + 1;
    const page = doc.addPage([595, 842]);
    page.drawRectangle({ x: 0, y: 762, width: 595, height: 80, color: rgb(0.36, 0.29, 0.86) });
    page.drawText('Trip Itinerary Lisbon', { x: 40, y: 792, size: 26, font: bold, color: rgb(1, 1, 1) });
    const big = String(n);
    page.drawText(big, { x: (595 - bold.widthOfTextAtSize(big, 320)) / 2, y: 330, size: 320, font: bold, color: rgb(0.13, 0.15, 0.2) });
    page.drawText(`Page ${n} of 6`, { x: 40, y: 270, size: 18, font: bold, color: rgb(0.13, 0.15, 0.2) });
    page.drawText(`${day}: ${a}`, { x: 40, y: 230, size: 14, font, color: rgb(0.24, 0.26, 0.31) });
    page.drawText(b, { x: 40, y: 206, size: 14, font, color: rgb(0.24, 0.26, 0.31) });
    page.drawText('Fictional sample document for testing only.', { x: 40, y: 50, size: 10, font, color: rgb(0.42, 0.44, 0.52) });
  });
  fs.writeFileSync(out('trip-itinerary-lisbon.pdf'), await doc.save());
}

// A tiny PDF whose trailer declares encryption, so the tool must refuse it cleanly.
function encrypted() {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>',
    '<< /Filter /Standard /V 1 /R 2 /O <' + '0'.repeat(64) + '> /U <' + '0'.repeat(64) + '> /P -4 >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { body += `${String(off).padStart(10, '0')} 00000 n \n`; });
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Encrypt 4 0 R /ID [<00112233445566778899AABBCCDDEEFF> <00112233445566778899AABBCCDDEEFF>] >>\nstartxref\n${xref}\n%%EOF\n`;
  fs.writeFileSync(out('encrypted-sample.pdf'), body);
}

itinerary().then(encrypted).then(() => console.log('fixtures written'));
