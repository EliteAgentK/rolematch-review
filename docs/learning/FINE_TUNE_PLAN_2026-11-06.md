# Fine-tuning our own reader: pre-registered plan (6 November 2026)

**Status:** registered before any comparison or training runs. Nothing below has been measured yet. These criteria may not be changed after the first result is seen. A change after that point needs a new registration that says why.

## What we are improving

The model half of the hybrid CV reader (`server/src/modelReader.ts`, prompt `reader-0.7.0`), currently `qwen3:4b-instruct-2507-q4_K_M` through Ollama.

**Last measured** (run h9 replayed, 29 real CVs; `ERROR_REGISTER.md` R149):

| Field | Score |
|---|---|
| Roles fully right | 83.4% |
| Skills recall | 93.3% |
| Certificates recall | 91.2% |

**The owner's floor:** 90% on every field. **The owner's other complaint:** reading takes far too long.

## The data and its honesty

| Set | What | Used for |
|---|---|---|
| **Protected test** | the 30 keyed real CVs (`server/data/real-cvs/keys/keys.jsonl`) | measuring only, never trained on |
| **Training pool** | every CV in Downloads (about 3,667 documents, including jobs and the fictional sets; the owner gave permission on 5 Nov for this machine only), less the 30 test CVs and any near-copy of them | building the training set |

**The test keys are provisional.** Claude wrote them on 5 Nov from the documents' text. Only name, e-mail and phone were checked by the owner (`labels.json`). The test therefore measures agreement with careful keys, not independent truth, and every report says so.

**Leakage guard:**
- Any training document whose text overlaps a test CV by 50% or more of its 8-word shingles is removed.
- Exact copies are removed by hash.
- The list of removed documents is kept privately.

**What the Downloads collection actually holds** (counted 6 Nov, before any training):
- **Real CVs:** only the 30 in `Sample CVs`, which are the protected test set.
- **Fictional packs that come with their own answer keys:**

  | Pack | Documents | Answer keys |
  |---|---|---|
  | `RoleMatch_300_Long_Form_CVs 2` | 300 CVs as PDF and Word | per-CV JSON |
  | `RoleMatch_60_Visual_Variety_CVs 3` | 60 layouts | JSON |
  | `RoleMatch_Live_Workflow_Corpus` | scans and photos included | a ground-truth CSV |
  | `RoleMatch_Long_CVs` | 26 | JSON |

- **Other packs:** `CVs` (2,000 files with text twins, keys to be checked) and `Jobs` (150 job descriptions in three formats, for matching later).

**Labels for training:**
1. **Gold, used first:** the packs' own answer keys, mapped to the reader's schema. They are the generator's truth, not a model's guess.
2. **Silver, only where no key exists:** the best base model's answers together with the rules, kept only where code proves them (every value occurs in the document's own text, dates are valid, nothing is invented). A document that fails is dropped, not repaired.

**The known risk:** this means training on fictional CVs to read real ones. The protected test is entirely real, so it will show whether the skill transfers. The fictional documents never become a measure of success (owner, 5 Nov: fictional sets are regression protection only).

**Privacy:** CV text, labels and the trained adapters stay on the Mac. None of it goes into Git, logs, reports or any outside service. Reports carry counts and opaque IDs only.

## Step 1: choose the base model (same inputs, same machine, nothing else running)

**Candidates (all Apache-2.0):**
- `qwen3:4b-instruct-2507` (current);
- `qwen3.5:4b`;
- `qwen3:8b`.

**Inputs:** the same reader prompt, context (`MODEL_CONTEXT_TOKENS` 9216), settings and 30 test CVs for all three, run through `test/collection/hybridEval.ts` and scored by `test/collection/scoreReal.py`.

**Recorded per model:**
- every field score;
- invented items (precision);
- tokens per second;
- seconds per CV;
- memory.

**Choice:** the most accurate model that fits beside training on a 16 GB Mac and reads one CV in at most the current time. A tie goes to the smaller model.

### Step 1 result (6 Nov 2026, 16:30–18:47, the Mac alone, run `cmp1`)

Same 30 CVs, same reader and settings, each model asked afresh on a private Ollama (`ml/compare.sh`). Scored by `scoreReal.py` against the provisional keys (147 key roles, 74 education entries).

