# Score v3: five parts of the job, not one long list (rules 3.0.0, planned 8 Nov 2026, before code)

**Owner, 8 Nov 2026:** "the matching should just be based on the job, years, qualifications, location if necessary and just overall what they do or did … and of course relevant skills, but just because there's one that's missing or misunderstood or there's no show of used skill, you knock them down so much … please be very clever with matching but also be strict and fair."

**What was wrong (measured):** rules 2.x averaged every requirement line with equal standing. A job description is mostly skill lines, so the score was mostly a skills checklist: a skill only listed earned half credit, a skill not mentioned earned none, and each such line moved the score by as much as the role itself. A Head of Centre of Excellence scored 13% for a Head of Centre of Excellence role (2.11.0 brought it to 63% by reading the CV's own words; this change addresses the weighting itself).

```
                      ┌──────────── the job ─────────────┐
                      │ title · responsibilities · reqs  │
                      └──────────────┬───────────────────┘
        ┌──────────────┬─────────────┼──────────────┬────────────────┐
        ▼              ▼             ▼              ▼                ▼
   Role fit 35%   Experience 20%  Skills and     Qualifications   Location
   title closeness  relevant years requirements  15%              (shown beside,
   + the job's      against years  30%            only if the job  not scored;
   responsibilities asked          each line as   asks for one     logistics.ts)
   met by described                before; a
   work                            listed skill
                                   counts 0.8
        └──────────────┴─────────────┼──────────────┘
                                     ▼
              weighted mean of the parts the job has (a part the job does not
              ask about passes its share to the others, in proportion)
                                     ▼
              contradicted mandatory requirement → capped at 40 (unchanged)
                                     ▼
                         score, with floor and ceiling as before
```

**Rules:**
1. **Role fit** = half title closeness (the job title's own words found in the titles of the candidate's dated roles; level and recency stay context, never scored, as before) and half the share of the job's responsibilities the CV's described work covers (the 2.11.0 word check). With no responsibilities listed, title closeness alone.
2. **Experience** = the years requirements as judged today. With no years asked, the part is absent and passes its share on.
3. **Skills and requirements** = every other requirement line as judged today, mandatory weighted above preferred as before. **A skill the CV names without describing its use earns 0.8 (was 0.5).** A skill not mentioned still earns 0: absence is not proof, and it is not credit either.
4. **Qualifications** = degree, diploma and certificate requirements as judged today. Absent if the job asks for none.
5. **Location** stays a separate answer beside the score (unchanged): "if necessary" is exactly what logistics already reports.
6. **Strict and fair:** a contradicted mandatory requirement still caps the score at 40; nothing not mentioned is counted as met; one gap moves only its part. In a ten-skill job, one missing skill now costs about 3 points instead of about 10.
7. All shares and the 0.8 are in `server/src/ruleset.ts`, versioned (3.0.0) and fingerprinted with every result.

**Acceptance (fixed before results):**
- On the Centre of Excellence job, the Head of Centre of Excellence ranks first, and the gap to the second is not smaller than under 2.11.0 (63 against 40).
- Every invariance and honesty test of the engine still holds: reordering and repeating lines change nothing; the candidate who says a degree was not completed ranks below the one who says nothing; a contradicted mandatory caps at 40; nothing is relative to the pool.
- Numbers pinned by earlier versions are updated only with the reason written beside them.

**Decision class:** a change to scoring policy, directed by the owner on 8 Nov 2026; the weights are Claude's proposal under that direction, recorded here and changeable in one place.
