# ADR-006: Matching is the AI's alone, judged as a recruiter would

Status: accepted by the owner, 9 November 2026. It supersedes the rules-first matching in ADR-005.

## Decision

The owner tested on live, 9 November 2026, and decided:

- "there should be no formulas here, only AI matching, this is where we need deep thinking"
- "once a score is final for a role and job, that's final ... unless the panel was edited"
- "behave like a recruiter"
- "there can't be gaps ... extremely accurate and thorough, but it still can't take too long"
- "it needs to look against everything the job requires ... and most importantly fair"
- The scorer reads the full CV, chosen on evidence.

```mermaid
flowchart TD
  J[Job published or edited] --> B[Claude Sonnet briefs the job once<br/>role, seniority, industry, everything required,<br/>at least 4 and at most 5 must-haves, and 5 for an executive role (owner, 10 Nov 2026; job-read-4) (8 before job-read-3); each quoted from the job]
  B --> C{Code checks the brief}
  C -->|split or missing must-have| B
  C -->|told and still wrong| S[Code settles it: one must-have per line,<br/>required ones in while there is room]
  C -->|ok| R[(Brief saved, keyed by what the job says)]
  S --> R
  M[Recruiter selects Match] --> K{Final score saved<br/>for this CV and job?}
  K -->|yes| F[Shown at once, no cost]
  K -->|no| Q[Queued in the AI lane of this portal]
  Q --> A[Claude Sonnet, deep thinking:<br/>the whole CV beside code's facts<br/>dated roles, total years, education, location]
  R --> A
  A --> V{Code checks the answer:<br/>every requirement once, cited lines real,<br/>inferred never 'met', career, score 0-100}
  V -->|fails| A
  V -->|fails twice| N[Not scored, with the reason]
  V -->|ok| P[(Final score saved, keyed by<br/>what the CV, its facts and the job say)]
  P --> F
```

## What it measures

- Every requirement of the job is judged: education, experience and years, responsibilities, skills, certifications, languages, licences, and location and working arrangement.
- Each gets one state: verified, partial, not demonstrated, contradicted or not applicable. The lines of the CV it rests on are cited.
- Something credited from a close equivalent is marked inferred, and is partial at most.
- The career is judged as a whole: seniority against the role, industry, and how recent the relevant work is.
- The score is Claude's whole judgement, 0 to 100, weighing must-haves most. Bands describe the evidence, not the person.
- Confidence measures the quality of the evidence, never the candidate.

## Fair by construction

- One brief per job, so every candidate is measured against the same list.
- Names, e-mail addresses, phone numbers, identity numbers and links are masked before anything is sent.
- Nothing is judged on age, gender, race, ethnicity, nationality, religion, disability, health, pregnancy, marital status or sexual orientation, nor on anything standing in for them.
- A requirement the job states about any of these is listed, flagged and never scored. The recruiter decides.
- Gaps and career breaks count against no one by themselves. Equivalent routes count.
- Location counts only as the job requires it. Where the CV does not say whether the person would move, it is "to confirm", never a fail.

## Measured before release

All runs used real CVs, Claude Sonnet 5.5, and the CV read in full.

| Candidate | Sonnet | Opus 5.5 | Claude in chat |
|---|---|---|---|
| Owner's CV against the Centre of Excellence job | **85%** | 80% | 85% |

For the owner's CV, Sonnet found 7 of 8 must-haves met, with the degree not shown.

- **Agreement with Opus:** on the other three CVs, Sonnet and Opus were within 0 to 3 points of each other.
- **Cost and time:** about $0.07 to $0.08 and 37 s per candidate, with the job's brief read once at upload.
- **Reading the full CV against the record with a second look:** the full CV was about half the cost and time ($0.08 and 37 s against $0.15 and 68 s). The record version drifted 12 points on one CV.
- **Steadiness:** asked three times, the same pair varied by 0 to 4 points. Live asks once and keeps the answer.

## Limits, stated

- The per-minute output limit is shared by the whole platform, because there is one Anthropic account. At the current tier that is about 12 candidates a minute, so a 30-CV shortlist takes about 2½ to 3 minutes. The fair queue shares this between companies but does not add capacity.
- Near production, the owner's account limits are raised. Companies pay RoleMatch per use, billed from `ai_usage` per portal. There are no per-company Anthropic keys.
- Agreement with recruiters is not yet measured. That needs recruiter-judged pairs (planned) before any claim of "agrees with recruiters X% of the time".
- When the AI is off or fails, a match has no score and says why. No rules score stands in.
