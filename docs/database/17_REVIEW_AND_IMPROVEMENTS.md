# Review of the bible, and the improvements made (Claude, 6 November 2026)

Codex wrote documents 00–16 from `docs/architecture/CODEX_DATABASE_BIBLE_PROMPT.md`. This document records what was checked, what is accepted, what is corrected, and what is added. Where this review and an earlier document disagree, this review wins until the owner decides otherwise.

## 1. Verdict

**Strong:**
- Security and threat model (04);
- identity (05): stricter and better than ADR-004;
- the file vault's crash boundaries (06);
- recovery honesty (07);
- the cutover's "no blind failback" rule (12);
- the integration contracts (14).

Every one of these is adopted.

**Weak:**
1. The schema document's diagrams have no real columns (section 3.1).
2. The console has page lists, not wire maps (section 4).
3. The plan has lost the Cloudflare phase (section 3.4).
4. The machine roles are out of date (section 3.5).

## 2. Accepted from Codex, replacing ADR-004 where they differ

| Topic | ADR-004 said | Codex says (adopted) | Why it is better |
|---|---|---|---|
| App access token | about 1 hour | 15 minutes; refresh idle 7 days, absolute 30 days | a stolen token is useful for minutes, not an hour |
| Console session | not set | access 5 min, idle 15 min, absolute 8 h; fresh verification within 5 min for a reveal or reset | the console holds everything |
| Rollback after the cutover | copy new writes back, then switch | once new writes are accepted, recover forward on the new platform, unless a full reverse copy is rehearsed | a frozen Supabase copy silently loses everything written since; forward recovery is the honest default |
| Recovery target | about 2 minutes of loss | **within 15 minutes for the independent copy**, proven by drills | Codex is right that nightly copying to the Mac loses up to a day if the PC dies. WAL must reach the Mac continuously (section 3.3) |
| Deletion and restore | not covered | deletion receipts replayed after any restore, before exposure | without this, a restore brings deleted people back (POPIA) |
| Effort | 7–10 days | 20–38 days for everything in the bible | ADR-004 counted the core; the bible adds performance, integrations and device proof. Both are stated; the core comes first |

## 3. Corrections

### 3.1 The schema document must be generated, not written by hand

**The problem:** `03_SCHEMA.md` lists every table with links to the migration lines, which is good. But all of its ER diagrams carry the placeholder `string key` (106 times) instead of real columns. Its "class and retention" sentence is the same boilerplate on 31 tables, so it tells the reader nothing table by table.

**The fix:** phase 2 adds `server/src/scripts/schemaBible.ts`. It applies all migrations to a disposable PostgreSQL 17, reads the real catalogue (columns, types, keys, indexes, constraints, RLS policies, grants, owners), and writes `03_SCHEMA.generated.md`, including Mermaid ER diagrams with real columns.

Personal-data class and retention come from one hand-kept file, `docs/database/data-classes.json`, with one line per table. The generator refuses to run if any table has no entry.

**A test fails when the generated document and the database differ,** so the bible can never drift from the schema.

### 3.2 The console gets real wire maps

See section 4. Codex's page, state and copy tables stay as the specification behind the wire maps.

### 3.3 Backups reach the Mac continuously, not nightly

pgBackRest keeps two repositories:
- **repo1:** on the PC;
- **repo2:** on the Mac, over SFTP with a restricted key, receiving WAL as it is archived.

The vault manifest and new files follow every 5 minutes. **Target:** at most 15 minutes of data lost if the PC dies, proven by a drill before anyone is told it.

### 3.4 The plan keeps Cloudflare first

`13_PLAN.md` dropped ADR-004's phase 1. Cloudflare in front protects what is live today, so it stays first, and it waits only on the owner creating the account and moving the domain. It is inserted as phase 0b.

### 3.5 Machine roles changed on 6 November

**The owner:** "the Mac is free just for model fine-tuning."

**From now on:**
- **The PC** runs everything live, **including the live model on its processor.**
- **The Mac** only trains, plus its backup copy on disk, which uses almost no processing.

There is therefore no training window, and live never waits for training. `15_MACHINES_AND_SCHEDULING.md` is corrected below.

