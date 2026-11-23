# The points catalogue

Generated from `server/src/points.ts` by `npm run docs:points`; do not edit by hand. A test fails if this file and the data disagree.

108 points in 8 families: 44 are in the engine today, 43 are designed and planned, and 21 are never used.

**What a point is.** One thing a recruiter might look for. For each: where its evidence comes from, how it is judged, and what stops it being counted twice or unfairly disadvantaging a person.

**Kinds.** *scored* earns credit in the match arithmetic. *flag* is shown to a person (never zero, never a rejection). *shown* is a fact displayed, not scored (some facts are risky to score and are still worth seeing). *trust* changes how far the result can be trusted (confidence), not how good the person looks. *person* is recorded by a human, never inferred. *never used* is forbidden for every organisation.

**Never counting the same thing twice.** Credit depends on distinct evidence, never on counts of mentions. A word repeated a hundred times earns what it earns once; overlapping or duplicated roles count once; a requirement repeated in a job description is counted once; the same person in a second file is flagged, not merged. See [`MATCHING_MODEL.md`](MATCHING_MODEL.md), section 4.

## R. Requirement fit

What the job asks for, checked one demand at a time against the documents.

| Id | Point | Kind | Status | Evidence | How it is judged | Guard against double counting and unfairness |
|---|---|---|---|---|---|---|
| R01 | Mandatory skill or tool requirement | scored | implemented | CV text, split into described use and bare mention | Groups of alternatives (OR) joined by AND; each group earns the best alternative's credit; the requirement earns the mean of its groups. | A word repeated a hundred times earns what it earns once; a repeated requirement is counted once (R13). |
| R02 | Preferred skill or tool requirement | scored | implemented | As R01 | Same arithmetic as R01 with the lower preferred weight. | Same guards as R01. A preferred demand repeating a mandatory one carries no weight. |
| R03 | Mandatory years of experience in a subject | scored | implemented | Dated roles whose own text is about the subject | Credit rises in a straight line to the years asked for, then stops. Only roles sharing at least half the subject words, or using a skill the requirement names, count. | Overlapping and duplicated roles count once (union of months). More years than asked earn nothing extra here (see E07 for level). |
| R04 | Preferred years of experience | scored | implemented | As R03 | As R03 with the preferred weight. | Same guards as R03: overlapping and duplicated roles count once. |
| R05 | Qualification requirement (degree, diploma, field) | scored | implemented | The education list; completion status | A matching field earns full credit; a held qualification that needs judgement earns partial; none listed is an evidence gap, not a failure. | One credit per requirement however many qualifications are listed. |
| R06 | Professional registration or certification requirement | scored | implemented | Certifications, qualifications and work text naming the registration | A stated credential is the person's own claim: it earns partial credit until a person verifies it. | A certification and the skill it covers are separate demands; each can earn credit once. |
| R07 | Language requirement | scored | implemented | The languages list | Listed languages earn partial (fluency is self-reported); a language not listed is a gap, not a failure. | One credit per named language set. |
| R08 | Driver's licence or other licence class | flag | planned | Licences listed in the CV | Shown as met, stated or not shown; never zero. | Stated once, whatever the licence classes. |
| R09 | Location and work arrangement | shown | implemented | The job's arrangement and place; the candidate's town or city; explicit statements in the CV | Checked whenever a job is on-site or hybrid (or names a place) and shown as its own logistics line: compatible, to confirm, or a conflict to resolve. Never part of the alignment score (from rules 2.1.0). | Where a person lives says nothing about their ability and can stand in for race or income, so place never moves the score. A long distance is 'to confirm' (people move for jobs), never a mismatch. |
| R10 | Right to work in the country | flag | planned | Asked of the candidate in the application, never inferred from a name, an accent or origin | A yes or no the candidate states; shown to the recruiter as a flag. | Never derived from the CV. Where a person comes from is forbidden as an input (X04). |
| R11 | Security vetting or clearance requirement | flag | planned | A lawful vetting step run by a person | Shown as pending, passed or failed by a person. | Recorded by a person (H07); never inferred from a CV. |
| R12 | Salary band and notice period | shown | planned | Stated by the candidate in the application | Shown beside the job's band; never scored. | Asked, not inferred. Never used to rank. |
| R13 | Duplicate demand merge | trust | implemented | The job's own requirements | Two requirements with the same skills and years are counted once; the repeat is shown with no weight. | Stops a job description inflating a demand by repeating it, and stops a repeat outranking the original. |
| R14 | Mandatory requirement not yet shown | flag | implemented | The result of R01 to R07 | Raises the flag 'verify N mandatory requirements before progression'. It never sets a score to zero and never rejects. | Absence from a CV is not proof of absence. |
| R15 | Requirement the engine cannot check | shown | implemented | Requirements with no skill, years, degree, credential or language in them | Shown as 'needs recruiter judgement' with related wording if any. | Never scored as met or failed. |
| R16 | Explicit contradiction of a mandatory requirement | scored | implemented | A clear statement in the CV: today, a qualification stated as not completed against a requirement for it | Credit 0 and the state 'contradicted'; a mandatory contradiction caps the score at 40 and asks for review. A requirement that accepts an equivalent is never contradicted this way. | Only the document's own words, quoted; absence is never a contradiction. It asks a person to confirm: CVs go out of date. |
| R17 | Requirement wording review | shown | implemented | The wording of each job requirement against a versioned list (age, sex, family, health, language, origin, religion, appearance; licences and record checks; vague or excessive wording) | Shown as a notice on the job and on each match row for a recruiter to keep, reword or remove. | Never removes, rewrites or down-weights a requirement on its own; a flag is not a legal finding. |

