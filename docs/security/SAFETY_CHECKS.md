# Automated safety checks

What runs, where, what each check proves and does not prove, and how exceptions are handled. Set up 2026-11-02.

## Where each check runs

| When | What | Authoritative? |
|---|---|---|
| Every commit on a developer's machine | `.githooks/pre-commit`: secret scan of the staged change | **No.** `git commit --no-verify` skips it. It is an early warning only |
| Every pull request, and pushes to `master` and `rolematch/**` | `.github/workflows/ci.yml`: scanner self-test, secret scan of the new commits, licence policy, production dependency audit, website types/tests/build, server types and the full server test suite on a disposable local Supabase | **Yes**, once it runs on GitHub and is required (see "Merge enforcement") |
| Every night, 03:30 SAST | `.github/workflows/nightly.yml`: whole-history secret scan, licence policy, a fresh dependency audit; redacted report kept 14 days | Yes, for new advisories and anything a skipped hook let through |

**Set up on a new machine:**
- `brew install gitleaks`
- `npm run setup:hooks`

**Run everything locally:** `npm run safety`.

## Outcomes are never mixed up
Every check reports one of three things:
1. **Completed, nothing found.**
2. **Completed, something found.**
3. **Incomplete.**

An incomplete check fails. A missing scanner, a crash, an unreadable or contradictory report, a missing folder or lockfile, or no network all count as incomplete. None of them is "clean". R40 is the reason: the website's dependency audit said "no advisories" for two weeks without ever running.

| Check | Clean | Found | Incomplete |
|---|---|---|---|
| Secret scan (`scripts/safety/secretScan.mjs`) | exit 0 | exit 1 | exit 2 |
| Dependency audit (`server/scripts/auditCheck.mjs`) | exit 0 | exit 1 | exit 2 |
| Licence policy (`scripts/safety/licenceCheck.mjs`) | exit 0 | exit 1 | exit 1, with the reason |

## Secret scanning
- **Tool:** gitleaks 8.30.1 (MIT). It is pinned in CI and checked against the release's published checksum.
- **Rules:** gitleaks' **maintained default rules are always on**. `.gitleaks.toml` adds two RoleMatch rules:
  - `rolematch-env-secret-assignment`: one of our secret variables written as a literal value. The value must be at least 20 characters and random-looking.
  - `rolematch-connection-string-password`: a password inside a database, cache, mail or queue connection string, under any variable name.
- **Values are never printed.** Values are redacted, and the scripts print only the rule, file, line and commit. The hook test confirmed the secret appeared 0 times in the output.
- **What CI scans:**
  - A pull request: its own commits.
  - A push: the pushed commits.
  - A new branch, forced push or manual run: the whole history, because there is no reliable "before".
  - Every night: the whole history.
- **First history scan (2026-11-02):** 193 commits across every branch and both remotes were scanned. The default rules found nothing. One finding came from the new connection-string rule (S1 below).

### Proven detection (`scripts/safety/secretScan.test.mjs`, generated at run time, never committed)

| Fixture | Caught by |
|---|---|
| GitHub token | `github-pat` |
| AWS access key | `aws-access-token` |
| Slack bot token | default Slack rule |
| Stripe live key | `stripe-access-token` (also when split across two strings) |
| Supabase-style service-role JWT | `jwt` |
| Generic `api_key` | `generic-api-key` |
| Multi-line RSA private key | `private-key` |
| `MAIL_SMTP_PASS` / `SUPABASE_SERVICE_ROLE_KEY` literals | `rolematch-env-secret-assignment` |
| A database URL with a random password, under any variable name | `rolematch-connection-string-password` |

**Proven not reported:**
- placeholders (`your-api-key-here`, `changeme`, `xxxx…`, `<your-service-role-key>`);
- references (`env.X`, `process.env.X`, `restore.key`, `tdb.url()`);
- test data (`postgres://x`, `postgres://u:p@h/db`, `oldsecret`, `@example.test` addresses).

**Proven to fail as incomplete:** a missing scanner, a scanner error (exit 1), no report, a report that isn't a list, and an exit code that contradicts the report.

