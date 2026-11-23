# RoleMatch: how it's built

Mermaid source of each diagram, checked against the code on 10 November 2026. Paste a block into a Mermaid viewer to see it drawn.

## What runs where

```mermaid
flowchart TB
  users["Recruiters<br/>web browser"]
  owner["Owner<br/>console"]
  edge["Cloudflare<br/>HTTPS · DDoS protection · firewall"]
  subgraph host["Application host · for now one PC in South Africa (pilot)"]
    direction TB
    tunnel["Secure tunnel<br/>outbound only, no open ports"]
    subgraph app["RoleMatch application · TypeScript on Node.js · Docker containers"]
      direction LR
      api["Web API"]
      console["Owner console"]
      worker["Document reader<br/>PDF · Word · OCR"]
      aiworker["AI worker<br/>the only part holding the AI key"]
      monitor["Monitor"]
    end
  end
  subgraph supa["Supabase Pro · Ireland (EU)"]
    direction LR
    pg[("PostgreSQL<br/>records · queue · audit")]
    auth["Accounts<br/>and sign-in"]
    storage[("Original CVs<br/>private storage")]
  end
  claude["Anthropic Claude · USA<br/>Haiku reads CVs · Sonnet briefs jobs and judges matches"]
  smtp["Mail service (SMTP)<br/>codes · invitations · alerts"]
  backups[("Encrypted nightly backups<br/>records · accounts · original files<br/>14 nights · second copy off the host")]
  users -->|HTTPS| edge
  owner -->|HTTPS| edge
  edge <--> tunnel
  tunnel --> api
  tunnel --> console
  app -->|"TLS, certificate checked"| supa
  aiworker -->|"masked text"| claude
  app --> smtp
  supa -.->|"nightly"| backups
```

## Languages and where they run

```mermaid
flowchart LR
  ts["TypeScript<br/>on Node.js"] --> ts1["Screens in the browser"]
  ts --> ts2["Web API"]
  ts --> ts3["Document reader"]
  ts --> ts4["AI worker"]
  sql["SQL<br/>PostgreSQL"] --> sql1["Tables and records"]
  sql --> sql2["Row rules that keep<br/>companies apart"]
  sh["Bash"] --> sh1["Releases, backups,<br/>daily checks"]
  ps["PowerShell"] --> ps1["Pilot PC: restarts<br/>Linux if it freezes"]
  py["Python"] --> py1["Analysing test results only<br/>nothing that runs live"]
  classDef lang fill:#e8eefc,stroke:#3b5bab,color:#16295a
  classDef side fill:#f3f4f6,stroke:#9ca3af,color:#374151
  class ts,sql,sh,ps,py lang
  class py1 side
```

## One CV's journey

```mermaid
sequenceDiagram
  box South Africa
    participant R as Recruiter's browser
    participant A as Web API
    participant D as Document reader
    participant W as AI worker
  end
  box Ireland (EU)
    participant S as Supabase database and storage
  end
  box USA
    participant C as Anthropic Claude
  end
  R->>A: 1. Upload CV
  Note over A: Limits, size, real file type (by content),<br/>daily allowance, same file already uploaded?
  A->>S: 2. Store the original privately, queue it
  A-->>R: Shown as "Processing", not yet a candidate
  D->>S: 3. Take the job, fetch the original
  Note over D: Checks the file again, reads the text (PDF, Word, OCR),<br/>flags a possible duplicate person (never merges)
  D->>S: 4. Draft held back, queued for the AI
  W->>S: Take the AI job
  Note over W: Hides email, phone, ID number, links, name
  W->>C: 5. Masked CV text, one CV per call
  C-->>W: Structured reading
  Note over W: Every value checked against the CV<br/>anything not in the CV is dropped
  W->>S: 6. Save candidate, evidence, audit entry
  S-->>R: 7. Candidate appears, with "View Original CV"
  Note over R,C: TODAY: if the AI is off, out of credit, too busy, or fails twice, the reader's own reading is published and says why.<br/>WILL BE: out of credit, new uploads are refused with "Out of usage credits". A CV appears only once Claude has read it, never from the reader alone.
```

## Who belongs where

```mermaid
flowchart LR
  orgA["Company A"] --> pA1["Portal: Main"]
  orgA --> pA2["Portal: Finance"]
  pA1 --> mA1["Members, each with a role:<br/>admin · recruiter · hiring manager"]
  pA2 --> mA2["Members, each with a role:<br/>admin · recruiter · hiring manager"]
  orgB["Company B"] --> pB1["Portal: Main"]
  pB1 --> mB["Members, each with a role:<br/>admin · recruiter · hiring manager"]
  classDef co fill:#e8eefc,stroke:#3b5bab,color:#16295a
  class orgA,orgB co
```

## 3b. Four separation checks

```mermaid
flowchart LR
  req["Request from a<br/>recruiter of Company A,<br/>Portal Finance"] --> c1["1 · Server<br/>signed in, member of<br/>this portal, role allows it"]
  c1 --> c2["2 · Database<br/>row rules: only<br/>Company A, Portal Finance"]
  c2 --> c3["3 · Links<br/>records link only within<br/>one company and portal"]
  c3 --> c4["4 · Original CVs<br/>served after the company<br/>check, every view recorded"]
  c1 -.-> r1["Refused"]
  c2 -.-> r2["Other companies' rows:<br/>invisible"]
  c3 -.-> r3["Cross-company link:<br/>rejected"]
  classDef no fill:#fde2e1,stroke:#c0392b,color:#6b1a12
  class r1,r2,r3 no
```
