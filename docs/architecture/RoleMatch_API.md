# RoleMatch: how the API behaves

Mermaid source of each diagram, checked against the code on 10 November 2026. Paste a block into a Mermaid viewer to see it drawn.

## Every API request

```mermaid
flowchart TB
  subgraph s1["1 · Before sign-in"]
    direction LR
    req["Request<br/>HTTPS"] --> o{"Change from<br/>another site?"}
    o -->|yes| e0["403<br/>refused"]
    o -->|no| ip{"Too many from<br/>this address?"}
    ip -->|yes| e1["429<br/>wait"]
    ip -->|no| cl{"Page out<br/>of date?"}
    cl -->|yes| e2["426<br/>reload page"]
    cl -->|no| p1["passed"]
  end
  subgraph s2["2 · Who you are"]
    direction LR
    au{"Signed in?"} -->|no| e3["401<br/>sign in"]
    au -->|yes| pu{"Too many from<br/>this person?"}
    pu -->|yes| e4["429<br/>wait"]
    pu -->|no| po{"Member of<br/>this portal?"}
    po -->|no| e5["404<br/>as if absent"]
    po -->|yes| pl{"Portal and company<br/>within limits?"}
    pl -->|no| e6["429<br/>wait"]
    pl -->|yes| p2["passed"]
  end
  subgraph s3["3 · What you may do"]
    direction LR
    ro{"Role and edit<br/>policy allow it?"} -->|no| e7["403<br/>not allowed"]
    ro -->|yes| db["Database work<br/>under the company's<br/>row rules"]
    db --> ve{"Changed since<br/>it was loaded?"}
    ve -->|yes| e8["409<br/>reload, try again"]
    ve -->|no| ok["Done<br/>written to<br/>the audit log"]
  end
  subgraph s4["Also"]
    direction LR
    hm["Hiring manager:<br/>read only, sees<br/>shortlisted only"]
    down["Database down:<br/>sign-in paused<br/>uploads held, saved later<br/>other changes 503"]
    credit["WILL BE · out of credit:<br/>uploads, read-agains and<br/>new matches refused<br/>Out of usage credits"]
  end
  s1 --> s2 --> s3 --> s4
  classDef no fill:#fde2e1,stroke:#c0392b,color:#6b1a12
  classDef ok fill:#e3f4e8,stroke:#2e7d4f,color:#123d22
  classDef note fill:#f3f4f6,stroke:#9ca3af,color:#374151
  classDef change fill:#fff4d6,stroke:#c99a2e,color:#5a4200
  class e0,e1,e2,e3,e4,e5,e6,e7,e8 no
  class ok,p1,p2 ok
  class hm,down note
  class credit change
```

## How a match runs

```mermaid
flowchart LR
  press["Match pressed<br/>one job, or one CV<br/>against up to 50 jobs"] --> lim{"Within<br/>limits?"}
  lim -->|no| e1["429<br/>wait"]
  lim -->|yes| seen{"Scored before,<br/>unchanged?"}
  seen -->|yes| same["Saved score<br/>at once<br/>no AI, no cost"]
  seen -->|no| q["Scoring<br/>queued"]
  q -.->|Cancel| cancel["Stopped<br/>nothing spent"]
  q --> brief["Job brief<br/>Claude Sonnet<br/>once per job"]
  brief --> judge["Claude Sonnet<br/>judges the whole CV<br/>name, contacts hidden"]
  judge --> chk{"Code checks<br/>the answer"}
  chk -->|passes| final["Final score<br/>with evidence"]
  chk -->|fails| again["Asked once more<br/>problems named"]
  again --> chk2{"Passes<br/>now?"}
  chk2 -->|yes| final
  chk2 -->|no| ns["Not scored<br/>reason shown<br/>never a guess"]
  busy["AI too busy"] --> ns
  limits["Limits<br/>3,000 an hour per company<br/>6 at once per portal"] -.-> lim
  fair["At most 5 must-haves<br/>requirements quoted from the job<br/>protected characteristic:<br/>never scored"] -.-> brief
  states["Each requirement:<br/>verified · partial<br/>not demonstrated<br/>contradicted · not applicable<br/>with CV lines cited"] -.-> judge
  rules["Score 90+: every<br/>must-have verified<br/>80-89: one unshown at most,<br/>none contradicted"] -.-> chk
  keep["Kept until the CV<br/>or the job is edited"] -.-> final
  credit["TODAY · out of credit:<br/>queued, then Not scored<br/>WILL BE · out of credit:<br/>refused at once,<br/>Out of usage credits,<br/>unless already saved"] -.-> seen
  classDef ok fill:#e3f4e8,stroke:#2e7d4f,color:#123d22
  classDef no fill:#fde2e1,stroke:#c0392b,color:#6b1a12
  classDef ai fill:#e8eefc,stroke:#3b5bab,color:#16295a
  classDef note fill:#f3f4f6,stroke:#9ca3af,color:#374151
  classDef change fill:#fff4d6,stroke:#c99a2e,color:#5a4200
  class same,final,cancel ok
  class ns,e1 no
  class brief,judge ai
  class limits,fair,states,rules,keep note
  class credit change
```
