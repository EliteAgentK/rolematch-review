# RoleMatch: the whole picture for a CIO

Checked against the code (release `3db9bba`) and the live machines on 10 November 2026. Each page has one diagram (Mermaid) and what it means. Where something is a provider's statement we have not verified, or a gap, it says so.

**One-line summary:** RoleMatch is a working web service with strong separation between companies and encrypted, tested backups, but it runs on a single PC on an office line, sends CV text (with identifiers masked) to Claude in the USA, and has had no independent security test or legal POPIA review. It is fit for a supervised pilot, not yet for an enterprise production contract.

---

## 1. Infrastructure: what runs where

```mermaid
flowchart TB
  users["Recruiters<br/>web browser"]
  owner["Owner<br/>console"]
  subgraph cf["Cloudflare, free plan"]
    edge["HTTPS, DDoS protection, firewall<br/>app.rolematch.co.za · console.rolematch.co.za"]
  end
  subgraph dell["Dell PC, South Africa · Windows 11"]
    direction TB
    subgraph wsl["Linux (WSL) · Docker containers"]
      direction TB
      tunnel["Cloudflare tunnel<br/>outbound only: no open ports"]
      subgraph app["RoleMatch application · Node.js / TypeScript"]
        direction LR
        api["Web API"]
        console["Owner console"]
        worker["Document reader<br/>PDF, Word, OCR"]
        aiworker["AI worker<br/>Claude calls"]
        monitor["Monitor"]
      end
      cron["Scheduled jobs<br/>backup, daily check, heartbeat"]
      backups[("Encrypted backups<br/>14 nights")]
    end
    subgraph win["Windows"]
      watchdog["Watchdog + keep-alive<br/>built, awaiting admin install"]
    end
  end
  subgraph supa["Supabase Pro · Ireland (EU)"]
    direction LR
    pg[("PostgreSQL<br/>records, queue, audit")]
    auth["Auth<br/>accounts"]
    storage[("Storage<br/>original CVs, private")]
  end
  claude["Anthropic Claude API · USA"]
  smtp["Mail host (SMTP)"]
  subgraph mac["Mac, office"]
    collect["Second copy of backups"]
  end
  users -->|HTTPS| edge
  owner -->|HTTPS| edge
  edge <-->|tunnel| tunnel
  tunnel --> api
  tunnel --> console
  app -->|"SQL, sign-in, private files (TLS)"| supa
  aiworker -->|"HTTPS, masked text"| claude
  app -->|"codes, invitations, alerts"| smtp
  cron -.->|"nightly dump"| supa
  cron -.-> backups
  backups -.->|"nightly copy"| collect
  watchdog -.->|"restarts Linux if it freezes"| wsl
  classDef pending fill:#fff4d6,stroke:#c99a2e,color:#5a4200
  class watchdog pending
```

* **Compute:** one Dell PC in South Africa runs every service in Docker containers inside Linux (WSL 2). Nothing on the PC accepts connections from the internet; Cloudflare reaches it through a tunnel the PC opens outwards.
* **Data:** Supabase Pro in Ireland holds the database, the accounts and the original documents. The PC holds no live records, only encrypted backups.
* **Outside services:** Cloudflare (edge), Supabase (data), Anthropic (AI), an SMTP mail host. The full chart is `INFRASTRUCTURE.mmd`.

---

## 2. One CV's journey, and where personal data crosses a border

```mermaid
sequenceDiagram
  autonumber
  box South Africa
    participant R as Recruiter's browser
    participant A as API (Dell PC)
    participant W as Reader + AI worker (Dell PC)
  end
  box Ireland (EU)
    participant S as Supabase storage + database
  end
  box USA
    participant C as Anthropic Claude
  end
  R->>A: Upload CV (HTTPS through Cloudflare)
  A->>A: Check sign-in, portal membership, type, size, allowance
  A->>S: Store original privately, queue the job
  A-->>R: "Processing" (candidate not shown yet)
  W->>S: Take the job, fetch the original
  W->>W: Read text (PDF, Word, OCR), rules pick out fields
  W->>W: Mask email, phone, ID numbers, links, names
  W->>C: Masked CV text, one document per call
  C-->>W: Structured reading
  W->>W: Validate every value against the document, drop what is not there
  W->>S: Save candidate, evidence and audit entry
  S-->>R: Candidate appears, with "View Original CV"
  Note over R,C: Matching happens only when a recruiter presses Match: same path, Claude Sonnet, masked text of one CV and one job
```

**What a CIO should take from this**

* **Personal data leaves South Africa twice.** All records and originals are stored in Ireland. CV text goes to Anthropic in the USA for reading and matching. POPIA section 72 governs both transfers; the legal review (operator agreements, consent and purpose notice, retention) **has not been done**.
* **What is masked before Claude:** email addresses, phone numbers, South African ID numbers, links and the candidate's name. **What still goes:** work history, employers, education and skills. That is still personal information.
* **What Anthropic keeps:** governed by Anthropic's commercial API terms (not used to train models under those terms; retention period per the contract). **To confirm against the signed terms; not verified by us.**
* Nothing enters the candidate list until reading and validation finish, and no person is rejected or shortlisted by the system: it recommends, a recruiter decides.

