# Real CVs: how they are handled, measured and used to improve the reader

## Handling
- **What:** 30 real CVs (26 PDF, 4 Word), handed over by the owner on 2026-11-03: "lets improve using those". They stay read-only in the owner's Downloads folder.
- **Permitted use:** evaluation and parser development on this machine. **No model training without separate permission.** Whether the people on the CVs agreed to this use has not been established; it is the owner's to confirm.
- **Private:** everything that holds their details is in `server/data/real-cvs/` (git-ignored, readable only by this user): the id-to-file list, extracted text and records. It is never put in Git, logs, reports or outside services. The run refuses to start if an outside AI key is set.
- **What reaches this conversation, and so an outside service:** opaque ids (RC-xxxxxx), counts and layouts with every letter and digit masked. A person checks real values on this machine.
- **Retention:** until the owner says otherwise; deleting `server/data/real-cvs/` and the source folder removes them.

## Sets (frozen 2026-11-03, before anything was read)
Split by person, using a salted hash, with file names used only to keep one person's documents together: 29 people or document families.

| Set | Files | Use |
|---|---|---|
| Development | 21 (18 PDF, 3 Word) | Run and diagnosed freely, so its results are **not** independent evidence once used for fixes |
| Untouched acceptance | 9 (8 PDF, 1 Word) | Never run or read until a final check. Inventory only |

## What the figures mean
**There is no answer key yet, so none of these are accuracy figures.** `npm run eval:real` reports **suspects**: the text says something should be there and the record does not have it, or the file name disagrees with the name found. A suspect is not a verified error, and a clean row is not proof of correctness. 21 CVs give wide uncertainty: 10 of 21 is roughly 28–68% (95% interval).

## Baseline `real-baseline-1` (commit 4e7f96c, parser 2.9.0, no model, read as of 2026-11-03)
- **Accepted 15 of 21; refused 6, all "no name could be confirmed".** The invented held-back set refused 12%. No crashes. OCR on 1 document.
- **Time:** median 153 ms, slowest 71.6 s. Peak memory 886 MB.
- **Name:** 6 refused and 5 accepted with a name that disagrees with the file name. Masked inspection shows at least 4 of those 5 are form labels or other text, not a person's name.
- **Suspects across the 15 accepted:** certification heading with none found 9; no location 6; role without employer 5; name disagrees 5; role without dates 3; skills heading with under 5 skills 2; phone in text not extracted 2; fewer roles than half the date ranges 2; role without duties 1; e-mail in text not extracted 1.

## Experiment E4: names on recruiter forms and agency layouts (register R44)
**Pre-registered 2026-11-03, before the change was written.** Off by default (`PARSER_EXPERIMENTS=E4`).

**Accepted only if all of these hold:**
1. On the real development set, refusals for no name and name-disagrees suspects both fall, and every changed name is confirmed by the file name's words where the file name gives any.
2. On the invented Visual Variety 60 batch, on both splits: no check moves from right to wrong for the name, and no field gets worse in total.
3. The regression and counterexample tests pass, and the frozen outputs change only where the name changes.
4. A CV's other fields do not get worse in the real set's suspect counts.

**Not a criterion:** a percentage target. This set is too small and is being tuned on.

**Outcome, 2026-11-03: not accepted; off by default.** Criterion 2 was never met: each new rule fixed some cases and created others, including places, companies and sentences published as names. The owner redirected the work to the causes: see [OWN_PARSER_AND_OCR.md](OWN_PARSER_AND_OCR.md), which holds the figures. E5 (agency contact details) was developed alongside it and has the same status.
