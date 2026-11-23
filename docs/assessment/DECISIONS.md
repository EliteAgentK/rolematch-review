# Decisions that need the owner's approval

Each row gives a recommendation, the alternatives and the consequences. **Nothing here is approved until the owner says so.** Where a value is needed to run offline tests, the recommended value is used and labelled *proposed* in the code (`server/src/assessment/policy.ts`) and in the [specification](MATCHING_SPECIFICATION.md).

| # | Decision | Recommendation | Alternatives | Consequences |
|---|---|---|---|---|
| D1 | Ordering policy for review lists | Decide after the pilot, on its paired results; run P1, P2 and P3 side by side until then | choose P1, essentials first, now | Choosing now would fix by construction every pair that the pilot is meant to test |
| D2 | How uncertainty shows in the list | One stable list with local warnings (⚠) and policy-dependence marks (†) | anchored comparability groups | Groups hide order inside a group, and chained groups merged clearly different candidates |
| D3 | Starting values: course 0.4, transfer maximum 0.6, importance × 2 | Keep as starting values; validate the named and course rungs first | other values, or no course rung | Named-only ties with half-described evidence (spec §11); the values change ranks until they are validated |
| D4 | A qualification "in progress" | Keep the capability graph's approved value: documented 0, upper bound 1 | documented shortfall: upper bound 0 | Changing it marks students as unable to meet the requirement even when the job may accept completion |
| D5 | Partial evidence keeps the upper bound at 1 (named, course, short experience) | Confirm. It follows the product rule that absence is not proof | close the bound at the documented value | Bounds are wide. The alternative treats missing depth as proof of absence |
| D6 | When percentages are shown | When the documents speak to at least 50% of the essential weight | 0% (always show), or 75% | A lower threshold shows precise-looking figures for thin CVs; a higher one hides more |
| D7 | Review budget for the pilot | The top 20% of each job's applicants, plus the whole tie at the cut-off, with flagged candidates beside it | a fixed count | Sets the workload and recall trade-off being measured |
| D8 | Formula B output | Status list only, until evaluated | status list plus a weighted range | A figure can still hide an unmet important need (it is listed first in any case) |
| D9 | Formula B availability | **Disabled** until its inputs and behaviour are evaluated (a requirement, recorded for completeness) | — | — |
| D10 | The pilot: scope, labelling protocol, success criteria | Approve [`PILOT_PROTOCOL.md`](PILOT_PROTOCOL.md) before any document is used | changes to scope or criteria | Criteria cannot change after results are seen |
| D11 | A role dated by year only | Count from January, and mark it ambiguous when two readings differ by more than 6 months | count from mid-year | Moves experience months; affects the experience criteria only |
| D12 | **Upload malware handling** before any production use (previously deferred, so not yet an accepted risk) | See [`RELEASE_GATES.md`](RELEASE_GATES.md), gate S7: run a scanner as an isolated service, plus the compensating controls already in place | compensating controls only, accepting the residual risk in writing; or an external scanning service (external transfer and cost: not recommended) | ClamAV is GPL-2.0. Running it as a separate process does not link it into our code, but the owner's permissive-only rule needs an explicit decision |
| D13 | Live wording "The documents **prove** X%" and "**verified**" (register R21) | Change it together with Formula A | change it now in rules 2.2.0 | It overstates what a quotation shows |
| D14 | Retaining the incumbent | Keep rules 2.2.0, its stored results and all model artefacts runnable for audit and rollback until a retention period is set after release | remove after release | Reproducing a stored result counts as use |
| D15 | Thresholds in the release-gate table | Approve, change or reject each proposed threshold **before** the evaluation that tests it | — | Thresholds are never lowered after seeing results |