## E. Experience

How much, how recent, how broad and at what level the person has done the work.

| Id | Point | Kind | Status | Evidence | How it is judged | Guard against double counting and unfairness |
|---|---|---|---|---|---|---|
| E01 | Relevant dated years | scored | implemented | Roles with dates, relevant by R03 | The same measure as R03, shown as years and as a share of the requirement. | Union of months: two overlapping roles never add. |
| E02 | Recency of last use | shown | implemented | The latest dated role whose text describes the skill or the subject | Shown as 'last shown in use: year' when that is at least 5 years before the reference date. Not scored: whether it should weigh is decided from recruiter data. | A career break is not a penalty; recency is never inferred from undated roles. |
| E03 | Breadth of use | scored | planned | Distinct roles or projects that describe using the skill | Credit rises with the number of distinct roles, with a cap. | Counts distinct roles, never mentions; repeating a skill within a role adds nothing. |
| E04 | Depth of use | shown | planned | Verbs and scope words beside the skill (designed, owned, led, maintained) | Shown as a label next to the evidence; not scored until validated. | A wording quirk of the CV author must not decide a score. |
| E05 | Industry or domain match | scored | planned | Employer type and responsibilities against the job's domain | Partial credit for adjacent domains from a versioned table. | A domain table is data with a version and a source, never a hidden judgement. |
| E06 | Company size or type match | shown | planned | Employer descriptions | Shown when stated. | Never scored: large and small employers are not better or worse. |
| E07 | Level fit (junior to head of) | scored | planned | Job title level against the candidate's evidenced years and titles | An explicit requirement with a stated table (for example senior means five years or more of relevant work). | Read from the title as a visible requirement, not a hidden multiplier; titles are not inflated by repetition. |
| E08 | People management span | shown | planned | A stated team size or reports | Shown when the job asks for leadership. | Stated figures only; never estimated. |
| E09 | Budget or revenue responsibility | shown | planned | A stated amount or scope | Shown when the job asks for it. | Stated figures only. |
| E10 | Scale of delivery | shown | planned | Stated users, volumes, projects delivered | Shown beside the role. | Numbers must appear in the document; none are invented. |
| E11 | Quantified achievements | shown | planned | Numbers with units in role descriptions | Shown as a count and listed; not scored. | Unverified claims are claims; a number earns nothing by itself. |
| E12 | Progression within an employer | shown | planned | Successive titles at one employer with dates | Shown as a dated sequence, in the person's own words. | A fact, not a multiplier: promotion speed carries bias (E13). |
| E13 | Tenure per role | shown | planned | Role dates | Shown as dated facts. | Not scored: short tenures have many innocent causes, and 'job hopping' penalties disadvantage contract workers and people in unstable industries. |
| E14 | Gaps between roles | shown | planned | Role dates | Shown as dated facts only if a recruiter asks. | Never scored and never summarised as a judgement: gaps fall disproportionately on carers and people who were ill. |
| E15 | Contract, freelance and self-employed years | scored | implemented | Roles marked as such | Count as experience exactly like employed years. | No discount for the form of employment. |
| E16 | Internships, volunteering and unpaid work | scored | planned | Roles marked as such | Count when relevant to the requirement, labelled as such. | Counted by relevance to the subject, not by status. |
| E17 | Career change evidence | shown | planned | Courses or projects in a new field beside a role in another | Shown as context. | Not scored; it explains an evidence gap rather than closing it. |
| E18 | Hands-on versus management work | shown | planned | Role text describing doing versus directing | Shown as a label when a requirement is about hands-on work. | Describes the evidence; never ranks one type of person above another. |
| E19 | Level the job title implies | shown | implemented | Level words in the job title (junior to head of) beside the candidate's related years and latest title | Shown as context with the evidence. Not scored until a level table is agreed from recruiter data (E07). | Describes; never a multiplier. Years beyond a requirement earn nothing extra, and the level note does not change that. |

