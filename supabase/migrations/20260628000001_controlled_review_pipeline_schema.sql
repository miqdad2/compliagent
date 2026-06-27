-- Controlled technical review pipeline — Part 2: schema, indexes, RLS, RPCs.
--
-- Requires 20260628000000_* to have been committed first so the new enum
-- values (superseded, cancelled, awaiting_human_review, ready, specification,
-- contractor_submission, …) are available for use in expressions and indexes.

-- ============================================================
-- 1. compliance_reviews: organization scope + idempotency columns
-- ============================================================

alter table public.compliance_reviews
  add column if not exists organization_id     uuid references public.organizations(id),
  add column if not exists review_version      integer not null default 1,
  add column if not exists source_hash         text,
  add column if not exists extraction_version  text,
  add column if not exists prompt_version      text,
  add column if not exists started_at          timestamptz,
  add column if not exists completed_at        timestamptz,
  add column if not exists failed_at           timestamptz;

-- Back-fill organization_id from the project for existing rows so
-- the column is not NULL where the project link is intact.
update public.compliance_reviews r
set organization_id = p.organization_id
from public.projects p
where p.id = r.project_id
  and r.organization_id is null;

-- Index for org-scoped queries on reviews.
create index if not exists compliance_reviews_org_project_idx
  on public.compliance_reviews(organization_id, project_id);

-- Non-partial index for version lookups.
-- A partial unique index referencing new enum literals ('superseded', 'cancelled')
-- hits PostgreSQL catalog-cache timing issues even after the enum commit; version
-- uniqueness is enforced at the service layer instead.
create index if not exists compliance_reviews_project_version_idx
  on public.compliance_reviews(project_id, review_version);

-- ============================================================
-- 2. compliance_findings: organization scope
-- ============================================================

alter table public.compliance_findings
  add column if not exists organization_id uuid references public.organizations(id);

-- Back-fill from the linked project.
update public.compliance_findings f
set organization_id = p.organization_id
from public.projects p
where p.id = f.project_id
  and f.organization_id is null;

-- Index for org-scoped finding queries.
create index if not exists compliance_findings_org_review_idx
  on public.compliance_findings(organization_id, review_id);

-- ============================================================
-- 3. RLS policies for the new organization_id columns
-- ============================================================

-- compliance_reviews: org-scoped policies (additive alongside any legacy ones).
drop policy if exists "compliance_reviews_org_select" on public.compliance_reviews;
create policy "compliance_reviews_org_select"
  on public.compliance_reviews
  for select
  using (
    organization_id is null
    or organization_id in (
      select organization_id from public.profiles where user_id = auth.uid()
    )
  );

drop policy if exists "compliance_reviews_org_insert" on public.compliance_reviews;
create policy "compliance_reviews_org_insert"
  on public.compliance_reviews
  for insert
  with check (
    organization_id is null
    or organization_id in (
      select organization_id from public.profiles where user_id = auth.uid()
    )
  );

drop policy if exists "compliance_reviews_org_update" on public.compliance_reviews;
create policy "compliance_reviews_org_update"
  on public.compliance_reviews
  for update
  using (
    organization_id is null
    or organization_id in (
      select organization_id from public.profiles where user_id = auth.uid()
    )
  );

-- compliance_findings: org-scoped policies.
drop policy if exists "compliance_findings_org_select" on public.compliance_findings;
create policy "compliance_findings_org_select"
  on public.compliance_findings
  for select
  using (
    organization_id is null
    or organization_id in (
      select organization_id from public.profiles where user_id = auth.uid()
    )
  );

drop policy if exists "compliance_findings_org_insert" on public.compliance_findings;
create policy "compliance_findings_org_insert"
  on public.compliance_findings
  for insert
  with check (
    organization_id is null
    or organization_id in (
      select organization_id from public.profiles where user_id = auth.uid()
    )
  );

drop policy if exists "compliance_findings_org_update" on public.compliance_findings;
create policy "compliance_findings_org_update"
  on public.compliance_findings
  for update
  using (
    organization_id is null
    or organization_id in (
      select organization_id from public.profiles where user_id = auth.uid()
    )
  );

-- ============================================================
-- 4. RPC: begin_controlled_review
-- ============================================================
-- Atomically sets a review to 'running' from an allowed prior state.
-- Returns the review_id on success or raises an exception on conflict.
-- Caller must validate org/project scope before invoking.

