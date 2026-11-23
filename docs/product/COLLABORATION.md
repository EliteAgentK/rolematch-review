# People, portals and access: the rules as built (2026-10-30)

What the server enforces today (`server/src/team.ts`, `server/src/portals.ts`, `server/src/index.ts`), and what is still open. Every rule here is checked on the server; the screens only stop offering what would be refused.

## Roles
| Role | Where | May |
|---|---|---|
| Organisation administrator | organisation | settings, everyone's list (Settings, People), remove someone from the organisation, appoint a portal administrator in any portal, create portals, delegate portal creation |
| Portal administrator | one portal | members and invitations of that portal, role changes in it, remove someone from it, plus everything a recruiter may |
| Recruiter | one portal | upload, edit what the edit policy allows, review, match, batch actions |
| Hiring manager / HR | one portal | read-only, and among candidates sees only those shortlisted: the record, original CV and saved match. Anyone else answers as if they did not exist; moving someone off the shortlist ends sight of them on the next request. Jobs, the team, who is in the portal and the history stay visible, with file names of unshortlisted CVs hidden. Every change is refused (`403 PERM-READ-ONLY`), matching included, and any route not named in `server/src/hiringManager.ts` is refused. Still open: leaving the portal, and organisation-level actions that check their own organisation role |

Not built: a **summary-only oversight** role (counts without candidate or document access). The people list shows portals with member counts only, never their records.

## Safeguards
* **Last administrator.** A portal always keeps at least one administrator, and an organisation at least one organisation administrator. Role changes, leaving and removal check this under a row lock (the portal row, or the organisation row), so two administrators demoting each other at the same moment cannot both succeed (tested: exactly one of the two wins).
* **Recovery.** An organisation administrator can make any member an administrator of any portal (Settings, People, "Make administrator of…"). This grants membership only. It does not show the portal's records to the person doing it.
* **Leaving and removal.** These remove access at once on the server that handled them, and within the 10-second membership cache on others.
  - Records stay with the portal, under the name of whoever added them: candidates, jobs, documents, notes, history.
  - Batches the person was still sending are treated as abandoned transfers. Admitted files keep processing, and slots return by the usual rule; nothing is cancelled.
  - Leaving the organisation keeps the membership row, marked `left_at` (migration 023), because records refer to it. The sign-in identity remains with no organisation, and sign-in never sets that identity up again from its old sign-up details. Leaving one client grants nothing at another.
* **Audit.** Every change is recorded with who did it:
  - `portal.member_role_changed` (from, to)
  - `portal.member_left`
  - `portal.member_removed`
  - `org.member_left`
  - `org.member_removed`
  - `portal.admin_appointed`

## Signing in
* With one portal, the board opens it.
* With several and none chosen in this browser, a chooser lists each portal with the person's role in it.
* With none, the page says so and how to get access.
* A remembered choice for a portal the person has since left is forgotten before anything is loaded.
* Switching portals reloads the page, so nothing from the previous portal stays on screen.

## Names
Names are shown exactly as each person typed them at sign-up, as one field. RoleMatch does not split them into first name and surname. A split guessed from the text would be wrong for names such as "van der Merwe". Separate first-name and surname fields would need a sign-up change and a migration: not built.

## Still open
* The summary-only oversight role.
* Re-admitting a person who left: a new invitation cannot be accepted by an identity whose membership is marked as left. An administrator-assisted path is needed.
* Hand-over of a departing person's open batches to a colleague. Today they are left to finish on their own.
* An automated browser test of these screens. They were checked by hand on 2026-10-30 against a local server with invented accounts.
* The profile page (`src/pages/ProfilePage.jsx`) still uses browser-stored demo data. It is not connected to the account.