---

## 3. Security controls, layer by layer

```mermaid
flowchart TB
  subgraph L1["1 · Edge: Cloudflare"]
    direction LR
    a1["HTTPS only"] ~~~ a2["DDoS protection<br/>and firewall"] ~~~ a3["No open ports on the PC<br/>(outbound tunnel)"]
  end
  subgraph L2["2 · Identity: Supabase Auth + API"]
    direction LR
    b1["Password, plus emailed<br/>code at sign-up"] ~~~ b2["5 attempts per 15 min<br/>on anything guessing a secret"] ~~~ b3["Roles: admin, recruiter,<br/>viewer (enforced, tested)"]
  end
  subgraph L3["3 · Company separation: PostgreSQL"]
    direction LR
    c1["Row-level security<br/>on every table"] ~~~ c2["Restricted database role<br/>for all company work"] ~~~ c3["Tested under load:<br/>no record seen by<br/>the wrong company"]
  end
  subgraph L4["4 · Documents"]
    direction LR
    d1["Private storage"] ~~~ d2["Short-lived<br/>signed links"] ~~~ d3["Type, size and page limits,<br/>hostile-input tests"]
  end
  subgraph L5["5 · AI"]
    direction LR
    e1["Identifiers masked,<br/>one document per call"] ~~~ e2["Key held only<br/>by the AI worker"] ~~~ e3["Monthly cap,<br/>usage metered per company"]
  end
  subgraph L6["6 · Secrets, audit, backups"]
    direction LR
    f1["Secrets in root-only files,<br/>secret scan on every commit"] ~~~ f2["Append-only audit log:<br/>who changed what, from, to"] ~~~ f3["Backups AES-256 encrypted,<br/>second copy on the Mac"]
  end
  L1 --> L2 --> L3 --> L4 --> L5 --> L6
  L6 -.-> gaps["Known gaps: no malware scanning of uploads · no independent penetration test<br/>no POPIA legal review · encryption at rest is Supabase's statement"]
  classDef gap fill:#fde2e1,stroke:#c0392b,color:#6b1a12
  class gaps gap
```

* **Strongest point:** company separation is enforced by the database itself, not only by application code, and is tested under load.
* **Honest limits:** sign-in, the processing queue and rate limits run with full database rights and rely on the code being right. Supabase states that data is encrypted at rest; we rely on that statement. The security review so far is our own engineering review (22 Oct 2026), not an independent test.

---

## 4. Resilience: what fails, and what happens

```mermaid
flowchart LR
  subgraph spof["Single points of failure today"]
    pc["The Dell PC"]
    line["Office internet line"]
    power["Office power"]
  end
  pc --> down["Site down"]
  line --> down
  power --> down
  supabase["Supabase Ireland outage"] --> down
  claude["Claude unavailable or out of credit"] --> degraded["Still up: CVs published from the parser's reading, marked why;<br/>new matches show 'not scored' with the reason; saved matches still show"]
  smtp["Mail host down"] --> queued["Emails wait in an outbox and retry"]
  down --> today["Today: found by a person;<br/>alerts come from the same PC, so they go silent with it"]
  down --> soon["After the watchdog install: a frozen Linux restarts itself,<br/>then the PC once; line and power still need a person"]
  classDef bad fill:#fde2e1,stroke:#c0392b,color:#6b1a12
  classDef ok fill:#e3f4e8,stroke:#2e7d4f,color:#123d22
  classDef mid fill:#fff4d6,stroke:#c99a2e,color:#5a4200
  class pc,line,power,down bad
  class degraded,queued ok
  class today,soon mid
```

| Question a CIO asks | Answer today |
|---|---|
| How much data can we lose? | Supabase Pro keeps its own daily backups (provider's statement). Ours: an encrypted dump every night at 01:30, 14 nights kept, copied to the Mac. Worst case on our own backups: the day's work since 01:30. |
| How fast can we recover? | A release can be rolled back to the previous version in minutes. A full restore from our backup is proven by a drill on a test copy; a full restore of live at its real size has **not** been timed. |
| Outages so far | Three on our own hosts: 6 Nov (the Mac on battery), 10 Nov 04:59 to 06:08 (Windows stopped the PC's Linux and it jammed). One provider incident (Supabase gateway, 22 Oct). All recorded in `PRODUCTION_READINESS.md`. |
| How are changes released? | Built on the PC from a fixed commit, the full test suite run first, a backup taken, the previous version kept for rollback, every release logged. There is **no separate staging environment** that mirrors live. |
| How is it watched? | A monitor inside the PC, a daily check emailed at 06:00, an owner console. **No outside uptime check yet**, so a whole-PC outage is not alerted. |
| How much load? | Tested on a test copy on 5 Nov: about 200 people at once comfortably with the database in Ireland, 5,000 working sessions with six servers. **The current Claude-based setup has not been load-tested.** |

**What would close these gaps, in order:** install the watchdog (admin, 5 minutes); add a free outside uptime check with phone alerts; move the application from the PC to a hosted server near the database in Ireland, which removes the PC, line and power from the list; a staging copy of live; a POPIA review and an independent penetration test before an enterprise contract.