| | qwen3:4b-instruct-2507 (current) | qwen3.5:4b | qwen3:8b |
|---|---|---|---|
| Roles fully right | **84.4%** (124) | 79.6% (117) | 74.8% (110) |
| Roles found | **91.2%** | 89.8% | 87.1% |
| Extra or duplicate roles | 25 | 16 | **15** |
| Role precision | 77.0% | 77.0% | 75.3% |
| Education recall / precision | 83.8% / 81.6% | **91.9% / 85.0%** | 90.5% / 71.3% |
| Skills recall / precision | 93.6% / 23.0% | 93.2% / 29.2% | 91.9% / 26.1% |
| Certificates recall / precision | 90.5% / 56.1% | 88.9% / 77.3% | 96.8% / 57.8% |
| Location right | 86.7% | 80.0% | 90.0% |
| Name, email, phone, agency | equal | equal | equal |
| Seconds per CV (median / slowest) | **59 / 287** | 66.5 / 385 | 108.5 / 591 |
| Words written per second | **23.0** | 19.0 | 11.2 |
| Model file | **2.5 GB** | 3.3 GB | 5.2 GB |

**Choice: the current model, qwen3:4b-instruct-2507, stays the base.** It is the only one that reads a CV in at most the current time, and it is the most accurate on roles, the field the training is for. qwen3.5:4b is better on education and certificates and makes fewer extra roles; those are what the training set teaches, so they are the gaps step 3 must close, not a reason to change base.

Recorded honestly: the keys are provisional (written by Claude), so a difference of a few roles is within their error; memory was not measured separately (the file sizes above stand in for it).

## Step 2: train (LoRA on the Mac with MLX; `~/rolematch-ml`, mlx-lm 0.32.2)

- A low-rank adapter on the chosen base. The base model itself is never retrained from scratch (owner rule).
- 90% of the pool trains and 10% validates; the validation set stops training early.
- The prompt becomes short: the trained model already knows our format. That is where the speed should come from.

## Step 3: decide (criteria fixed now)

**The trained model goes live only if all of these hold on the 30 protected test CVs:**
1. Roles fully right improve by at least 3 points over the base model chosen in step 1.
2. No field falls by more than 1 point.
3. Invented items do not rise, and personal identifiers leak 0 times.
4. Seconds per CV are no worse; the aim is at least 30% faster.
5. The full test suite passes with the trained model in place.
6. **The owner approves the release** (release authorisation).

**Otherwise** the current model stays, and the report says which criterion failed and why.

**Class of decision:** a model promotion. It needs the owner's approval, and it is recorded in the ledger (`ERROR_REGISTER.md`) together with the comparison.

## Machines

Live, including its model, runs on the PC. The Mac does only this work (owner, 6 Nov: "the Mac is free just for model fine-tuning").

## Step 3 result (6 Nov 2026, 20:33–21:46, the Mac alone, run `adapter-lora2`): not promoted

