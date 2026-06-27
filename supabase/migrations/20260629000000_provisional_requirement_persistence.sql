-- Provisional requirement persistence and human review workspace foundation.
-- Additive only: extends extracted_requirements with state tracking, org scope,
-- review linkage, and provisional-requirement metadata.
--
-- Apply after:
--   20260628000000_controlled_review_pipeline.sql    (applied)
--   20260628000001_controlled_review_pipeline_schema.sql  (apply before this)

-- ============================================================
-- 1. Extend extracted_requirements with provisional-state columns
-- ============================================================

alter table public.extracted_requirements
  add column if not exists organization_id      uuid references public.organizations(id),
  add column if not exists review_id            uuid references public.compliance_reviews(id),
  add column if not exists requirement_state    text not null default 'confirmed',
  add column if not exists section_heading      text,
  add column if not exists normalized_text      text,
  add column if not exists discovery_confidence numeric(5,2),
  add column if not exists refinement_confidence numeric(5,2),
  add column if not exists ai_run_id            uuid,
  add column if not exists prompt_version       text,
  add column if not exists human_review_required boolean not null default false,
  add column if not exists human_review_reasons  jsonb,
  add column if not exists is_active            boolean not null default true,
  add column if not exists superseded_at        timestamptz,
  add column if not exists superseded_reason    text,
  add column if not exists created_by           uuid references public.profiles(id),
  add column if not exists updated_at           timestamptz not null default now();

-- constraint: requirement_state must be one of the known values
-- ADD CONSTRAINT IF NOT EXISTS is not valid PostgreSQL syntax; use a DO block instead.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname     = 'extracted_requirements_state_check'
      and conrelid    = 'public.extracted_requirements'::regclass
  ) then
    alter table public.extracted_requirements
      add constraint extracted_requirements_state_check
        check (requirement_state in ('discovered', 'provisional', 'confirmed', 'rejected', 'superseded'));
  end if;
end;
$$;

-- Back-fill organization_id from the project for existing rows.
update public.extracted_requirements r
set organization_id = p.organization_id
from public.projects p
where p.id = r.project_id
  and r.organization_id is null;

-- ============================================================
-- 2. Indexes for the new columns
-- ============================================================

-- Org-scoped queries (most common query pattern for the workspace).
create index if not exists extracted_requirements_org_project_idx
  on public.extracted_requirements(organization_id, project_id)
  where is_active = true;

-- Review-linked requirements (provisional requirements for a specific review).
create index if not exists extracted_requirements_review_idx
  on public.extracted_requirements(review_id, is_active)
  where review_id is not null;

-- Active requirements per document (for the requirement tree).
create index if not exists extracted_requirements_document_active_idx
  on public.extracted_requirements(source_document_id, is_active);

-- ============================================================
-- 3. RLS for extracted_requirements (org-scoped, additive)
-- ============================================================

-- Enable RLS (was not previously enabled since no org_id existed).
alter table public.extracted_requirements enable row level security;

drop policy if exists "extracted_requirements_org_select" on public.extracted_requirements;
create policy "extracted_requirements_org_select"
  on public.extracted_requirements
  for select
  using (
    organization_id is null
    or organization_id in (
      select organization_id from public.profiles where user_id = auth.uid()
    )
  );

drop policy if exists "extracted_requirements_org_insert" on public.extracted_requirements;
create policy "extracted_requirements_org_insert"
  on public.extracted_requirements
  for insert
  with check (
    organization_id is null
    or organization_id in (
      select organization_id from public.profiles where user_id = auth.uid()
    )
  );

drop policy if exists "extracted_requirements_org_update" on public.extracted_requirements;
create policy "extracted_requirements_org_update"
  on public.extracted_requirements
  for update
  using (
    organization_id is null
    or organization_id in (
      select organization_id from public.profiles where user_id = auth.uid()
    )
  );

-- ============================================================
-- 4. compliance_findings: reviewer_comment column
-- ============================================================
-- Separate reviewer comment from human_comment for clarity.

alter table public.compliance_findings
  add column if not exists reviewer_comment text;

-- ============================================================
-- 5. compliance_findings: ready_for_annotation gate
-- ============================================================

alter table public.compliance_findings
  add column if not exists annotation_ready boolean not null default false;

-- ============================================================
-- 6. compliance_reviews: ready_for_annotation columns
-- ============================================================

alter table public.compliance_reviews
  add column if not exists annotation_ready        boolean not null default false,
  add column if not exists annotation_ready_at     timestamptz,
  add column if not exists annotation_ready_by     uuid references public.profiles(id),
  add column if not exists annotation_blockers     jsonb;
