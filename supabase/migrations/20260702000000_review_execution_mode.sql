-- Migration: 20260702000000_review_execution_mode.sql
-- Adds execution_mode column to compliance_reviews so the workspace can display
-- the actual mode selected by the reviewer (deterministic / mock / controlled_live)
-- rather than guessing from prompt_version.
--
-- Must be applied AFTER 20260628000000_controlled_review_pipeline.sql.

alter table public.compliance_reviews
  add column if not exists execution_mode text
    check (execution_mode in ('deterministic', 'mock', 'controlled_live'))
    default 'deterministic';

comment on column public.compliance_reviews.execution_mode is
  'Execution mode for the controlled review pipeline: deterministic, mock, or controlled_live.';