The adapter `lora2` (600 steps, validation loss 0.989 to 0.017) against the same base with no adapter, both taken through the same path (MLX weights dequantised, imported into Ollama as int4, live's template and settings; `ml/evalAdapter.sh`). The step 1 run of the model live serves (GGUF q4_K_M) is shown for the cost of the path. Scored by `scoreReal.py` against the provisional keys.

| | live base (q4_K_M, step 1) | base, same path (int4) | trained `lora2` (int4) |
|---|---|---|---|
| Roles fully right | 84.4% (124) | 83.0% (122) | **74.1% (109)** |
| Roles found | 91.2% | 89.8% | 85.0% |
| Extra or duplicate roles | 25 | 24 | **44** |
| Role precision | 77.0% | 76.2% | 63.4% |
| Education recall / precision | 83.8% / 81.6% | 85.1% / 75.9% | 83.8% / 60.8% |
| Skills recall / precision | 93.6% / 23.0% | 92.3% / 24.4% | 83.4% / 31.9% |
| Certificates recall / precision | 90.5% / 56.1% | 90.5% / 48.9% | 79.4% / 37.6% |
| E-mail right (wrong) | 93.3% (0) | 93.3% (0) | 80.0% (**5**) |
| Phone right (wrong) | 93.3% (0) | 93.3% (0) | 76.7% (**6**) |
| Location right | 86.7% | 76.7% | 63.3% |
| Seconds per CV (median / slowest) | 59 / 287 | 63 / 721 | **37 / 241** |

**Against the criteria:**

| | Criterion | Result |
|---|---|---|
| 1 | roles fully right +3 points | **fails**: −8.9 points against the same path |
| 2 | no field falls more than 1 point | **fails**: e-mail, phone, location, roles, education precision, skills, certificates |
| 3 | invented items do not rise; identifiers leak 0 times | **fails**: extra roles 24 to 44; 5 e-mails and 6 phones wrong where the base had none |
| 4 | no slower | passes: median 37 s against 63 s (41% faster) |
| 5, 6 | suite with it in place; owner approval | not reached |

**Decision: the current model stays live.** Nothing was changed on live.

**What the numbers say (not yet proven):**
* Every changed e-mail and phone (6 of 6, 7 of 7) is in one of the 14 agency CVs. The trained model most likely takes the agency's contact for the candidate's. This has not yet been checked against the documents' text.
* Validation loss 0.017 on fictional packs and worse reading of real CVs: the model learned the packs' layouts, not CVs. This is the known risk written above (training on fictional CVs to read real ones), now measured.
* The int4 path itself costs about 1.4 points on roles (84.4% to 83.0%), so the path does not explain the drop.
* It is faster because it writes less, and part of what it leaves out is right.

**Next, before any second run:** per-CV comparison of what the training broke (agency contacts first), and whether the training answers for agency packs name the candidate's contact or the agency's; then a training set that reads like real CVs, or no fine-tuning. A second run is registered first, like this one.

## Step 3 diagnosis (7 Nov 2026, 23:00–23:30): what `lora2` broke, CV by CV

Counts and opaque IDs only. Checked against the documents' text by code, not by eye.

**Contacts: the agency's details given to the candidate.**
* All 7 CVs whose e-mail or phone changed are agency CVs. In every one, the value `lora2` returned is printed in the CV, beside recruiter or agency wording: it is the agency's contact, not invented.
* Mechanism: the reader's answer has no e-mail or phone; the rules find those. `reconcile.ts` removes an agency's e-mail and phone from the candidate's only when the model names the agency. The base model named an agency in 11 answers; `lora2` in 1. With no agency named, the rules' first contact, which is the agency's, stayed.
* Why `lora2` stopped naming agencies: 584 of its 585 training answers have an empty agency. The 27 training CVs with recruiter wording are candidates who *work as* recruitment or claims consultants, not CVs presented by an agency. Of 689 CV answer keys across the three packs, 1 records an agency; the workflow corpus and the 2,000-file `CVs` pack have none either. **The training pool holds no agency-presented CVs, while 14 of the 30 real CVs are.** Training on it teaches the model that agencies do not exist.
* Found on the way, live today: without the model's agency answer, the rules alone give the candidate the agency's contact on these 7 CVs. Live depends on the model to get them right; when it falls back to rules only, they are wrong.

**Roles: one job written several times.**
* `lora2`'s entries that match no key role: 41 against 34 for the base, and duplicates 3 against 1. Of `lora2`'s entries at a real employer with a title the key does not have (39, against 15), 36 carry exactly the dates of a key role at that employer: the same job again, titled with another line of the CV, 11 of them a bullet point.
* Validation loss 0.017 on a random split of the same packs: the model memorised the packs' layouts. A random split cannot see that, because the same layouts are on both sides.

**What follows (not yet decided):**
1. Fine-tuning on the current pool cannot improve agency handling and makes it worse. The agency answer should not depend on the trained model, or the pool needs agency-presented CVs with true labels.
2. Validation must hold out whole packs (layouts the training never saw), so early stopping measures transfer, not memory.
3. Two code guards would help any model, base included, and are measured first on the stored answers (no new model run): a job at the same employer with the same dates as another is the same job; and the agency's contact must not become the candidate's when the rules already see an agency block.

## Step 4 (registered 7 Nov 2026, 23:38, before any result): earlier checkpoints of `lora2`

**Question:** is the damage memorisation that grew with training? `lora2` saved its adapter every 100 steps; validation loss fell to 0.017 by step 600. If memorisation is the cause, an early checkpoint should keep more of the base's reading while still writing our format.

**What runs:** checkpoint 100 (`lora2-c100`), then checkpoint 300 (`lora2-c300`) only if c100 is not worse than the base on roles fully right. Same path as step 3 (`ml/evalAdapter.sh`, int4), same 30 protected CVs, the base asked afresh each time, which also measures how much the base itself varies between two runs.

**Criteria: those of step 3, unchanged**, against the base run in the same comparison. **One added, because of the diagnosis:** the agency is named on at least as many real CVs as the base names it, and no candidate is given an agency's e-mail or phone.

**Expected (written before the result):** contacts and agency probably still worse than the base, because even 100 steps of all-empty agencies teach the same thing; roles closer to the base than `lora2`. If so, the next run needs the agency out of the trained model's job (or agency-presented training CVs), and validation on a held-out pack.

### Step 4 result (7–8 Nov 2026, 23:42–00:38, the Mac alone, run `adapter-lora2-c100`): rejected, and checkpoint 300 not run

Same path and 30 CVs as step 3; both models asked afresh. Scored by `scoreReal.py` against the provisional keys. The code used was the main branch after R165 (one job per employer and dates), for both models, so extras are lower than in step 3 for the base too: a code change, not chance.

| | base, same path | checkpoint 100 |
|---|---|---|
| Roles fully right | **83.0% (122)** | 68.0% (100) |
| Roles found / missing | 89.8% / 15 | 77.6% / **33** |
| Extra or duplicate roles | 16 | 13 |
| Education recall | 85.1% | 68.9% |
| E-mail right (wrong) | 93.3% (0) | 80.0% (**5**) |
| Phone right (wrong) | 93.3% (0) | 76.7% (**6**) |
| Location right | 76.7% | 73.3% |

**Against the criteria:** 1 fails (−15 points), 2 fails, 3 fails (contacts as in step 3). The registered condition for checkpoint 300 (c100 not worse on roles fully right) is not met, so it was not run.

**What it says:** the prediction for contacts held: 100 steps of all-empty agencies already teach the model that there are none. The prediction for roles did not: the early checkpoint is worse than the late one, not better, so the problem is not memorisation that grew with training. It has unlearned the base's reading before learning ours. **Training on this pool does not improve the reader on real CVs at any point measured.**

**What would make a next run worth doing** (each needs a decision, recorded for the owner, not taken here):
1. **Training CVs that look like the market**, above all agency-presented ones. The pool has none. Ways: real CVs given for training (separate from the 30 test CVs, with POPIA permission per tenant); or agency cover pages and headers added to the fictional packs' CVs with labels true by construction, which is a new fictional set and needs the owner's say (5 Nov: no more fictional sets for measuring).
2. **The agency taken out of the trained model's job**, asked of the base model in a short focused question, so training cannot unteach it.
3. **Validation on a held-out pack**, so stopping is decided by layouts never seen.

Until then, the gains come from the system around the model (R165: extras 25 to 19 on the model live serves, nothing lost), measured the same way.

## Step 5 (registered 8 Nov 2026, 08:20, before any data is built): `lora3`, training material that looks like the market

**Owner, 8 Nov ~07:29:** "Please may you train this model the best way you can to ensure success here." Downloads holds no real CVs beyond the 30 protected test CVs (counted again 8 Nov: `Sample CVs` 30, `Reference` is the fictional packs' answer keys). So no real agency CV exists to train on. Agency presentation is added to the fictional training CVs, with labels that are true because we wrote them. This is training material only; success is measured on the 30 real CVs alone, as before.

**Two causes the run fixes, both found in the code, not guessed:**
1. **No agency-presented CVs** (step 3 diagnosis). Training taught the model that agencies do not exist.
2. **No long CVs.** `buildTrainingSet.ts` dropped every CV that `readerInput` splits into sections ("needs sections (left for later)"). Live asks such a CV section by section ("THE CV (one section of a long document)"). On the 30 real CVs, 16 needed more than one question to the model (run `cmp1`: 14 one call, 10 two, 5 three, 1 six). The trained model never practised the form of question that half the real CVs get.

```
 fictional packs (Word + searchable PDF, own answer keys)          30 real CVs (protected: never read here)
            │                                                              │ shingles only, to drop near-copies
            ▼                                                              ▼
   readDocument (live's reader) ──► near a real CV? ──yes──► dropped
            │ no
            ▼
   agency layer?  (half the CVs, chosen by hash of pack/id; the same CV's Word and PDF alike)
     ├─ no  ─► text as read; agency label empty (incl. people who WORK as recruiters: hard negatives kept)
     └─ yes ─► invented agency inserted as text: cover block / per-page header / closing contact block / reference line
               label = exactly what was inserted (name, consultant or empty, consultant's e-mail and phone); candidate's own contacts kept, so the
               model must tell the two apart; no invented name, e-mail or phone may occur in any real CV
            │
            ▼
   readerInput (live's numbering and sectioning)
     ├─ one part  ─► one example, "THE CV, numbered lines"                         (as lora2)
     └─ sections  ─► one example per section, "THE CV (one section of a long document)", answer = what that section shows whole;
                     a section that cuts a job or qualification in two gives no example (ambiguous label), the others are kept
            │
            ▼
   validateReading (live's checks) must keep every answer unchanged, or the example is dropped
            │
            ▼
   split by hash of pack/id: 90% train, 10% valid (a CV's sections and copies never straddle)
            │
            ▼
   MLX LoRA on Qwen3-4B-Instruct-2507-4bit: lora2's settings; iterations = one pass; checkpoints every 100;
   the checkpoint kept is the one with the lowest validation loss (fictional valid set; the real CVs play no part in choosing)
            │
            ▼
   ml/evalAdapter.sh lora3: base and lora3 through the same int4 path, main-branch reader code, 30 real CVs, asked afresh
```

**Criteria: step 3's, unchanged, plus step 4's agency criterion,** all against the base in the same comparison:
1. Roles fully right improve by at least 3 points.
2. No field falls by more than 1 point.
3. Invented items do not rise; personal identifiers leak 0 times.
4. Seconds per CV no worse.
5. The agency is named on at least as many real CVs as the base names it, and no candidate is given an agency's e-mail or phone.
6. The full suite passes with it in place; then the owner's release approval (a model promotion).

**Sanity checks on the fictional valid set (not success measures):** the agency is read on the valid CVs that carry one, and none is invented on those that do not. If these fail, the training did not take and the real-CV run is not worth the Mac's time.

**Expected (written before any result):** agency and contacts at or above the base, since the material now holds both cases. Roles: closer to the base than `lora2` because sections are now practised; whether they clear +3 points is genuinely uncertain. If roles stay below the base again while agency is fine, the conclusion is that fictional CVs do not teach reading real ones at this model size, and the next lever is the system around the model, not more training on this pool.

**Correction to step 5, 8 Nov 07:50, after building the data and before any training:** cause 2 as registered was wrong. The builder found only 2 practice CVs that live splits into sections; the fictional long CVs fit in one question. The real CVs' extra questions are **region re-reads** (`REGION_SYSTEM`: the rows around a job the first reading could not place, the lines in question marked), not sections: in `cmp1` the extra calls match the regions exactly. Checked on the stored step 3 runs, base against `lora2`, same path:

| Real CVs | CVs | Key roles | Base fully right | `lora2` fully right |
|---|---|---|---|---|
| read in one question | 14 | 53 | 53 | 49 |
| with region re-reads | 16 | 94 | 69 | 60 |

The region CVs are where the base itself is weakest (73% against 100%) and where most of `lora2`'s loss is (9 of 13 roles). So the set now also holds **one region re-read per practice CV**, made the way live makes it (`regionsOf` on a job's title and employer lines, `regionInput`, `REGION_SYSTEM`). The answer is the jobs that part shows whole, plus education or an agency only where the part shows them. A region that cuts a job or qualification in two gives no example.

**The set as built (`AGENCIES=1 SECTIONS=1 REGIONS=1`, `~/rolematch-ml/data-lora3`):** 1,013 training and 120 validation examples. Training: 585 whole CVs (334 with an invented agency, 262 of them naming a consultant; 253 without), 426 region re-reads (103 showing an agency), 2 sections. Dropped as before: 56 jobs not found together, 25 education mismatches, 1 check disagreement. No invented agency value occurs in any real CV (checked in code). `ml/lora3.yaml`: lora2's settings, 1,013 iterations (one pass). The criteria and expectation above are unchanged.
