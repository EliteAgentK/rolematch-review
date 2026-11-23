# Reader gaps and candidates (consolidated from RESEARCH_NOTES.md)

**Status: a list of blind spots the research showed, NOT a build list.** The owner collected the notes so the reader can be judged against what mature projects have learned. Nothing here is committed to; items are picked one at a time, with the owner, when they earn their place.

Consolidated 2026-10-21 from 11 batches of notes (about 140 ideas, 49 queue items). Rules for every item: permissive licences only, no per-document fee, nothing leaves our infrastructure, deterministic output (parser version bump, frozen outputs re-reviewed), recruiter stays in control. PyMuPDF itself is rejected (AGPL); only ideas are used.

## How the 49 items group

| Theme | Queue items | Why it matters |
|---|---|---|
| A. Richer data per text piece | 1.115, 1.1, 1.72, 1.100 | Font name, bold/italic, size, colour, opacity, draw mode feed most of the rest |
| B. Hidden and misleading content | 9, 24, 26, 31, 32, 21, 35 (forms), 37 | Integrity: keyword stuffing, stale text, struck-through facts, covered text, form values not in the text |
| C. Robustness and safety | 43, 44, 46, 47, 45 | Never hang, never leak, never trust the document; honest report |
| D. Scan and photo quality | 42, 6, 7, 38, 30, 2.2 (DocTR) | Weakest area: scans 10% perfect, photos 10% |
| E. Layout and tables | 48, 22, 39, 36, 10 | Our largest remaining PDF failures (cells, grids, justified text) |
| F. Test coverage | 28, 41, 49, 45 | New stress cases so each fix is proven |
| G. Owner decisions | 34 (PDF copy permissions), PDF with attachments, which annotation text to read | Needs a yes/no, not code |

## Phases

**Phase 1: foundations and quick wins (start now)**
1. Extend the text piece (`Item`) with font name, bold, italic, colour, opacity and draw mode where the PDF engine exposes them (A).
2. Processing report additions that need no new reading: PDF producer and creator, incremental-edit flag, encryption, page size, repaired-on-open, annotation and attachment counts, JavaScript present, AcroForm present (B, C).
3. Hidden-text detection from the draw operations: text drawn in render mode 3, with zero opacity, or covered by a later shape; flagged, never silently used (B).
4. Unicode clean-up: ligature code points U+FB00 to FB06, letter-per-line repair check (E).

**Phase 2: robustness**
5. Per-page time budget with partial result; worker recycling; unique temp files; extreme-shapes corpus (C).
6. Reader sandbox tests: ZIP renamed .pdf, traversal-style names, decompression bomb (C).

**Phase 3: coverage of real-world file types**
7. Read AcroForm field values (not password fields); flag rich media and JavaScript (B).
8. Accept TIFF, multi-page TIFF, BMP, GIF (D).
9. Struck-through text and page-graphics reading (lines, fills) (B, E).

**Phase 4: scan and photo quality**
10. Region-level hybrid read: native text where legible, OCR only for gaps (D).
11. OCR accuracy against render resolution; orientation by word count; DocTR trial behind the OCR interface (D).

**Phase 5: layout and tables**
12. Line-and-fill table finder plus alignment fallback; shared box helper; font-aware heading detection (E).

Each phase ends with: stress run (before and after), golden outputs reviewed, parser version bump, contract change log, full suites, local commit.

## Owner decisions needed (G)

1. **PDFs that forbid copying or extraction.** Read anyway and flag, or hold for a recruiter first? Default proposed: read, flag in the report, show the recruiter the flag.
2. **Annotation text and comments from other people.** Proposed default: never extracted into the candidate record; only counted and flagged.
3. **Hidden text.** Proposed default: excluded from extraction and from evidence, shown to the recruiter as "hidden text found".

## Status

* Phase 1 item 1 started (see below).