### Known limits (not detected)
- **Short, human-chosen passwords** (for example `Tr0ub4dor&3` in an ordinary variable). These can't be told apart from ordinary text without constant false alarms. The defence is that secrets live only in `server/.env`, which Git ignores and which the test configuration never reads.
- **Secrets in binary files, images or PDFs.**
- **Secrets that never reach Git.** The scan covers Git content only.
- The hook only sees commits made on a machine where it is set up. CI is the gate.

### The 11 findings of the first draft rule (reviewed 2026-11-02, all false positives)
My first version of `rolematch-env-secret-assignment` matched any value after our variable names. It flagged 11 lines, none of them a secret:

| File (commit) | What it was |
|---|---|
| `server/test/readonly-return.test.ts:32` (64c6fd8c) | `DATABASE_URL: <function call>`, a throw-away database's address |
| `server/scripts/mailTrial.ts:24` (703c04ea) | `MAIL_SMTP_PASS: env.MAIL_SMTP_PASS`, a reference |
| `server/test/auth-expiry.test.ts:15` (773d1611) | `process.env.SUPABASE_SERVICE_ROLE_KEY = restore.key`, a reference |
| `server/test/envfile.test.ts:36`, 3 findings (773d1611) | made-up file contents: `postgres://u:p@h/db`, `oldsecret`, a quoted line |
| `server/test/envfile.test.ts:41` (773d1611) | a test assertion about the line prefix |
| `server/test/migrate-startup.test.ts:12–15`, 4 findings (87efd75e) | `"postgres://x"` placeholders |
| `server/test/metamorphic-audit.test.ts:82` (34311cc3) | `ANTHROPIC_API_KEY: ""` (empty), continued over two lines |

**Resolution: the rule was corrected, not weakened by exceptions.**
- It now requires a literal value of at least 20 characters with high randomness, which describes a real key and none of the above.
- No allowlist entry was needed for any of the 11.
- The default rules were never changed.
- The positive fixtures prove the corrected rule still catches real-looking values.

### Reviewed exceptions (`.gitleaksignore`, one exact fingerprint each)

| Id | Fingerprint scope | Why it is not a secret | Reviewed |
|---|---|---|---|
| S1 | commit 773d1611, `server/test/auth-expiry.test.ts:52`, rule `rolematch-connection-string-password` | Password of a throw-away local Postgres container the test creates and destroys itself; not a credential to any real system. The test now generates it at run time, so no literal remains; the exception covers the old commit only | 2026-11-02 |
| S2 | commits 570b7732 and 782a6cdf, `research/jobs/ocr6_read.py:5` and `research/jobs/bla_ocr_read.py:13`, rule `rolematch-env-secret-assignment` | Research scripts that set the AI key to an empty string and the database address to `postgres://none:none@127.0.0.1:1/none`, a place nothing listens. No value is a credential. History only. | 2026-11-20, lines read with values masked (independent audit of fd2952c) |
| S3 | commits df20f9eb, daab10f6 (two files) and d0b7f41b (two lines), `research/jobs/{pv3,pv2,blc}_tools.ts`, rule `generic-api-key` | File paths of answer-key JSON files for invented test jobs, in functions named `hasKey` and `jobKey`: the word "key" beside a path is the whole finding. History only. | 2026-11-20, as S2 |
| S4 | commit ca0ede8c, `ci-demo-secret.ts:1`, rule `rolematch-env-secret-assignment` | The fake value generated on purpose to show CI's scan catching a secret (commit "CI demonstration: a generated fake secret, hook skipped (never merged)"), on a branch never merged; it was never a credential to anything. | 2026-11-20, as S2 |

