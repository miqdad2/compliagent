-- Prevent duplicate active processing jobs for the same document and job type.
--
-- A partial unique index over (document_id, job_type) WHERE status IN (active statuses)
-- ensures that rapid double-clicks or concurrent requests cannot enqueue more than one
-- active extraction job per document.
--
-- Historical completed and failed jobs are unaffected (is_active condition excludes them).
-- The index is idempotent: CREATE … IF NOT EXISTS is safe to re-run.

CREATE UNIQUE INDEX IF NOT EXISTS processing_jobs_no_dup_active_idx
  ON public.processing_jobs (document_id, job_type)
  WHERE status IN ('queued', 'claimed', 'running', 'retry_wait')
    AND document_id IS NOT NULL;

-- Similar protection for review-scoped jobs (annotation_generation, etc.).
CREATE UNIQUE INDEX IF NOT EXISTS processing_jobs_no_dup_active_review_idx
  ON public.processing_jobs (review_id, job_type)
  WHERE status IN ('queued', 'claimed', 'running', 'retry_wait')
    AND review_id IS NOT NULL
    AND document_id IS NULL;
