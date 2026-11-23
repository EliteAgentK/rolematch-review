# Plan: job descriptions read by AI

Not built. Measured 10 Nov 2026 on 9 job descriptions (server/test/collection/aiJobReadEval.ts, commit 8d984e8): the reader refused 1, Claude Haiku read all 9 with the right title, 321 quoted values checked and all found, median 6.3 s, $0.0014 a job; the Sonnet brief live already writes costs $0.062 a job, median 27.8 s.

## Jobs read by AI: today and will be

```mermaid
flowchart LR
  up["Job uploaded<br/>Processing"] --> file["File checks<br/>and text out<br/>PDF · Word · OCR<br/>kept as today"]
  file --> today{"TODAY<br/>reader's word rules<br/>find a title?"}
  today -->|no| rej["Rejected<br/>TITLE_UNRESOLVED<br/>1 of 9 measured"]
  today -->|yes| pubT["Job published<br/>from the rules"]
  file --> will["WILL BE<br/>Claude Haiku reads<br/>the whole job<br/>median 6.3 s<br/>$0.0014"]
  will --> chk{"Code checks<br/>every value is<br/>in the document"}
  chk -->|"all found<br/>321 of 321 measured"| pubW["Job published<br/>title, company, place,<br/>pay, duties,<br/>requirements"]
  chk -->|"a value not found"| drop["That value dropped<br/>and counted"]
  drop --> pubW
  pubT --> brief["Claude Sonnet brief<br/>for matching<br/>as today, background<br/>median 27.8 s · $0.062"]
  pubW --> brief
  brief --> ready["Ready for Match"]
  classDef bad fill:#fde2e1,stroke:#c0392b,color:#6b1a12
  classDef good fill:#e3f4e8,stroke:#2e7d4f,color:#123d22
  classDef ai fill:#e8eefc,stroke:#3b5bab,color:#16295a
  classDef old fill:#f3f4f6,stroke:#9ca3af,color:#6b7280
  class rej bad
  class pubW,ready good
  class will,brief ai
  class today,pubT old
```

## Jobs read by AI: when something goes wrong

```mermaid
flowchart LR
  ai{"Claude reads<br/>the job"} -->|answers| t{"Title found<br/>in the document?"}
  t -->|yes| pub["Job published"]
  t -->|no| ask["Card: Needs a title<br/>recruiter types it<br/>change audited"]
  ask --> pub
  ai -->|"fails twice"| nr["Card: Not read by the AI<br/>reason shown · Retry"]
  nr -->|Retry| ai
  ai -->|"out of credit"| wc["Card: Waiting for<br/>usage credits<br/>carries on by itself"]
  wc -->|"credit back"| ai
  ai -->|"AI queue full"| wq["Card: Waiting for the AI<br/>checks every minute"]
  wq -->|"room"| ai
  note["Never rejected without a reason<br/>Never published from word rules<br/>Every refusal shown on the board,<br/>single upload or batch"]
  classDef good fill:#e3f4e8,stroke:#2e7d4f,color:#123d22
  classDef warn fill:#fff4d6,stroke:#c99a2e,color:#5a4200
  classDef bad fill:#fde2e1,stroke:#c0392b,color:#6b1a12
  classDef n fill:#f3f4f6,stroke:#9ca3af,color:#374151
  class pub good
  class ask,wc,wq warn
  class nr bad
  class note n
```

## Jobs read by AI: where in the code

```mermaid
flowchart LR
  subgraph newcode["New"]
    jr["jobReader.ts<br/>Haiku prompt, versioned<br/>every value quoted<br/>code checks each quote"]
  end
  subgraph change["Changed"]
    pipe["pipeline.ts<br/>a job waits for the AI<br/>like a CV, then published"]
    again["jobReadAgain.ts<br/>Read again asks Claude<br/>recruiter's corrections kept"]
    screens["Screens<br/>Needs a title card<br/>refusals always shown<br/>Waiting labels"]
    tests["Tests<br/>fake Claude server<br/>no credits spent<br/>9 measured jobs re-run"]
  end
  subgraph removed["Removed completely"]
    rules["rules.ts job reading<br/>parseJob, job headers,<br/>job sections"]
    ext["extract.ts extractJob<br/>prepare.ts job branch"]
  end
  subgraph kept["Kept"]
    files["File checks, text,<br/>OCR, hidden text flags"]
    review["reviewJob<br/>checks the AI's record"]
    brief["Sonnet brief<br/>for matching"]
  end
  jr --> pipe
  jr --> again
  pipe --> screens
  files --> jr
  jr --> review
  pipe --> brief
  classDef n fill:#e8eefc,stroke:#3b5bab,color:#16295a
  classDef r fill:#fde2e1,stroke:#c0392b,color:#6b1a12
  classDef k fill:#e3f4e8,stroke:#2e7d4f,color:#123d22
  class jr n
  class rules,ext r
  class files,review,brief k
```
