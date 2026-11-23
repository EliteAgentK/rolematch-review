# The next frozen runs: criteria written before the results

Written 2026-11-04, before either run below. Changing a criterion after seeing a result means the run no longer counts.

## Failed, and staying failed
`acceptance-1` (commit `269f8f3`, 9 fresh real CVs, 2026-11-03) **failed criterion A3**: one wrong name was published. It stays recorded as failed. Its nine CVs became development material when their failure led to a change. Every real CV held today is development material, so **no untouched real set exists**.

## Run A: a group of the synthetic long-form pack nobody has looked at (`lf-unseen-4`)
Ids with remainder 4 when divided by 7, in `RoleMatch_300_Long_Form_CVs 2`: 43 invented people, Word, searchable PDF and scan. No file of this group had been read by any run. Remainders 5 and 6 are kept unread for later candidates.

**What this can show:** whether the frozen candidate holds up on documents it was not tuned on. **What it cannot show:** accuracy on real CVs. It is synthetic and from one author, and earlier groups of the same pack shaped the code, so its layouts are not new.

Run once, on a clean committed and tagged candidate, with the base (the switch off) on the same files.

| # | Criterion | Pass |
|---|---|---|
| U1 | Wrong published e-mail or phone, Word and searchable PDF | at most 1 of 86 for each field |
| U2 | Wrong published e-mail, scan | at most 2 of 43 |
| U3 | Wrong published phone, scan | at most 1 of 43 |
| U4 | Name, e-mail, phone, location, title right, Word and searchable PDF | at least 90% each |
| U5 | Skills found, Word and searchable PDF | at least 90% each |
| U6 | Name, e-mail, phone right, scan | at least 80% each. This is not the 90% target: it says whether OCR is still far from it |
| U7 | Certificates the reference calls Expired shown as expired | at least 90% |
| U8 | Documents holding a wrong core value and not sent for review | at most 3 of 129 |
| U9 | Nothing crashes | 129 of 129 read or refused with a reason |

If a failure here informs a change, this group becomes development material, like every group before it.

### Run A, first attempt: failed, and staying failed
`lf-unseen-4`, candidate-4, commit `d830570`, rules 2.4.0, 2026-11-04, one run.

| # | Result | |
|---|---|---|
| U1 | E-mail 0 and phone 0 wrong of 86 | pass |
| U2 | **5 wrong e-mails on scans, limit 2** | **FAIL** |
| U3 | 1 wrong phone on scans | pass |
| U4 | **Name on PDF 35 of 43, 81%: blank, none wrong.** All others at least 95% | **FAIL** |
| U5 | Skills, Word 344 of 344, PDF 337 of 344 | pass |
| U6 | **E-mail on scans 31 of 43, 72%.** Name 88%, phone 91% | **FAIL** |
| U7 | Expired shown as expired: 33 of 33 on each format | pass |
| U8 | **6 documents with a wrong core value not sent for review, limit 3** | **FAIL** |
| U9 | 129 of 129 read | pass |

Its failures led to changes (R88), so this group is development material now. Remainder 5 takes its place, under the same criteria, unchanged. Remainder 6 stays unread.

### Run A, second attempt: failed, and staying failed
`lf-unseen-5`, candidate-5, commit `74cf905`, 2026-11-04, one run. Word and searchable PDF passed everything. **U2 (4 wrong scan e-mails), U3 (2 wrong scan phones), U6 (scan e-mail 70% right) and U8 (4 documents unflagged) failed.** Full table in `RESULTS_2026-11-04.md`. Its failures have not been opened.

## Run B: fresh authorised real documents, when they arrive
Nothing is asked of anyone until then. The tool is ready: `npm run acceptance prepare <folder>`, a person fills the answer sheet from the originals without seeing what RoleMatch read, then `npm run acceptance run`.

**Unlabelled documents and machine agreement cannot establish accuracy.** Without a person's answers the tool refuses to run, unless told `--behaviour-only`, and then it says it cannot state accuracy. It also refuses uncommitted code, an untagged commit, a changed file, and a second run.

Criteria (`server/test/real/acceptanceLib.ts`, `CRITERIA`), per field and format, with a 95% interval shown beside every figure because a few dozen documents leave a wide range:
- no crash;
- at least 90% right where a person gave an answer (the owner's minimum);
- at most 2% wrong for name, e-mail and phone, the release criterion, judged apart from the share right;
- a field with fewer than 10 values is reported, not judged.

If its failures inform any change, the set moves to development material, and it is not called held out again. Any real CV also needs its authorisation confirmed by the owner, and training on it needs separate permission.