## Q. Qualifications

Formal education, professional registration and certification.

| Id | Point | Kind | Status | Evidence | How it is judged | Guard against double counting and unfairness |
|---|---|---|---|---|---|---|
| Q01 | Highest qualification level | scored | implemented | Education entries mapped to NQF levels and normal lengths by the capability graph | A qualification below the level a requirement states does not meet it; a trade or school credential meets only the same credential (rules 2.2.0). | Counted once per requirement; the best qualification only. |
| Q02 | Field of study relevance | scored | implemented | The qualification's knowledge profile (majors stated, else the programme's draft profile) against the knowledge the required field needs | Credit is multiplied by the share of the field's knowledge covered at the depth needed. A field nobody has approved a list for ('any relevant degree') earns half the proved credit, the rest stays possible (rules 2.2.0). | One credit per requirement; a degree's field is never read as a skill. |
| Q03 | Completed or not completed | scored | implemented | Status read from the education entry and the words that support it | The capability graph's completion ladder: stated or implied completed, full credit; dates that fit the normal length, three quarters; a year only, half; not stated, in progress or shorter than normal, nothing yet (the ceiling stays open, with a question to ask); stated as not completed, contradicted (R16) unless equivalent experience is accepted. | A past year is never full proof of completion; every verdict lists what to verify and ask (rules 2.2.0). |
| Q04 | Institution recognition | shown | planned | SAQA registration or foreign-qualification evaluation status | Shown when known. | Never ranks institutions: prestige is a proxy for background (X14). |
| Q05 | Professional body membership | scored | implemented | Designations named (CA(SA), Pr.Eng, Pr.Tech, CFA, ACCA, CIMA, PMP, SAIPA, CCNA, CISA, CISSP); registration numbers are not yet read or checked | A stated designation earns partial (named) credit until verified with the body; 'in progress' or 'working towards' earns nothing yet (rules 2.2.0). | A registration and the skills it covers are credited separately. |
| Q06 | Vendor certifications and their validity | scored | planned | Certificates with dates and expiry | Valid earns full partial credit; expired is shown as expired. | One certification, one credit; an expiry date is a fact, not a penalty. |
| Q07 | Matric subjects and endorsement | scored | planned | School results listed | Only for roles that state a school-level requirement. | Entry-level roles only. |
| Q08 | Short courses and training | shown | planned | Courses listed | Shown; credit only where a requirement names the course content. | Course count never adds credit. |
| Q09 | Continuing professional development | shown | planned | CPD hours stated | Shown when a body requires it. | Stated figures only. |
| Q10 | Honours and distinctions | shown | planned | Awards listed | Shown. | Not scored. |

