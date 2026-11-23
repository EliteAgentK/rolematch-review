-- AI-only matching (owner, 9 Nov 2026: "there should be no formulas here, only AI matching"; "once a score is final for a role and job, that's final ...
-- unless the panel was edited"). Two more kinds of saved AI answer, in the same portal-scoped table as before:
--   job-reading: Claude's reading of one job into a fixed list of requirements, keyed by what the job says, so every candidate is measured against one list;
--   match-score: Claude's final score of one candidate against that list, keyed by what the CV and the job say, so the same pair always shows the same score.
-- Additive: the older kinds stay valid, and an older server ignores the new ones.
alter table model_reviews drop constraint if exists model_reviews_kind_check;
alter table model_reviews add constraint model_reviews_kind_check check (kind in ('extraction', 'matching', 'audit', 'job-reading', 'match-score'));
