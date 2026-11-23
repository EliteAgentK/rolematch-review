# Annotation guide: requirement-to-evidence labels

**Where to label.** Use the review page: <https://claude.ai/artifact/7MQwHLjJHrAmbWnHzCEDFc>. Use that page, opened at claude.ai while signed in. A downloaded copy of the HTML cannot reach the review store and saves nothing.

## The one rule that matters most

Judge **the exact requirement, with its scope**, using only the passages shown. Mentioning the tool does not earn credit for a more specific responsibility. "Tableau" in a skills list is not "Tableau dashboard development".

## Answers

| Answer | Use when |
|---|---|
| described | a duty or project passage shows the person doing the required thing |
| named | it is only listed or mentioned, not shown in use |
| course | only a course or training is shown |
| transferable | a different skill is shown in use and the item supplies a mapping to the required skill |
| negated | the person says they do not have it |
| desired | the person only wants to learn it or move into it |
| no evidence | the passages do not support it. This is **never** proof that the person lacks it |
| ambiguous | the passages contradict each other about it |
| relevant / not relevant | whether **this role's duties** do the job's work; the title is context, not evidence |
| qualification answers | match the qualification named, and use its **stated** status: completed, in progress, no status given, not completed, a different field, or not mentioned |

## Distinctions to keep

* **Viewing versus building.** Viewing Tableau reports someone else built is exposure to the tool, not dashboard development.
* **Deploying versus administering.** Deploying applications to a Kubernetes cluster is not administering the cluster. It neither proves nor rules out administration.
* **No production experience versus no experience.** "Not used in production" limits the claim; it does not say the person has never used it.
* **Listed versus completed.** A listed qualification, or dates of study, does not prove completion. Attendance is not graduation.
* **Fixture versus policy.** The mappings in these examples (VBA → Python, Power BI → Tableau) are **hypothetical test fixtures**, not approved RoleMatch policy. A mapping never chains (Qlik is not Power BI).
* **Ambition versus counterevidence.** A wish to grow into something does not contradict evidence that the person already did it.

## Your three choices on each proposed answer

* **Right.** The proposed answer is correct. Add a note if anything is worth recording.
* **Wrong.** Choose the correct answer, **or** "Leave unresolved: needs adjudication". The item counts as complete only once one of these is chosen.
* **Unclear rubric.** The rubric does not decide this case. Say why in the note.

An item counts as complete only when the store has **confirmed** the save ("Saved"). "Saving…" means it is not confirmed yet. "Not saved" means it failed: press Retry.

## What this review is, and is not

The examples and proposed answers were written by Claude and revised by an AI-assisted review, and the page shows them to you. Your review improves the **development** labels. It is **not** independent validation and does not measure representative accuracy.

**For an independent check, use Blind labelling:**

* proposed answers stay hidden until you have saved your own;
* blind labels go to a separate store;
* reviewers should not see each other's labels before submitting.

**Export.** "Export decisions" produces a versioned JSON file. It contains item ids, your decisions, replacements and notes, the dataset and rubric versions, and the time of each save.