## S. Skills

Tools, methods and capabilities, and how firmly the documents show them.

| Id | Point | Kind | Status | Evidence | How it is judged | Guard against double counting and unfairness |
|---|---|---|---|---|---|---|
| S01 | Hard skill coverage | scored | implemented | The versioned skill dictionary applied to the job and the CV | See R01. Whole-word matching, so Java never matches JavaScript. | One credit per distinct skill per requirement group. |
| S02 | Named but not described in use | scored | implemented | A skill named in a skills list, the profile summary, a certificate or qualification title, or in a role line too short to say what was done (fewer than two content words besides skill names and empty words, such as 'Did SEO.') | Partial credit (half), and the result says why. | A name earns the same however many times or places it appears; a summary or a bare line cannot claim described use (rules 2.1.0, 2.2.0). |
| S03 | Tool version or edition specificity | shown | planned | Versions named (for example Python 3, SQL Server 2019) | Shown when a requirement names a version. | Never inferred. |
| S04 | Skill adjacency | shown | planned | A versioned table of related skills (Kubernetes and Docker) | Used only to suggest where to look; it earns no credit. | Related is not equal; an adjacency can never create a 'verified'. |
| S05 | Soft skills evidenced by behaviour | shown | planned | Described actions (mentored, negotiated, presented) | Shown as evidence lines. | Self-description ('team player') earns nothing; low weight if ever scored. |
| S06 | Skill shown only in a certification | scored | implemented | A certificate title naming the skill | Partial credit, as S02. | Not added to credit from described use of the same skill: one level per skill, the best one. |
| S07 | Skill shown in projects or open work | scored | planned | Project descriptions | Counts as described use when the person's own role is stated. | A project listed twice counts once. |
| S08 | Recency-weighted skill | scored | planned | Dates of the roles that use the skill | To be decided from recruiter data, never assumed. | Replaces nothing until validated in shadow. |
| S09 | Unrecognised terms | trust | implemented | Words in a requirement outside the dictionary | The requirement falls back to related wording or 'needs recruiter judgement'. | Never guessed: the dictionary grows by a reviewed, versioned change. |
| S10 | Skill claimed beyond the evidence | trust | planned | A long skills list with no described use of most of it | Lowers confidence in the skills list, not the candidate. | Only the proportion matters, never the length. |

## F. Practical fit

Place, hours, availability: facts that decide whether a hire can happen at all.

| Id | Point | Kind | Status | Evidence | How it is judged | Guard against double counting and unfairness |
|---|---|---|---|---|---|---|
| F01 | Commutable location | shown | implemented | The level at which the job's place and the candidate's match (F09) | Same city or same province: compatible (confirm the commute); another province or country: to confirm. | Shown on the logistics line (R09), never scored; counted once there. |
| F02 | Remote or hybrid compatibility | shown | implemented | The job's work-arrangement field and location line | A remote job has no logistics check; on-site and hybrid jobs do. | Stated arrangements only; never part of the score. |
| F03 | Willingness to relocate | shown | implemented | An explicit statement in the CV ('willing to relocate'); later, a question in the application | A stated willingness turns a distance into 'compatible, confirm it'. | The candidate's own words, quoted; never inferred. |
| F04 | Availability and notice | shown | planned | Stated by the candidate | Shown. | Never scored. |
| F05 | Salary expectation overlap | shown | planned | Stated by the candidate | Shown beside the band. | Never scored. |
| F06 | Working hours and shifts | shown | planned | Job text and candidate answers | Shown when the job has fixed hours. | Asked, not inferred. |
| F07 | Travel requirement | shown | planned | Job text and candidate answers | Shown. | Asked, not inferred. |
| F08 | Language of work | scored | implemented | The languages list (see R07) | Judged exactly as R07. | Counted once, together with R07, never again under a separate heading. |
| F09 | City, province and country of the job and the candidate | shown | implemented | A local place table (no outside mapping service): towns and business districts with their city and province, the nine provinces, and common countries | Compared by level: same city, same province, same country, another country, or unknown. | Unknown places stay unknown, never guessed; street addresses and postal codes are never used (X13). Never scored. |
| F10 | Stated work-arrangement conflict | shown | implemented | An explicit statement such as 'remote only' against an on-site or hybrid job | Shown as a conflict to resolve with the candidate, quoted. | Preferences change: it asks a person to confirm and never lowers the score. |
| F11 | Job work location present | shown | implemented | The job's location field | An on-site or hybrid job with no location, one that cannot be placed, or one with no town or city shows a notice on the job. | A notice, never a block: the job can still be uploaded and opened. |