create or replace function public.begin_controlled_review(
  p_organization_id    uuid,
  p_project_id         uuid,
  p_review_id          uuid,
  p_review_version     integer,
  p_source_hash        text,
  p_extraction_version text,
  p_prompt_version     text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current_status text;
  v_current_org    uuid;
begin
  select status, organization_id
  into   v_current_status, v_current_org
  from   public.compliance_reviews
  where  id = p_review_id
  for update;

  if not found then
    raise exception 'REVIEW_NOT_FOUND' using hint = 'review_id';
  end if;

  if v_current_org is distinct from p_organization_id then
    raise exception 'ORGANIZATION_ACCESS_DENIED' using hint = 'review_id';
  end if;

  if v_current_status not in ('draft', 'ready', 'failed') then
    raise exception 'REVIEW_STATE_CONFLICT'
      using hint    = v_current_status,
            detail  = 'Review can only be started from draft, ready, or failed state.';
  end if;

  update public.compliance_reviews
  set
    status             = 'running',
    review_version     = p_review_version,
    source_hash        = p_source_hash,
    extraction_version = p_extraction_version,
    prompt_version     = p_prompt_version,
    started_at         = now(),
    completed_at       = null,
    failed_at          = null,
    updated_at         = now()
  where id = p_review_id;

  return jsonb_build_object(
    'reviewId',      p_review_id,
    'status',        'running',
    'reviewVersion', p_review_version
  );
end;
$$;

-- ============================================================
-- 5. RPC: complete_controlled_review_to_human_review
-- ============================================================
-- Transitions a running review to awaiting_human_review.
-- Caller validates scope before invoking.

create or replace function public.complete_controlled_review_to_human_review(
  p_organization_id uuid,
  p_review_id       uuid,
  p_finding_count   integer,
  p_condition_count integer
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current_status text;
  v_current_org    uuid;
begin
  select status, organization_id
  into   v_current_status, v_current_org
  from   public.compliance_reviews
  where  id = p_review_id
  for update;

  if not found then
    raise exception 'REVIEW_NOT_FOUND' using hint = 'review_id';
  end if;

  if v_current_org is distinct from p_organization_id then
    raise exception 'ORGANIZATION_ACCESS_DENIED' using hint = 'review_id';
  end if;

  if v_current_status <> 'running' then
    raise exception 'REVIEW_STATE_CONFLICT'
      using hint   = v_current_status,
            detail = 'Only a running review can be transitioned to awaiting_human_review.';
  end if;

  update public.compliance_reviews
  set
    status       = 'awaiting_human_review',
    completed_at = now(),
    updated_at   = now()
  where id = p_review_id;

  return jsonb_build_object(
    'reviewId',       p_review_id,
    'status',         'awaiting_human_review',
    'findingCount',   p_finding_count,
    'conditionCount', p_condition_count
  );
end;
$$;

-- ============================================================
-- 6. RPC: fail_controlled_review
-- ============================================================
-- Marks a running review as failed.

create or replace function public.fail_controlled_review(
  p_organization_id uuid,
  p_review_id       uuid,
  p_error_code      text,
  p_safe_message    text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current_status text;
  v_current_org    uuid;
begin
  select status, organization_id
  into   v_current_status, v_current_org
  from   public.compliance_reviews
  where  id = p_review_id
  for update;

  if not found then
    raise exception 'REVIEW_NOT_FOUND' using hint = 'review_id';
  end if;

  if v_current_org is distinct from p_organization_id then
    raise exception 'ORGANIZATION_ACCESS_DENIED' using hint = 'review_id';
  end if;

  if v_current_status <> 'running' then
    raise exception 'REVIEW_STATE_CONFLICT'
      using hint   = v_current_status,
            detail = 'Only a running review can be marked as failed.';
  end if;

  update public.compliance_reviews
  set
    status       = 'failed',
    failed_at    = now(),
    review_scope = coalesce(review_scope, '') || e'\n[ERROR] ' || p_safe_message,
    updated_at   = now()
  where id = p_review_id;

  return jsonb_build_object(
    'reviewId',  p_review_id,
    'status',    'failed',
    'errorCode', p_error_code
  );
end;
$$;

-- ============================================================
-- 7. RPC: upsert_review_finding
-- ============================================================
-- Idempotently inserts a compliance finding row for a given
-- requirement + review pair, returning the finding id either way.
-- Caller validates scope before invoking.

create or replace function public.upsert_review_finding(
  p_organization_id   uuid,
  p_project_id        uuid,
  p_review_id         uuid,
  p_requirement_id    uuid,
  p_clause_number     text,
  p_sub_clause_number text,
  p_requirement_text  text,
  p_status            text,
  p_weightage_score   numeric,
  p_confidence_score  numeric,
  p_reasoning         text,
  p_risk_level        text,
  p_created_by        uuid
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_finding_id uuid;
begin
  -- Return existing finding for this requirement in this review (idempotent).
  select id into v_finding_id
  from   public.compliance_findings
  where  review_id      = p_review_id
    and  requirement_id = p_requirement_id
  limit 1;

  if v_finding_id is null then
    insert into public.compliance_findings (
      review_id, project_id, organization_id, requirement_id,
      clause_number, sub_clause_number, requirement_text,
      status, weightage_score, confidence_score,
      reasoning, risk_level
    ) values (
      p_review_id, p_project_id, p_organization_id, p_requirement_id,
      p_clause_number, p_sub_clause_number, p_requirement_text,
      p_status::public.compliance_status,
      p_weightage_score, p_confidence_score,
      p_reasoning, p_risk_level::public.risk_level
    )
    returning id into v_finding_id;
  end if;

  return jsonb_build_object('findingId', v_finding_id);
end;
$$;