**The cost:** CV reading on the PC's processor is slower than the Mac's 41–42 tokens per second. That speed is **unmeasured** and is the first thing measured. If it is too slow, the owner is told the figure before anything is switched over.

## 4. Console wire maps

Plain boxes; the RoleMatch palette, type and buttons from `src/theme/` apply. **Phone: one column, thumb-reachable actions at the bottom. Laptop: a sidebar and two columns.** Every number taps through to detail.

### Today: phone

```
┌──────────────────────────────┐
│ RoleMatch Console        ☰   │
├──────────────────────────────┤
│ ● All well                   │  green / amber / red + words, never colour alone
│   Checked 13:42              │
├──────────────────────────────┤
│ ▲ 1 needs you                │  only when something is open
│   Backups: Mac copy 3 h old  │
│   [ Open ]                   │
├──────────────────────────────┤
│ Live          up 3 d 4 h     │
│ CV reading    12 waiting · 3m│
│ Last backup   01:30 ✓        │
│ Errors (24 h) 2 new          │
│ Sign-ups      1 today        │
│ Disk          41 %           │
├──────────────────────────────┤
│ Latest                       │
│ 13:40 Portal created · Org A │
│ 13:12 3 CVs read · Org B     │
│ 12:58 Error fixed · upload   │
├──────────────────────────────┤
│ Today  Alerts  Data  System  │  bottom tabs
└──────────────────────────────┘
```

### Today: laptop

```
┌────────────┬─────────────────────────────────────────────────────────┐
│ RoleMatch  │ ● All well · checked 13:42                    [Owner ▾] │
│ Console    ├───────────────────────────┬─────────────────────────────┤
│            │ Needs you (1)             │ Live health                 │
│ Today      │ ▲ Mac copy 3 h old [Open] │ Live      up 3 d 4 h        │
│ Alerts  2  │                           │ Reading   12 waiting · 3 m  │
│ Orgs       ├───────────────────────────┤ Backups   01:30 ✓  WAL 2 m  │
│ People     │ Latest activity           │ Errors    2 new (24 h)      │
│ Records    │ 13:40 Portal created · A  │ Sign-ups  1 today           │
│ Processing │ 13:12 3 CVs read · B      │ Disk      41 %              │
│ Audit      │ 12:58 Error fixed         ├─────────────────────────────┤
│ Health     │ …          [See all]      │ This week (sparklines)      │
│ Backups    │                           │ CVs read · errors · users   │
│ Schema     │                           │                             │
└────────────┴───────────────────────────┴─────────────────────────────┘
```

### Alerts: phone, with detail

```
┌──────────────────────────────┐   ┌──────────────────────────────┐
│ Alerts                       │   │ ‹ Alerts                     │
│ [Urgent 1][Today 2][Info 5]  │   │ ▲ URGENT · Backups           │
├──────────────────────────────┤   │ Mac copy is 3 h old          │
│ ▲ Mac copy 3 h old       ×3  │──►│ First 10:41 · last 13:41 · ×3│
│   Backups · 13:41            │   │ What it means                │
│ ● 2 CVs failed to read       │   │  If the PC failed now, up to │
│   Processing · 12:10         │   │  3 h of work could be lost.  │
│ ○ New sign-up                │   │ What to do                   │
│   People · 09:02             │   │  Check the Mac is awake.     │
│                              │   │ [ Acknowledge ] [ Mute 1 h ] │
└──────────────────────────────┘   └──────────────────────────────┘
```

### Records: masked, then revealed (laptop)

```
┌────────────┬─────────────────────────────────────────────────────────┐
│ …          │ Records › Org A › Portal Sales            [Candidates▾] │
│            ├───────────────────────────┬─────────────────────────────┤
│            │ ●●●●● ●●●●●  · Sales lead │ Candidate  ●●●●● ●●●●●       │
│            │ ●●●●● ●●●  · Analyst      │ Role: Sales lead · 7 yrs    │
│            │ ●●●● ●●●●●  · Engineer    │ Status: Shortlisted         │
│            │                           │ Details hidden (POPIA)      │
│            │                           │ Reason [______________]     │
│            │                           │ [ Show details ]  needs a   │
│            │                           │ fresh sign-in, is audited,  │
│            │                           │ hides again after 2 minutes │
└────────────┴───────────────────────────┴─────────────────────────────┘
```

