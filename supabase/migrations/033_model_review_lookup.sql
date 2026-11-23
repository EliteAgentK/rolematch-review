-- Every match now asks whether the model has already answered this question (candidate, job and versions), so a bulk match asks it once per person. The existing unique index leads with subject_id and cannot answer that.
create index if not exists model_reviews_kind_input_hash on model_reviews (kind, input_hash) where status = 'done';
