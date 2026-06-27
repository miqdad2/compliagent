-- Condition persistence transactional foundation.
-- Additive only: does not enable live AI, OCR, or annotation rendering.
-- Adds supersession fields, revision tracking, and deterministic parent status columns.
-- Provides a single atomic RPC for condition evaluation persistence and parent refresh.

-- ============================================================
-- 1. Requirement conditions: supersession support
-- ============================================================

alter table public.requirement_conditions
  add column if not exists is_active boolean not null default true,
  add column if not exists is_human_confirmed boolean not null default false,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;

-- Existing unnamed unique constraints prevent multiple rows per (requirement, order/key).
-- Drop them and replace with partial indexes so inactive rows do not conflict.
alter table public.requirement_conditions
  drop constraint if exists requirement_conditions_requirement_id_condition_order_key;

alter table public.requirement_conditions
  drop constraint if exists requirement_conditions_requirement_id_condition_key_key;

create unique index if not exists requirement_conditions_active_order_idx
  on public.requirement_conditions(requirement_id, condition_order)
  where is_active = true;

create unique index if not exists requirement_conditions_active_key_idx
  on public.requirement_conditions(requirement_id, condition_key)
  where is_active = true;

create index if not exists requirement_conditions_active_requirement_idx
  on public.requirement_conditions(requirement_id, is_active);

-- ============================================================
-- 2. Condition evaluations: supersession and revision tracking
-- ============================================================

alter table public.condition_evaluations
  add column if not exists is_active boolean not null default true,
  add column if not exists revision_number integer not null default 1,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;

-- The existing unique (review_id, requirement_condition_id) allows only one evaluation
-- per condition per review. Replace with a partial index to allow revision history.
alter table public.condition_evaluations
  drop constraint if exists condition_evaluations_review_id_requirement_condition_id_key;

create unique index if not exists condition_evaluations_active_unique_idx
  on public.condition_evaluations(review_id, requirement_condition_id)
  where is_active = true;

create index if not exists condition_evaluations_active_finding_idx
  on public.condition_evaluations(finding_id, is_active);

create index if not exists condition_evaluations_active_review_idx
  on public.condition_evaluations(review_id, is_active);

-- ============================================================
-- 3. Compliance findings: AI-derived and deterministic status columns
-- ============================================================

alter table public.compliance_findings
  add column if not exists ai_derived_status public.compliance_status,
  add column if not exists deterministic_derived_status public.compliance_status;

-- ============================================================
-- 4. Transactional RPC: persist condition evaluation and refresh parent finding
-- ============================================================
-- Called from the server-only persistence service after TypeScript validation and
-- deterministic parent derivation. All writes happen in a single transaction.
-- The caller must validate organization, project, review, finding, and condition
-- access before invoking this function.

