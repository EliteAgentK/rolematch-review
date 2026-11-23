# CV reading contract (10 Nov 2026)

What every field of a candidate's panel is, where it may come from, its form, and what the panel shows when the CV does not say. Claude reads every CV
to this contract (`docs/architecture/PLAN_CV_READING_CLAUDE_ONLY.md`); code holds each value to it, and the schema allows nothing else. The same CV
read twice gives the same record. A change to this contract is a new reader version, measured on the 50 documents before release.

## How a CV is read

1. The file's text is numbered line by line (`readerInput`), exactly as for a job description.
2. **Every line gets one label** (below). A line is never left without a label, so nothing can quietly disappear. Claude answers as runs of lines ("8-12 duty"); a line it passed over is asked about once, by number, and one still unlabelled is `other`, and counted.
3. **Every value cites the lines it came from, and those lines must carry a label the field allows** (the "From lines labelled" column). A value
   whose lines carry another label is refused, and so is a value whose words are not on its lines.
4. Code then makes the structural checks (below) and builds the record. Nothing is guessed: a field the CV does not give stays empty and says so.

## Line labels

| Label | A line that is |
| --- | --- |
| `personal` | the person's own name, email, phone, address or location, ID-free personal details |
| `headline` | the title or position the CV presents the person for, at its top or as "position applied for" |
| `job_title` | a job's title |
| `employer` | the company or organisation a job was held at |
| `job_dates` | a job's period of employment |
| `duty` | what was done or achieved in a job |
| `education` | a degree, diploma or school-leaving qualification, its institution or its dates |
| `certificate` | a certificate, licence, short course or training, its issuer or its dates |
| `skill` | a skill or tool, or a list of them |
| `language` | a language the person speaks |
| `summary` | the CV's own profile or summary of the person |
| `project` | a project described apart from a job |
| `notable` | an award, achievement, publication, board membership, voluntary or community role listed apart from a job |
| `agency` | a recruitment agency presenting the CV, its consultant and their contact details |
| `referee` | a referee and their details |
| `heading` | a section heading |
| `other` | anything else (page numbers, footers, form labels, revision codes); counted in the reading's report |

## Fields

| Field | What it is | From lines labelled | Form | When the CV does not say |
| --- | --- | --- | --- | --- |
| Name | the person's full name | `personal` | as written, normal capitals | "Name not confirmed" |
| Email | the person's own address | `personal` | as written | "No e-mail address in the CV" |
| Phone | the person's own number, 9 to 12 digits | `personal` | as written | "No phone number in the CV" |
| Location | where the person lives | `personal` | as written; never an employer's or agency's address | empty |
| Headline | what the CV presents the person as | `headline`, else the latest `job_title` | as written, normal capitals | the latest job's title |
| Jobs | every job held, newest first | `job_title`, `employer`, `job_dates` | title, employer, start and end as printed ("June 2012", "Present"); one entry per job, however often it is listed | "No work history in the CV" |
| A job's duties | what was done in that job | `duty`, beneath that job | each as written | none listed |
| Education | each degree, diploma or school-leaving qualification | `education` | qualification, institution, year as printed, and whether completed, from the CV's own words | "No education in the CV" |
| Certificates | each certificate, licence, short course or training | `certificate` | name, issuer, date as printed | none listed |
| Skills | each skill or tool | `skill`, or named in a `duty` | one per item, as written, never a sentence; a programming language is a skill | none listed |
| Languages | each language spoken | `language` | the language's name | none listed |
| Summary | a short career summary | `summary`, `job_title`, `duty` | at most two sentences, the CV's facts only, no pronouns | none |
| Projects | each project described apart from a job | `project` | the CV's own lines | none listed |
| Worth noting | awards, achievements, publications, board memberships, voluntary roles | `notable` | the CV's own lines; a line has one label, so nothing shown elsewhere is repeated here | "Nothing further noted in this CV." |
| Agency | the agency presenting the CV | `agency` | agency, consultant, their email and phone; never the candidate's | none |
| Department | the standard department of the person's work | the headline and latest jobs | one of `JOB_DEPARTMENTS` | "Not grouped yet" |
| Years of experience | worked out by the platform from the dated jobs | (code, not Claude) | whole years | not shown |
| Uploaded | when the CV was uploaded | (the platform, not the CV) | "Uploaded 10 Nov", the exact time on hover | always shown |

## Structural checks (code, never word lists)

- A job needs a title line and a dates line labelled as such; a line labelled `certificate` or `education` can never be part of a job.
- Duties belong to the job above them, up to the next job.
- The same job listed twice (a summary table, then its description: same title or employer and start year) is one job.
- A date range on a line that no job, education entry or certificate accounts for is flagged in the reading's report.
- A value at the format's length limit, or ending in a cut mark, is shortened to where the document holds it whole.
- Contact details found only on `agency` or `referee` lines are never the candidate's.

## Settings and consistency

- One model, effort and strict schema for every CV; the prompt is versioned (`READER_PROMPT_VERSION`) and every change is measured on the 50
  documents (`test/collection/threeWay.ts`) before release.
- Each document read twice must give the same value for at least 95% of fields, reported field by field.
