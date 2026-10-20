# Split PDF by Pages — specification

**Tagline:** Split a PDF into single pages or custom ranges in your browser and save them as a ZIP, nothing uploaded.

**Category:** PDF

**Free alternative to:** Smallpdf Split PDF (free use limited to a couple of tasks per day, uploads files, account wall for more)

**Search phrases:** split pdf, split pdf into pages, extract pages from pdf, separate pdf pages, split pdf by page range, pdf splitter free

**Allowed libraries:** pdf-lib, jszip

**Published at:** https://turhe123.github.io/split-pdf-pages-local/

## Acceptance checks (each must have a test)

- loading the bundled 6 page sample shows 6 pages
- choosing every page produces a ZIP containing 6 PDFs of one page each
- entering ranges 1-2, 3-6 produces two PDFs with 2 and 4 pages
- an invalid range such as 9-12 shows an inline error
- layout works at 390px wide

## Spec

People type split pdf, extract pages from pdf and separate pdf pages constantly. Smallpdf and iLovePDF handle this by uploading the file, limit free runs per day and ask for sign up or payment to go further. Many documents split this way are bank statements or scans, so privacy matters.

Our version has one job: cut one PDF into several PDFs. Three modes in a segmented control: every page as its own file, custom ranges where each comma separated group becomes one file, and fixed size chunks of N pages. Extracting a single set of pages into one file is covered by the ranges mode with a Merge ranges into one file checkbox.

UI: a drop zone at the top accepts one PDF. After loading, show the file name, size and page count, then the mode selector and its input: a text field for ranges with placeholder 1-3, 4, 5-8, or a number field for chunk size defaulting to 1. A live preview list shows the output files to be created with their page ranges and names, such as report_part1_p1-3.pdf. A Split button runs it. The result lists files with individual download buttons and a Download all as ZIP button if only one file results, download it directly. Errors appear under the input: out of range, reversed range, empty. Keyboard: Enter in the ranges field triggers the preview update, Enter on Split starts it.

Technical approach: load with pdf-lib, for each output group create a new PDFDocument, copyPages with zero based indexes, save to bytes. Collect results in a Map, then build the ZIP with jszip using STORE compression since PDFs are already compressed, and create a Blob for download. Parse ranges with a small tolerant parser that accepts spaces, en dashes, and trailing commas, and also the word end. Yield to the event loop between files to keep the interface responsive and show a progress bar. Memory: keep original bytes once, release outputs after download is created when possible, warn above 200 MB.

Edge cases: encrypted PDFs report an unsupported error, overlapping ranges are allowed and produce duplicated pages, pages in a range listed backwards such as 5-3 can optionally be treated as reversed order but we choose to flag them. Output names derive from the source name with unicode preserved and illegal characters replaced. On mobile Safari large ZIP creation may be slow, so show a spinner and suggest fewer files. Downloads must be started from a user tap.

Demo data: a bundled fictional six page PDF called Trip Itinerary Lisbon with a large page number on each page so a test can verify the order of outputs.