## I. Evidence integrity

How far the result can be trusted. These change confidence, never how impressive the person looks.

| Id | Point | Kind | Status | Evidence | How it is judged | Guard against double counting and unfairness |
|---|---|---|---|---|---|---|
| I01 | Extraction quality | trust | implemented | How completely the document was read | Scales confidence; a badly read document cannot give firm evidence. | Measures the reading, not the person. |
| I02 | Evidence range | trust | implemented | The gap between what is proved and what is possible | Confidence is one minus its width. | A short CV gets a wide range, not a low score. |
| I03 | Job requirements approved | trust | implemented | Whether a recruiter approved the requirements | An unapproved job lowers confidence. | The job's own reading may be wrong; the candidate is unaffected. |
| I04 | Date plausibility | trust | planned | Role and education dates | Overlaps, future dates and impossible spans lower confidence and are listed. | Shown as facts; never as an accusation. |
| I05 | Duplicate requirement | trust | implemented | See R13 | See R13. | See R13. |
| I06 | Possible duplicate candidate | trust | implemented | Same email, phone or name across records in one organisation | A review reason naming the existing record; nothing is merged. | A person decides; a name alone is only 'possible'. |
| I07 | Repetition resilience | trust | implemented | Repeated words, skills, sentences and whole roles | Repetition earns nothing extra; tested on every release. | Credit depends on distinct evidence, never on counts of mentions. |
| I08 | Hidden or injected text | trust | implemented | Text a person cannot see, in PDF and Word files | Left out of the evidence and flagged for review. | Stops instructions aimed at a reader from affecting the record. |
| I09 | OCR reading quality | trust | implemented | Image-based documents | Weak reads are flagged; unreadable ones are refused with a reason. | Never silently repaired. |
| I10 | Internal contradictions | trust | planned | A CV that disagrees with itself (dates, titles, claims) | Listed for a person; lowers confidence. | Never treated as dishonesty. |
| I11 | Claim verifiability | trust | planned | Whether a claim can be checked (a registration number, a named referee) | Shown beside the claim. | A claim without a check is a claim, not a failing. |
| I12 | Reproducibility | trust | implemented | The rules version, a fingerprint of the rules and skill dictionary, the record versions and the reference date used for 'Present' | Every stored match records them, so identical inputs can be shown to give identical results. | A fixed total order breaks all ties (compareRank). |
| I13 | Evidence coverage | trust | implemented | Which parts of each requirement the documents say anything about | The share of the job's requirement weight with any evidence (described, listed or some relevant years), shown beside the score. | Measures the documents, not the person; separate from the score and from confidence. |

## H. Human process

Things only a person can record. Never inferred, never scored automatically.