**Narrow allowlist on the connection-string rule:**
- Exact matches only: `postgres` (the local Supabase stack's published default), `password`, `changeme`, `your-password`, `<password>`, and `${VAR}` references.
- Any other value is still reported.

## Dependency vulnerabilities
- **What runs:** `npm audit --omit=dev` for the server and the website. The audit fails on a new advisory, on an accepted advisory past its review date, or on an audit that did not complete.
- **Exceptions:** listed in `server/audit-allowlist.json`. Each has the advisory, package, path, **reason, owner, scope and review date**. Never add an entry only to make the check pass, and never apply a breaking downgrade blindly; the sprintf-js entry rejects one.
- **Result 2026-11-02:**
  - Server: 58 production packages, no advisories.
  - Website: 172 production packages, no advisories.
  - A full audit including development packages (255 and 253) also found none.
  - The sprintf-js entry is no longer reported by npm and should be removed at its review.
- **Not covered:** OSV-Scanner (Apache-2.0) was evaluated as a second source and not added. One source with one exception list avoids two competing lists; adding it later is a policy choice.

## Licences
- **What runs:** `scripts/safety/licence-policy.json` and `licenceCheck.mjs` read every package in **both committed lockfiles**, 508 packages. Nothing needs to be installed, and nothing in `node_modules` can fool them.
- **Rules:**
  - Allowed: MIT, MIT-0, ISC, Apache-2.0, BSD-2/3-Clause, 0BSD, Unlicense, Zlib, CC0-1.0, BlueOak-1.0.0.
  - `A OR B` passes if either is allowed. `A AND B` needs both.
  - A package with no licence stated fails.
  - Any other licence needs an exception with a reason, an owner, a scope (package, version, development or production) and a review date.
  - A development-only exception fails if the package becomes a production dependency.
  - **"pending-review" is a classification waiting for the owner, not a legal conclusion.** It passes, with a warning, only until its review date.
- **Pending your review (by 2026-11-30):**

  | Package | Licence | Scope |
  |---|---|---|
  | @fontsource Outfit and Sora | OFL-1.1 | production fonts |
  | lightningcss | MPL-2.0 | build tool only |
  | sharp's libvips binaries | LGPL-3.0 | development only |
  | duck | "BSD", variant not stated | production, via mammoth |
  | js-clipper | Boost | development only |

## Remote CI and merge enforcement (verified 2026-11-03)
- **Repository:** `EliteAgentK/rolematch`, private, the `personal` remote, with admin access. `origin` (`Atlegapeople/talenthub`) is the public April 2025 original, which we can only read.
- **First green run:** 41597996531 on 0d03ad3, **all three jobs passed**: Safety checks 14 s, Website 24 s, Server 12 min 26 s, on a clean machine with a disposable Supabase. The two runs before it found real gaps; see R43.
- **Proofs, on temporary branches, never merged and deleted afterwards:**

  | Proof | Run | Result |
  |---|---|---|
  | A failing test fails the check | 41599460574 | Website job failed: "expected 2 to be 3" |
  | A generated fake secret, committed with the hook skipped | 41599463109 | Safety job failed, naming the rule, file, line and commit; **the value appears 0 times in the CI log** |
  | A broken scanner is not a clean scan | 41599466410 | Safety job failed at the scanner self-test |
  | Corrected code passes | 41599723501 | Website job passed |

- **What CI does NOT do yet: block a merge.** GitHub refused, with **HTTP 403** and "Upgrade to GitHub Pro or make this repository public", when reading both branch protection and rulesets on this repository. CI runs and reports, but a failed check doesn't stop a merge on GitHub Free. Enforcement needs GitHub Pro, a GitHub Team organisation, or a public repository. **This is the owner's decision, and the fourth proof in the brief (failed checks prevent merging) can't be shown until then.**
- **Repository setting not changed:** Actions is allowed to run all actions. Restricting it to selected actions and requiring pinned versions is recommended, and needs approval.
- **Minutes:** a private repository on GitHub Free includes a $12 monthly allowance, about 2,000 Linux minutes. One full run uses about 13 minutes across its three jobs, so roughly 150 runs a month.

## Parser evaluation gate (added 2026-11-03)
`npm run parser:gate` runs the retained failure library against each parser's accepted baseline, as a step in CI's server job. A rise in wrong values, a fall in correct values (so refusing documents cannot pass), a recurrence or a run that does not reconcile each fail it. **It reports. It blocks nothing on GitHub Free, and passing switches nothing on.** The invented Visual Variety batch is not in the repository, so that comparison is local only.

## Not yet covered
- Browser end-to-end tests (Playwright) are not in CI: they need a running app and the mail-safety harness.
- A container image scan: there is no container yet.
- Code scanning (static analysis): not chosen yet.