create or replace function public.persist_condition_evaluation_and_refresh_parent(
  p_organization_id         uuid,
  p_project_id              uuid,
  p_review_id               uuid,
  p_finding_id              uuid,
  p_requirement_id          uuid,
  p_requirement_condition_id uuid,
  p_status                  text,
  p_evidence_summary        text,
  p_reasoning               text,
  p_contradiction_reasoning text,
  p_missing_information     text,
  p_verification_failure_reason text,
  p_contractor_action       text,
  p_confidence_score        numeric,
  p_weightage_score         numeric,
  p_is_human_review_required boolean,
  p_evidence_links          jsonb,
  p_deterministic_parent_status text,
  p_deterministic_parent_reasoning text,
  p_deterministic_requires_human_review boolean,
  p_created_by              uuid
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_existing_id            uuid;
  v_existing_human_status  text;
  v_new_evaluation_id      uuid;
  v_next_revision          integer;
  v_finding_row            record;
  v_final_status           text;
  v_link                   jsonb;
  v_region_id              uuid;
  v_rel_type               text;
begin
  -- 1. Check for an existing active evaluation for this condition in this review.
  select id, human_status::text
  into v_existing_id, v_existing_human_status
  from public.condition_evaluations
  where review_id = p_review_id
    and requirement_condition_id = p_requirement_condition_id
    and is_active = true
  limit 1;

  -- 2. Refuse to supersede a human-reviewed evaluation automatically.
  if v_existing_id is not null and v_existing_human_status is not null then
    raise exception 'HUMAN_APPROVAL_PROTECTED: The existing evaluation for condition % has been reviewed by a human and cannot be superseded automatically.',
      p_requirement_condition_id;
  end if;

  -- 3. Determine the next revision number.
  select coalesce(max(revision_number), 0) + 1
  into v_next_revision
  from public.condition_evaluations
  where review_id = p_review_id
    and requirement_condition_id = p_requirement_condition_id;

  -- 4. Mark any existing active evaluation as superseded.
  if v_existing_id is not null then
    update public.condition_evaluations
    set
      is_active = false,
      superseded_at = now(),
      superseded_reason = 'reprocessed'
    where id = v_existing_id;
  end if;

  -- 5. Insert the new condition evaluation.
  insert into public.condition_evaluations (
    organization_id,
    project_id,
    review_id,
    finding_id,
    requirement_id,
    requirement_condition_id,
    status,
    evidence_summary,
    reasoning,
    contradiction_reasoning,
    missing_information,
    verification_failure_reason,
    contractor_action,
    confidence_score,
    weightage_score,
    is_human_review_required,
    is_active,
    revision_number
  )
  values (
    p_organization_id,
    p_project_id,
    p_review_id,
    p_finding_id,
    p_requirement_id,
    p_requirement_condition_id,
    p_status::public.compliance_status,
    p_evidence_summary,
    p_reasoning,
    p_contradiction_reasoning,
    p_missing_information,
    p_verification_failure_reason,
    p_contractor_action,
    p_confidence_score,
    p_weightage_score,
    p_is_human_review_required,
    true,
    v_next_revision
  )
  returning id into v_new_evaluation_id;

  -- 6. Insert evidence region links for the new evaluation.
  if p_evidence_links is not null then
    for v_link in select * from jsonb_array_elements(p_evidence_links)
    loop
      v_rel_type := v_link->>'relationshipType';

      if v_rel_type = 'missing_expected_region' then
        insert into public.condition_evidence_regions (
          condition_evaluation_id,
          evidence_region_id,
          organization_id,
          project_id,
          relationship_type
        )
        values (
          v_new_evaluation_id,
          null,
          p_organization_id,
          p_project_id,
          v_rel_type::public.condition_evidence_relationship
        );
      else
        v_region_id := (v_link->>'regionId')::uuid;
        insert into public.condition_evidence_regions (
          condition_evaluation_id,
          evidence_region_id,
          organization_id,
          project_id,
          relationship_type
        )
        values (
          v_new_evaluation_id,
          v_region_id,
          p_organization_id,
          p_project_id,
          v_rel_type::public.condition_evidence_relationship
        )
        on conflict (condition_evaluation_id, evidence_region_id) do nothing;
      end if;
    end loop;
  end if;

  -- 7. Load the current finding to check for a human override.
  select *
  into v_finding_row
  from public.compliance_findings
  where id = p_finding_id
    and project_id = p_project_id;

  if not found then
    raise exception 'FINDING_NOT_FOUND: Compliance finding % not found for project %.',
      p_finding_id, p_project_id;
  end if;

  -- 8. Compute the final effective status.
  --    Human override takes precedence over deterministic derivation.
  v_final_status := coalesce(
    v_finding_row.human_override_status::text,
    p_deterministic_parent_status
  );

  -- 9. Update the parent compliance finding.
  update public.compliance_findings
  set
    deterministic_derived_status = p_deterministic_parent_status::public.compliance_status,
    status = v_final_status::public.compliance_status,
    reasoning = p_deterministic_parent_reasoning,
    updated_at = now()
  where id = p_finding_id
    and project_id = p_project_id;

  -- 10. Write audit log entries.
  insert into public.audit_logs (
    organization_id, project_id, user_id, action, entity_type, entity_id, metadata
  )
  values
    (
      p_organization_id,
      p_project_id,
      p_created_by,
      'condition_evaluation.created',
      'condition_evaluations',
      v_new_evaluation_id,
      jsonb_build_object(
        'finding_id', p_finding_id,
        'condition_id', p_requirement_condition_id,
        'status', p_status,
        'revision_number', v_next_revision,
        'superseded_previous', v_existing_id is not null
      )
    ),
    (
      p_organization_id,
      p_project_id,
      p_created_by,
      'parent_finding.recalculated',
      'compliance_findings',
      p_finding_id,
      jsonb_build_object(
        'deterministic_status', p_deterministic_parent_status,
        'final_status', v_final_status,
        'human_override_preserved', v_finding_row.human_override_status is not null,
        'requires_human_review', p_deterministic_requires_human_review
      )
    );

  -- 11. Return the result.
  return jsonb_build_object(
    'evaluationId', v_new_evaluation_id,
    'parentStatus', v_final_status,
    'deterministicStatus', p_deterministic_parent_status,
    'humanOverridePreserved', v_finding_row.human_override_status is not null,
    'revisionNumber', v_next_revision
  );

exception
  when others then
    raise exception '%', sqlerrm;
end;
$$;

comment on function public.persist_condition_evaluation_and_refresh_parent is
  'Atomically persists one condition evaluation, its evidence links, and refreshes the '
  'parent finding status from deterministic derivation. The caller must validate '
  'organization, project, review, finding, and condition access before calling this '
  'function. Human reviewer overrides on the parent finding are preserved.';