### Backups: phone

```
┌──────────────────────────────┐
│ Backups                      │
│ ● Recoverable to 13:40       │  latest point we can restore to
│   Last drill: 2 Nov · 41 min │
├──────────────────────────────┤
│ On the PC    full 01:30 ✓    │
│ On the Mac   WAL 13:38 ✓     │
│ File vault   5 files ✓ match │
├──────────────────────────────┤
│ [ Restore a copy to a minute ]  → a separate rehearsal database,
│                              │    never over live
└──────────────────────────────┘
```

The other pages (Organisations, People, Processing, Audit, Health and security, Schema, Ask) follow the same pattern: a list on the left (or the whole phone screen) and detail on the right (or full screen with ‹ Back). Their wire maps are a phase 5 deliverable, drawn before any code.

## 5. Added rules

1. **Plain-words test:** every console screen is read aloud to the owner before it ships. Any word that needs explaining is changed.
2. **Two-tap rule:** any fact in the database is at most two taps from Today.
3. **No silent zeros:** a number the console cannot read shows "unknown" with the reason, never 0.
4. **The console checks itself:** if its own data is more than 2 minutes old, the status dot turns grey and says so.

## 6. Order of work (6 November onwards; the owner said to do everything needed)

1. Fix the 4 failures in the release candidate; release; start the monitor; update the tunnel.
2. Measure the model on the PC's processor; move the live model to the PC; free the Mac.
3. Fine-tuning on the Mac: compare the base models on the 30 real CVs under fixed criteria; build the training set; train; measure. Nothing goes live without the owner's approval.
4. Database phase 2 on the PC (PostgreSQL 17, roles, pgBackRest with the Mac as repo2, the suite moved), then phase 3 (vault) and the schema generator.
5. Cloudflare as soon as the owner's account exists. Sign-in and the console only after this review's corrections.

## 7. Phase 2 status (6 November 2026, evening)

**Built and proven on the PC, beside live and without touching it:**
- **Our own PostgreSQL** (`rm-db`, image from `deploy/db/`), published on 127.0.0.1:5433 only.
- **Roles:**
  - `rm_schema_owner` owns all 31 tables;
  - `rm_migrate` and `rm_app` work as the owner;
  - `rm_readonly` is read-only, with a 30 s statement limit;
  - `rolematch_tenant` is the row-security role.
- **All 34 migrations apply unchanged,** thanks to empty Supabase stand-ins (`auth.users`, `storage.buckets` and three roles). The identity work retires them.
- **Schema check:** in step with the code, row security on every table, the audit log protected.
- **Isolation probe:**
  - tenant role with no organisation named: 0 rows;
  - with organisation A named: only A;
  - read-only role: refused when writing;
  - read-only role reading: 0 rows of tenant data, because no policy names it. The console's masked views will be its first readable rows.
- **Backups:**
  - pgBackRest, encrypted, with the key read from a mounted secret at each call;
  - the change log is closed at least every 60 s;
  - a full backup each Sunday and a differential every other night;
  - the Mac copies the store every 5 minutes (`deploy/mac/collectDbRepo.sh`; its launch agent is an owner install).
- **Restore drill:** restored to a chosen second in 15–19 s, the change after it absent. It caught R155 on its first run. It runs weekly, and the daily check reports it.

**Not yet, and not claimed:**
- ~~`rm_app` still has the owner's rights~~ **Done the same evening** (`deploy/db/app-role.sql`): `rm_app` reads and writes data but is refused when it tries to drop a table, switch off row security, disable the audit lock or create a table. Proven on `rm-db`, and on a fresh database built from scratch. It still reads every organisation's rows (BYPASSRLS) for platform-wide work; replacing that with explicit platform policies is the next step.
- **The test suite has not moved yet.** Its sign-in still comes from the local Supabase stack, whose accounts live in that stack's own database, so the move comes with the own-identity work (phase 4).
- **No live data is in `rm-db`.**
