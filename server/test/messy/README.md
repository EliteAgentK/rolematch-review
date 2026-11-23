# Messy-CV parser evaluation

368 fictional CVs (no real people) in 33 layouts, as PDF (rendered by headless Chrome) and Word, each with an answer key.
`npm run eval:parser` rebuilds missing files, scores the parser field by field and lists every imperfect CV.
`npm test` includes `messy.test.ts`, which fails if accuracy drops or any new CV fails.

## Method
- Round 1 (144 CVs): sidebars, wrapped date columns, skill bars, letter-spaced headings, running headers/footers, Afrikaans, personal-details blocks, narrative prose, key/value lists...
- Round 2 (96): bullets without full stops, one company over several titles, row-interleaved two-column tables, ALL CAPS, no headings, numbered headings, Portuguese, tab-aligned columns, skills tables...
- Round 3 (64): written **before** touching the parser again: date-first lines, company-first lines, undated experience, skill levels, referees' details, two-digit years...
- Round 4 (64): different people: chef, plumber, paralegal, pharmacist, cashier, electrician, physiotherapist, journalist.

Each fresh round was measured first, then fixed. Scores on the first look at an unseen round:
round 2: 48% perfect, round 3: 50%, round 4: 45%. After fixes all rounds are 98-100%.
Those first-look numbers are the honest estimate of how well the parser will do on layouts it has not seen: expect roughly half of unfamiliar CVs to need a fix or a human check until it has seen real ones.

## What the fixes were
Text tidying (icons, letter-spacing, wrapped dates, running headers/footers); heading dictionaries incl. Afrikaans and Portuguese and numbered/colon/inline headings; position-aware PDF reading with column separators and two-column unweaving; date forms (Mar'21, 03.2021, 03/21, Afrikaans/Portuguese months, "till date"); role layouts (title/company above or below, dates first, run-in, narrative, undated, career progression); South African ID numbers are never phones; the candidate's own e-mail is preferred over referees'; skill levels and rating glyphs are stripped; wrapped lists and names are rejoined; a broad occupation vocabulary.

## Known limits (see `KNOWN_LIMITS` in `messy.test.ts`)
Names wrapped inside narrow table cells; scanned or image-only PDFs (no OCR yet: they are refused, never guessed); languages other than English, Afrikaans and Portuguese; heavily graphical CVs where text order is scrambled; CVs in other scripts.

## What this does NOT prove
Everything here is synthetic and was written by the same author as the parser. Real CVs will contain habits that were not imagined. The next real step is 30-50 real, consented CVs.
