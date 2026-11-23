# RoleMatch architecture: where it can grow without a rewrite

This file is for the next person to touch the code (including future us). It says where the seams are, how to extend each one, and
what is **not** designed for growth yet. Where the code and this file disagree, the code wins; fix this file.

## The one rule

Each decision lives in exactly one place. Adding a capability means adding an entry to a registry or a setting, never editing the
places that use it. If you find yourself changing five files to add one format, one status or one limit, a seam is missing: add it.

## Seams (how to extend)

| Want to… | Touch | Everything else follows from |
|---|---|---|
| Accept a new file type | `server/src/formats.ts` (one entry: kind, label, content type, extensions, how to recognise it) and a reader branch in `server/src/parse.ts` (`readRaw`/`readPhoto`) | The upload check, stored content type, "View Original", the browser's file picker and its error text (the list is sent to the browser in `GET /api/settings` as `formats`) |
| Change or add an OCR engine | Implement `OcrEngine` in `server/src/ocr.ts` and register it in `OCR_ENGINES`; select with `OCR_ENGINE` | Image cleanup, PDF page rendering, column layout, confidence gates, e-mail repair. Run `npm run eval:ocr` to see if it is better |
| Change OCR languages | `OCR_LANGUAGES` (default `eng+afr`) | Language files ship in npm packages; nothing is downloaded |
| Change how page text is put in reading order | `server/src/layout.ts` (used by the PDF reader and by OCR alike) | Both digital and scanned CVs |
| Add something an organisation may want different (a status, a label, a limit, a review threshold) | `server/src/settings.ts` (schema + default) and the Settings page | Versioned, audited, admin-only. Never hard-code it |
| Add a background job type | `registerHandler` in `server/src/queue.ts` | Retries, bounded attempts, visibility |
| Add a database change | A new numbered file in `supabase/migrations/`, then its columns in `server/src/schema.ts` (`EXPECTED`) | The server refuses to start if the database and the code disagree |
| Add a rate limit | One entry in `defaults` in `server/src/ratelimit.ts`, then `consume("name", key)` at the call site | Memory limits are per process and approximate (up to 2x in a worst-case minute); shared limits are exact and live in Postgres |
| Change the scoring formula | You must not. It is fixed, versioned, identical for every organisation (`server/src/ruleset.ts`), and walled off from settings by a test | |

## Reading a document (the path every upload takes)

```
upload (rate limited, size checked, real type sniffed)  ->  stored privately as received  ->  queue
  -> pipeline: type check -> (PDF/Word only) shrink if large -> read
       PDF with a text layer: positions -> reading order (layout.ts) -> text
       Word, .doc, .rtf, .odt, .txt: reader -> text
       scan, photo: image cleanup (imageprep.ts) -> OCR engine -> words with positions -> reading order (layout.ts) -> text
  -> quality gate (OCR below 50% average confidence is refused with a reason; weaker reads are flagged for review)
  -> extraction (rules, or AI when configured) -> evidence check -> review flags -> published
```

The original file is kept exactly as uploaded (PDF and Word files above the size threshold may be replaced by a smaller copy, but
only if every word still reads the same). Photos and other formats are never altered.

## What measures quality

* `npm run eval:parser` (368 fictional CVs in 33 layouts): the parser must not regress.
* `npm run eval:ocr`: renders CVs to images, degrades them like real scans and phone photos, and scores word recovery and field
  accuracy. Put consented real documents in `sample-documents/real/` (git-ignored) with a `<file>.key.json` answer key and they are scored too.
* `server/test/`: unit and integration tests, including two real servers sharing one database for the rate limits.

All of these use invented documents unless you add real ones. **Accuracy on real-world CVs is unmeasured until you do.**

## AI in extraction
Whether and where to use AI is decided in [`AI_EXTRACTION_DECISION.md`](../parser/AI_EXTRACTION_DECISION.md): rules first, AI only for the gaps the parser reports, measured in shadow before switching it on.

## Honest limits (read before scaling)

* **Reading can run apart from the website, but nothing measures it yet** (2026-10-27). `ROLE=api` servers serve the website only;
  `npm run worker` processes read documents (`server/src/worker.ts`); both scale independently and share the Postgres queue safely.
  The default (`ROLE=all`) is still one process doing both. No load test has been run across several processes.
* **Memory rate limits are per process.** With several web servers each has its own counters for the high-volume limits (the
  security limits are shared and exact). Fine for a few servers; move them into the shared store or Redis beyond that.
* **Postgres is the queue, the rate-limit store and the database.** It is simple and durable, and it is the first thing to watch as load grows.
* **Single region, dev Supabase project, no backups or point-in-time recovery, no malware scanner.** See [`PRODUCTION_READINESS.md`](PRODUCTION_READINESS.md).
* **Organisations are kept apart twice** (2026-10-27): by the code's own `where org_id` and by PostgreSQL itself. After sign-in, and for
  each queue job, every query runs as `rolematch_tenant` with the organisation named (`forOrg` in `server/src/db.ts`, migration 014),
  so a query that forgets its filter still sees one organisation. Platform-wide work (sign-in, rate limits, sign-outs, claiming jobs,
  migrations) runs as the owner through `platformSql`. Needs a session-mode connection (Supabase port 5432, never transaction mode 6543).
  Proven by `server/test/tenant-separation.test.ts` (careless queries, one reused connection) and `server/test/isolation.test.ts` (every
  endpoint tried by a second organisation; a new endpoint fails the test until it is added). Not covered: the read-only copy must carry
  the role too (a physical replica does; a copy made another way must be checked), and files in storage are separated by path and the
  server's checks only.
* **Multi-page photos**: one image is one page. Several photos of one CV must be sent as a PDF. iPhone HEIC is refused with instructions.
