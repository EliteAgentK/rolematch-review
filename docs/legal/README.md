# Legal documents: drafts for brainstorming (not live)

Owner, 12 Nov 2026: "just for us to write down and brainstorm. And then if I'm happy with it, we can take it live." Nothing in this folder is published.
Before any of it goes live, a South African attorney who works on POPIA should review it: these drafts were written from our own code and settings,
not by a lawyer.

## What prompted this

Live RoleMatch (app.rolematch.co.za) takes sign-ups and CVs today, but has **no privacy policy, no terms and no cookie policy**. The footer shows
"Terms", "Privacy" and "Cookies" as words with no page behind them (`src/components/Footer.jsx`). POPIA section 18 requires telling people, when their
information is collected, who we are, what we collect and why, and that it is processed outside South Africa. This is the first gap to close.

## The drafts

| File | For whom | What it does |
|---|---|---|
| [PRIVACY_POLICY_DRAFT.md](PRIVACY_POLICY_DRAFT.md) | Everyone | What RoleMatch collects, why, where it goes, how long it is kept, people's rights |
| [TERMS_DRAFT.md](TERMS_DRAFT.md) | Companies that sign up | The agreement to use RoleMatch, including that the AI recommends and people decide |
| [COOKIE_POLICY_DRAFT.md](COOKIE_POLICY_DRAFT.md) | Everyone | The only browser storage RoleMatch uses, all of it needed to work |
| [CUSTOMER_DPA_DRAFT.md](CUSTOMER_DPA_DRAFT.md) | Customer companies | The operator agreement (POPIA section 21) for candidates' CVs, with the list of outside companies |
| [CANDIDATE_NOTICE_DRAFT.md](CANDIDATE_NOTICE_DRAFT.md) | Customers, to give candidates | A short notice that their CV is read with AI, including outside South Africa |

## Who is responsible for what (the key idea in all of them)

- **Account information** (recruiters' names, e-mail addresses, sign-in records): RoleMatch decides why and how it is used, so RoleMatch is the
  *responsible party*.
- **Candidates' CVs and everything read from them**: the customer company decides to upload them and for which jobs, so the customer is the
  responsible party and RoleMatch is its *operator*, acting only on its instructions (POPIA section 21). This is why customers need the DPA.

## Decisions only the owner can make

1. **Company details** (owner, 12 Nov 2026: RoleMatch is a product of **Natus Lab**, the registered company, whose director is the owner): the exact registered name, registration number, physical address, and the **Information Officer** (usually the director;
   must be registered with the Information Regulator). Every draft has `[PLACEHOLDER]` where these go.
2. **Naming the AI provider in legal documents.** The rule is that users never see the model's name in the product ([never-name-the-model]). Legal
   documents are different: a DPA must name the outside companies or corporates will not sign. Recommendation: name the *company* (Anthropic, PBC,
   United States) in the DPA and the privacy policy, never the model, and nowhere in the product.
3. **Removing ID numbers and home addresses before the AI reads a CV.** Matching never needs them; less would leave the country. It would change the
   10 Nov 2026 rule that the AI reads the whole CV ([no-masking-claude-reads-all]).
4. **Retention periods still "not set"** in our own register (`docs/database/data-classes.json`): upload batches, finished queue jobs, sent-mail
   records, error and review records, applications, ended console sessions, invitations and sign-up checks after they expire. A policy must state a
   period for each. Suggested: operational records 90 days after they finish; review and error records with the document they belong to (already);
   anything else 12 months.
5. **What happens when a customer leaves** ("closure process not set" for organisations): suggested 30 days to export, then deletion of everything
   except billing records (kept 7 years, already true of AI use records).
6. **The old Supabase project in Ireland**: until it is retired (planned around 19 Nov 2026) it still holds an older copy of live's data. The
   privacy policy should not go live while that copy exists, or it must mention it.

## What we can fix ourselves, in the product (owner, 12 Nov 2026: "if there's things we can fix ourselves")

| Fix | State |
|---|---|
| Delete a person, a portal or a company on request, with the files | Built (console owner actions, 12 Nov) |
| Each company's data kept apart (row security, separate file folders) | Built and tested |
| Originals encrypted, keys off the database | Built (file vault, VAULT_KEYS) |
| Who did what, kept (audit) | Built |
| AI recommends, people decide (POPIA section 71: no decision by machine alone) | Built into how matching works |
| Pages for the documents, linked from the footer and from sign-up | Not built: needs the owner's yes on the drafts |
| A one-line "how your data is handled" where CVs are uploaded | Not built |
| A person can ask for a copy of their information (POPIA section 23) | Partly: the owner can read it through support access; no export yet |
| Retention periods enforced by clean-up jobs | Partly: some tables clean themselves; the "not set" ones do not |
| Fewer personal details sent to the AI (decision 3) | Not built: owner's decision |
