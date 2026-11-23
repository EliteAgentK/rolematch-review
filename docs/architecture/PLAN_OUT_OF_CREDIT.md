# Plan: out of usage credits

Mermaid source of the plan, 10 November 2026. Not built yet.

## Plan A: credit, warning, lock, unlock

```mermaid
flowchart LR
  subgraph console["Owner console"]
    topup["Credit topped up:<br/>balance in $ and<br/>rand rate entered"]
    view["Today page:<br/>$ left · rand left<br/>marked estimate"]
  end
  subgraph db["Database · new table ai_credit"]
    bal[("balance and when set<br/>rand rate · R100 warning<br/>locked since · reason")]
  end
  subgraph worker["AI worker · every Claude call"]
    pre{"Locked?"}
    ask["Ask Claude"]
    meter["Meter the cost<br/>ai_usage, as today"]
    left{"Left after<br/>this call?"}
  end
  topup --> bal
  bal --> view
  pre -->|no| ask
  ask --> meter
  meter --> left
  pre -->|yes| stop["Not sent<br/>out of usage credits"]
  ask -->|"Anthropic says<br/>credit balance too low"| lock["Lock"]
  left -->|"$0 or less"| lock
  cap["Monthly safety cap<br/>reached"] --> lock
  lock --> bal
  left -->|"R100 or less"| low["Low credit"]
  subgraph monitor["Monitor · every minute"]
    mail["E-mail to the owner<br/>and console alert<br/>at R100 and at lock<br/>hourly reminder"]
  end
  low --> mail
  lock --> mail
  probe["Small test call<br/>every 10 minutes"] -->|answers| unlock["Unlock"]
  topup --> unlock
  unlock --> bal
  classDef bad fill:#fde2e1,stroke:#c0392b,color:#6b1a12
  classDef warn fill:#fff4d6,stroke:#c99a2e,color:#5a4200
  classDef good fill:#e3f4e8,stroke:#2e7d4f,color:#123d22
  class lock,stop bad
  class low warn
  class unlock good
```

## Plan B: what a recruiter can do when out of credit

```mermaid
flowchart LR
  subgraph ok["Still works"]
    direction TB
    v1["Sign in"]
    v2["View candidates, jobs<br/>and original CVs"]
    v3["Notes, statuses,<br/>edits, shortlists"]
    v4["Saved match scores"]
    v5["Job read again<br/>uses no AI"]
  end
  subgraph check["API · before any new AI work"]
    direction TB
    up["Upload CV or job<br/>new batch or retry"] --> c1{"Out of<br/>credit?"}
    ra["Read a CV again"] --> c1
    m["Match"] --> c2{"Score saved for<br/>this CV and job?"}
    c2 -->|yes| saved["Saved score<br/>shown"]
    c2 -->|no| c1
    c1 -->|no| go["Goes ahead<br/>as today"]
    c1 -->|yes| refuse["402 · Out of usage credits<br/>Your administrator<br/>has been told"]
  end
  dup["Same file already<br/>uploaded"] --> savedfile["Existing document<br/>returned"]
  bulk["Match one CV<br/>against many jobs"] --> mix["Saved scores shown<br/>the rest marked<br/>Out of usage credits<br/>nothing queued"]
  banner["Board shows a banner<br/>while locked"]
  classDef good fill:#e3f4e8,stroke:#2e7d4f,color:#123d22
  classDef bad fill:#fde2e1,stroke:#c0392b,color:#6b1a12
  classDef warn fill:#fff4d6,stroke:#c99a2e,color:#5a4200
  class saved,savedfile,go good
  class refuse bad
  class banner,mix warn
```

## Plan C: a CV already in progress, no parser fallback

```mermaid
flowchart LR
  up["Uploaded<br/>Processing"] --> rd["Document reader<br/>reads the text"]
  rd --> qf{"Room in the<br/>AI queue?"}
  qf -->|no| w1["Card: Waiting for the AI<br/>checks again every minute<br/>owner alerted if it lasts"]
  w1 -->|"room again"| aiq
  qf -->|yes| aiq["Queued for<br/>the AI"]
  aiq --> ai{"Claude<br/>answers?"}
  ai -->|yes| chk["Every value<br/>checked against<br/>the CV"]
  chk --> pub["Appears as<br/>a candidate"]
  ai -->|"out of credit"| w2["Card: Waiting for usage credits<br/>nothing spent, no attempt used<br/>no time limit, can be deleted"]
  w2 -->|"credit back: console top-up<br/>or 10-minute test call answers"| aiq
  ai -->|"fails twice"| nr["Card: Not read by the AI<br/>reason shown, Retry button"]
  nr -->|"Retry, while there is credit"| aiq
  today["TODAY, being replaced:<br/>queue full, out of credit or<br/>fails twice publish the<br/>reader's own reading"]
  noai["Kept only where no AI is set up<br/>tests and development:<br/>the reader's reading, labelled"]
  classDef good fill:#e3f4e8,stroke:#2e7d4f,color:#123d22
  classDef warn fill:#fff4d6,stroke:#c99a2e,color:#5a4200
  classDef bad fill:#fde2e1,stroke:#c0392b,color:#6b1a12
  classDef note fill:#f3f4f6,stroke:#9ca3af,color:#374151
  class pub good
  class w1,w2 warn
  class nr bad
  class today,noai note
```

## Plan D: where in the code

```mermaid
flowchart LR
  subgraph data["Database"]
    mig["New migration 044<br/>table ai_credit<br/>console functions to read,<br/>top up and unlock"]
  end
  subgraph server["Server · TypeScript"]
    credit["New ai/credit.ts<br/>state, lock, unlock,<br/>credit left, R100 check"]
    claude["ai/claude.ts<br/>no call while locked<br/>lock on credit refusal<br/>or monthly cap"]
    queue["queue.ts<br/>wait and try later<br/>without using an attempt"]
    read["aiRead.ts<br/>queue full: wait<br/>out of credit: wait<br/>fails twice: Not read"]
    api["index.ts<br/>402 Out of usage credits:<br/>uploads, retries,<br/>read again, new matches"]
    health["opsHealth.ts<br/>new credit check:<br/>low, or locked"]
    probe["AI worker<br/>test call every<br/>10 minutes while locked"]
  end
  subgraph ownerside["Owner"]
    con["console<br/>credit on Today<br/>top-up form"]
    mon["monitor<br/>e-mail and alert,<br/>as for other checks"]
  end
  subgraph screens["Screens · React"]
    dash["Dashboard<br/>banner while locked<br/>message on refusal"]
    card["Upload card<br/>Waiting for usage credits<br/>Not read by the AI"]
  end
  mig --> credit
  credit --> claude
  credit --> api
  credit --> health --> mon
  credit --> con
  queue --> read
  claude --> read
  probe --> credit
  api --> dash
  read --> card
  tests["Tests first: each rule<br/>then the whole server suite"]
  classDef new fill:#e8eefc,stroke:#3b5bab,color:#16295a
  class mig,credit new
```