| Id | Point | Kind | Status | Evidence | How it is judged | Guard against double counting and unfairness |
|---|---|---|---|---|---|---|
| H01 | Review state | person | implemented | A recruiter's confirmation | Cleared only by a person, with who and when. | Never inferred from the score. |
| H02 | Workflow status | person | implemented | A recruiter's choice from the organisation's statuses | Set only by a person; audited. | The platform never moves a candidate. |
| H03 | Interview outcome | person | planned | Structured notes from the interviewer | Recorded; shown beside the match; not part of the score. | Kept apart from the document-based score so one cannot launder the other. |
| H04 | Reference check | person | planned | A referee's answers, entered by a person | Recorded; closes the matching claim-verifiability flag (I11). | Entered by a person only. |
| H05 | Assessment result | person | planned | A test the candidate took | Recorded; shown; never mixed into the document score. | A different instrument with its own validity. |
| H06 | Recruiter override with reason | person | planned | A person disagreeing with a point, with a written reason | Recorded and audited; the original result stays. | Never overwrites the stored evidence. |
| H07 | Vetting outcome | person | planned | A lawful vetting step | Recorded by a person. | Never inferred. |
| H08 | Hiring decision | person | never | A person | Not a platform function. | The platform recommends for human review and nothing more. |

## X. Forbidden inputs

Never used, in any form, for any organisation, however a request is worded.

| Id | Point | Kind | Status | Evidence | How it is judged | Guard against double counting and unfairness |
|---|---|---|---|---|---|---|
| X01 | Age or date of birth | never used | never | A date of birth or any age statement | Never read into any score or filter. | Ages are also not derived from dates (X15). |
| X02 | Gender or sex | never used | never | Stated or inferred from a name or photo | Never an input. | Equity reporting is a separate, voluntary self-declaration (X20). |
| X03 | Race, ethnicity or the ethnicity of a name | never used | never | Stated or inferred | Never an input. | As X02. |
| X04 | Nationality, citizenship or accent | never used | never | Stated or inferred | Never an input. | Right to work is a stated yes or no (R10), not nationality. |
| X05 | Religion or belief | never used | never | Stated or inferred | Never an input. | — |
| X06 | Marital, family or pregnancy status | never used | never | Stated or inferred | Never an input. | — |
| X07 | Disability or health | never used | never | Stated or inferred | Never an input. | Adjustments are handled by a person on request. |
| X08 | Photograph or appearance | never used | never | An image in the document | Never read; photos are never an input. | Photos are ignored by the reader. |
| X09 | Name, its length or its origin | never used | never | The candidate's name | Used to identify a record, never to judge it. | Test: changing the name leaves every score unchanged. |
| X10 | Email, phone or other contact details as signals | never used | never | Contact fields | Used to reach a person and to spot duplicates (I06), never to judge. | Test: changing them leaves every score unchanged. |
| X11 | Spelling, grammar or CV design | never used | never | The document's surface | Never scored: they track language background and access to help, not ability. | The reader repairs reading errors; it never penalises writing. |
| X12 | Social media and online presence | never used | never | Profiles and posts | Never collected for scoring. | — |
| X13 | Residential suburb or postal code as a proxy | never used | never | Address details | Town, city or business district only, and only for the logistics line (R09); never scored. | Prevents place from standing in for race or income. |
| X14 | Institution prestige ranking | never used | never | A ranking of schools or employers | Never an input. | Prestige is a proxy for background; what was done is judged, not where. |
| X15 | Graduation or start year used to infer age | never used | never | Education dates | Dates are used for years of experience only. | No age is ever computed. |
| X16 | Criminal record, credit history, union membership, political affiliation, sexual orientation | never used | never | Stated or inferred | Never an input. A lawful vetting step, if a job needs one, is run and recorded by a person (H07). | — |
| X17 | Identity or ID number | never used | never | A national ID number | Never an input; it encodes age and gender. | Not read into the record's scored fields. |
| X18 | Candidate rating or star score | never used | never | A manual rating | Never an input to the match. | Test: changing the rating leaves every score unchanged. |
| X19 | Employment gaps as a penalty | never used | never | Role dates | May be displayed as dates (E14), never penalised. | — |
| X20 | Employment-equity categories | never used | never | A voluntary self-declaration kept apart | Never in the score. Used only for the employer's lawful reporting under its own plan. | Stored apart from the match, access limited, collected from the candidate rather than read from a CV. |
