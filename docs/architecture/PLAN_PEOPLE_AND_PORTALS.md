# People and portals (plan, 10 Nov 2026)

Owner, 10 Nov 2026: "I only want portal admin ... How am I going to be able to monitor all the portals and all the billing ... if it is not discussed.
People can't just create portals without speaking to us"; "people can decide with invites what they want people to be" (recruiters may not invite
administrators: "No, admins only"); a strict delete-account process; leaving a portal needs a hand-over by the last administrator; someone who left
comes back only with a new invitation. Deleted people "must be gone": the account, name and address go; their work stays with the portal, credited
to no one.

Diagram: [PEOPLE_AND_PORTALS_PLAN.svg](PEOPLE_AND_PORTALS_PLAN.svg) (source [.mmd](PEOPLE_AND_PORTALS_PLAN.mmd)), drawn from the code as it stands.

## TODAY (from the code)

- Two levels of administrator: an organisation administrator (members.role 'admin': Settings > People, remove someone from the organisation, create a
  portal, appoint a portal administrator) and a portal administrator (portal_members.role 'admin': invite, change roles, remove from the portal).
- Anyone may sign up (`SIGNUP_MODE` defaults to "open"): a company and its Main portal are created at once.
- Only administrators invite. Invitations are recorded (History > Invitations, audit portal.invited).
- The last administrator cannot leave a portal (LAST-ADMIN) and has to make someone else an administrator first, in another screen.
- Someone who left cannot get back in by signing in (team.test.ts). Leaving the organisation keeps the member row for attribution.
- An account cannot be deleted: documents, matches, batches and settings changes refer to the member with no rule for deletion.

## WILL BE

1. **One top role in a company: Portal administrator**, then Recruiter and Hiring manager. The organisation administrator role, Settings > People,
   creating a portal and appointing an administrator from the organisation go from the customer app (removed, with their routes and tests).
2. **Invitations only.** Open sign-up ends (`SIGNUP_MODE=invite` on live; the sign-up page explains it is by invitation). Whoever invites chooses the
   role: an administrator any role, a recruiter Recruiter or Hiring manager, a hiring manager Hiring manager. Every invitation stays recorded.
3. **Leaving a portal** asks the last administrator to choose who takes over, in the same step; the hand-over and the leaving happen together or not
   at all. Coming back needs a new invitation.
4. **Deleting your own account**, everyone, in steps: what goes and what stays; a hand-over if you are a portal's last administrator; your password;
   a code e-mailed to you; typing DELETE. Then the sign-in account, the member record, sessions and notifications go. The records you added stay with
   the portal, credited to no one (the database's references become empty, migration 044). History keeps the action, with no name.
5. **Your console** (console.rolematch.co.za): every company and portal with its people, documents and AI spend this month; create a portal (company,
   portal name, first administrator's address: the invitation goes out); delete a portal (type its name; every record and stored original in it goes;
   one audit line kept); delete any account. Only you can do these. Each portal's own Claude key and plan are the billing work that follows.

## Order of work

1. Migration 044: the references to a member become empty when the member goes (documents, matches, upload batches, settings and their history).
2. Server: invitation roles by the inviter's role; leave with a successor; delete account (steps 4); platform routes for the console (list, create,
   delete portal, delete account), behind the console's own token.
3. Customer app: Team panel (invite with role choices, hand-over on leaving), Settings > Account (delete), People and portal creation removed, sign-up
   by invitation.
4. Console pages: Companies and portals, Create a portal, Delete a portal, Delete an account.
5. Tests: each rule above, isolation between companies, a deleted account's work still in its portal, the strict steps refused out of order.
