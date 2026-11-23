# Which method reads which field

The system and the language model read a CV together. Each field keeps to the method that measured better on the 30 real CVs (`server/data/real-cvs`, private). The answers those were scored against were written by Claude from operating-system text and rendered pages, apart from name, email and phone on 21 documents, which a person checked. They are provisional. These CVs were also used to find the faults, so they are development documents and none of this is an unseen test.

| Field | Primary method | Why | Code |
|---|---|---|---|
| Name, email, phone | Identity reader; the model only for what it could not settle, on the opening lines, and only values in the document with the right shape | Rules: 0 wrong names. An agency's details are removed from the candidate's by comparing with what both readers saw of the agency | `docmodel/identity.ts`, `hybridReader.contactFromModel`, `reconcile.mergeReading` |
| Contact details in a picture | OCR of page one, when the text lacks them | The file holds no text for a designer's sidebar | `visibility.contactsInPictures` |
| Agency | Identity reader, then the model | Rules 14 of 14, model 12 of 14 with 1 wrong | `docmodel/identity.ts` |
| Location | Model; rules only where they name a known place | Rules 53% with 5 wrong ("Black, Male", "Cell"); model 87% | `reconcile.mergeReading` |
| Roles: title, employer, dates | Model, checked by code | Rules 55% fully right, together 84% | `hybridReader`, `modelReader`, `reconcile.reconcileRoles` |
| Duties | The document's lines beneath the role | The model names where a role is; the document says what was done | `hybridReader.dutiesBelow` |
| Education | Model | Precision 37% to 82%, recall 72% to 84% | `reconcile.mergeReading` |
| Skills | Model; rules only for skills the platform knows | The rules also pick up letterheads and names | `reconcile.mergeReading` |
| Certificates, languages | Both, each held to the document | Recall 48% to 83%, 57% to 100% | `reconcile.mergeReading` |
| Years of experience | Worked out from settled roles | Never left over from an earlier reading | `reconcile.mergeReading`, `match.buildCtx` |

## What code checks before anything is believed

1. Schema, in the model call. An answer cut short is asked once more with room; a failed call never becomes a complete record.
2. Every value is in the document. A line written to software never reaches the model.
3. The document holds each role's start date, title and employer together, within a few lines of each other, and no line dates that title differently (`locateRole`). The model's line numbers are a hint.
4. A title or employer is a name: not cells run together, a sentence or a phone number. A role told only in a sentence goes to a person, since an instruction printed in a CV reads the same way.
5. Date ranges nothing accounts for are found (`unaccountedDates`). Those places, and roles that fail 3, go back to the model as that region alone, up to `maxRegions`.
6. What stays unresolved is marked, not hidden: the role is `uncertain`, and earns no years. Without a date, it stays apart as competing evidence.

## Where it stands: the four states

`supported`, `uncertain`, `conflicting`, `not evidenced` (`types.FactState`). Absence from a readable document is a different thing from a document that could not be read. When uncertain work history decides a mandatory or weighty requirement that is not already met, the match returns **Assessment incomplete** (`match.assessmentOf`): no percentage on screen, listed after the ranked results in a fixed order, candidate still visible, and **Review CV evidence** shows the document's own lines. A person's answer is audited, keeps what was read, and runs the matches again.
