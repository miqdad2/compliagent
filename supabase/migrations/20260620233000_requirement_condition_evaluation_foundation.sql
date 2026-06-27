-- Clause decomposition and condition-level compliance evaluation foundation.
-- Additive only: this migration does not run AI, OCR, or annotation rendering.

create type public.requirement_condition_type as enum (
  'boolean',
  'text_match',
  'numeric_minimum',
  'numeric_maximum',
  'numeric_range',
  'exact_value',
  'standard_required',
  'certificate_required',
  'feature_required',
  'material_required',
  'configuration_required',
  'conditional_requirement'
);

create type public.condition_operator as enum (
  'equals',
  'not_equals',
  'contains',
  'not_contains',
  'greater_than',
  'greater_than_or_equal',
  'less_than',
  'less_than_or_equal',
  'between',
  'exists',
  'not_exists',
  'applicable_when'
);

create type public.condition_evidence_relationship as enum (
  'supports',
  'contradicts',
  'partially_supports',
  'contextual',
  'missing_expected_region'
);

alter type public.job_type add value if not exists 'requirement_decomposition';
alter type public.job_type add value if not exists 'condition_evidence_retrieval';
alter type public.job_type add value if not exists 'condition_evaluation';
alter type public.job_type add value if not exists 'parent_finding_derivation';
alter type public.job_type add value if not exists 'annotation_comment_generation';

alter type public.annotation_type add value if not exists 'outline';
alter type public.annotation_type add value if not exists 'cloud';

-- Composite keys enforce project and tenant scope on all new child rows.
alter table public.extracted_requirements
  add constraint extracted_requirements_id_project_key unique (id, project_id);

alter table public.compliance_findings
  add constraint compliance_findings_condition_scope_key unique (id, review_id, project_id, requirement_id);

create table public.requirement_conditions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  requirement_id uuid not null,
  condition_order integer not null check (condition_order > 0),
  condition_key text not null check (length(trim(condition_key)) > 0),
  condition_type public.requirement_condition_type not null,
  subject text not null check (length(trim(subject)) > 0),
  attribute text not null check (length(trim(attribute)) > 0),
  operator public.condition_operator not null,
  expected_text text,
  expected_numeric_value numeric,
  expected_min_value numeric,
  expected_max_value numeric,
  expected_unit text,
  is_mandatory boolean not null default true,
  source_text text not null check (length(trim(source_text)) > 0),
  extraction_confidence numeric(5,2) not null check (extraction_confidence >= 0 and extraction_confidence <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint requirement_conditions_project_organization_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete cascade,
  constraint requirement_conditions_requirement_scope_fk
    foreign key (requirement_id, project_id)
    references public.extracted_requirements(id, project_id)
    on delete cascade,
  constraint requirement_conditions_numeric_range_check check (
    expected_min_value is null
    or expected_max_value is null
    or expected_min_value <= expected_max_value
  ),
  constraint requirement_conditions_expected_value_check check (
    case condition_type
      when 'text_match' then expected_text is not null and length(trim(expected_text)) > 0
      when 'numeric_minimum' then expected_min_value is not null and expected_unit is not null and length(trim(expected_unit)) > 0
      when 'numeric_maximum' then expected_max_value is not null and expected_unit is not null and length(trim(expected_unit)) > 0
      when 'numeric_range' then expected_min_value is not null and expected_max_value is not null and expected_unit is not null and length(trim(expected_unit)) > 0
      when 'exact_value' then
        (expected_numeric_value is not null and expected_unit is not null and length(trim(expected_unit)) > 0)
        or (expected_text is not null and length(trim(expected_text)) > 0)
      when 'standard_required' then expected_text is not null and length(trim(expected_text)) > 0
      when 'certificate_required' then expected_text is not null and length(trim(expected_text)) > 0
      when 'feature_required' then expected_text is not null and length(trim(expected_text)) > 0
      when 'material_required' then expected_text is not null and length(trim(expected_text)) > 0
      when 'configuration_required' then expected_text is not null and length(trim(expected_text)) > 0
      when 'conditional_requirement' then expected_text is not null and length(trim(expected_text)) > 0
      else true
    end
  ),
  unique (requirement_id, condition_order),
  unique (requirement_id, condition_key),
  unique (id, project_id, organization_id),
  unique (id, requirement_id, project_id, organization_id)
);

create table public.condition_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  review_id uuid not null,
  finding_id uuid not null,
  requirement_id uuid not null,
  requirement_condition_id uuid not null,
  status public.compliance_status not null,
  evidence_summary text,
  reasoning text not null check (length(trim(reasoning)) > 0),
  contradiction_reasoning text,
  missing_information text,
  verification_failure_reason text,
  contractor_action text,
  confidence_score numeric(5,2) not null check (confidence_score >= 0 and confidence_score <= 100),
  weightage_score numeric(5,2) not null check (weightage_score >= 0 and weightage_score <= 10),
  is_human_review_required boolean not null default true,
  human_status public.compliance_status,
  human_comment text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint condition_evaluations_project_organization_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete cascade,
  constraint condition_evaluations_review_scope_fk
    foreign key (review_id, project_id)
    references public.compliance_reviews(id, project_id)
    on delete cascade,
  constraint condition_evaluations_finding_scope_fk
    foreign key (finding_id, review_id, project_id, requirement_id)
    references public.compliance_findings(id, review_id, project_id, requirement_id)
    on delete cascade,
  constraint condition_evaluations_condition_scope_fk
    foreign key (requirement_condition_id, requirement_id, project_id, organization_id)
    references public.requirement_conditions(id, requirement_id, project_id, organization_id)
    on delete cascade,
  constraint condition_evaluations_reviewer_scope_fk
    foreign key (reviewed_by, organization_id)
    references public.profiles(id, organization_id),
  constraint condition_evaluations_legacy_status_check check (
    status <> 'ambiguous_not_proven'::public.compliance_status
    and (human_status is null or human_status <> 'ambiguous_not_proven'::public.compliance_status)
  ),
  constraint condition_evaluations_status_evidence_check check (
    status not in ('complied', 'exceeds_requirement')
    or (evidence_summary is not null and length(trim(evidence_summary)) > 0)
  ),
  constraint condition_evaluations_partial_check check (
    status <> 'partially_complied'
    or (
      evidence_summary is not null and length(trim(evidence_summary)) > 0
      and missing_information is not null and length(trim(missing_information)) > 0
    )
  ),
  constraint condition_evaluations_not_proven_check check (
    status <> 'not_proven'
    or (missing_information is not null and length(trim(missing_information)) > 0)
  ),
  constraint condition_evaluations_contradiction_check check (
    status <> 'not_complied'
    or (contradiction_reasoning is not null and length(trim(contradiction_reasoning)) > 0)
  ),
  constraint condition_evaluations_not_verified_check check (
    status <> 'not_verified'
    or (verification_failure_reason is not null and length(trim(verification_failure_reason)) > 0)
  ),
  constraint condition_evaluations_human_review_check check (
    (human_status is null and reviewed_by is null and reviewed_at is null)
    or (human_status is not null and reviewed_by is not null and reviewed_at is not null)
  ),
  unique (review_id, requirement_condition_id),
  unique (id, project_id, organization_id),
  unique (id, finding_id, requirement_condition_id, project_id, organization_id)
);

create table public.condition_evidence_regions (
  id uuid primary key default gen_random_uuid(),
  condition_evaluation_id uuid not null,
  evidence_region_id uuid,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  relationship_type public.condition_evidence_relationship not null,
  created_at timestamptz not null default now(),
  constraint condition_evidence_regions_project_organization_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete cascade,
  constraint condition_evidence_regions_evaluation_scope_fk
    foreign key (condition_evaluation_id, project_id, organization_id)
    references public.condition_evaluations(id, project_id, organization_id)
    on delete cascade,
  constraint condition_evidence_regions_region_scope_fk
    foreign key (evidence_region_id, project_id, organization_id)
    references public.evidence_regions(id, project_id, organization_id)
    on delete cascade,
  constraint condition_evidence_regions_missing_region_check check (
    (relationship_type = 'missing_expected_region' and evidence_region_id is null)
    or (relationship_type <> 'missing_expected_region' and evidence_region_id is not null)
  ),
  unique (condition_evaluation_id, evidence_region_id)
);

alter table public.document_annotations
  add column source_requirement_document_id uuid,
  add column requirement_condition_id uuid,
  add column condition_evaluation_id uuid,
  add column matched_condition text,
  add column exact_evidence_text text,
  add column concise_result text,
  add constraint document_annotations_requirement_document_scope_fk
    foreign key (source_requirement_document_id, project_id, organization_id)
    references public.documents(id, project_id, organization_id),
  add constraint document_annotations_condition_evaluation_scope_fk
    foreign key (
      condition_evaluation_id,
      finding_id,
      requirement_condition_id,
      project_id,
      organization_id
    )
    references public.condition_evaluations(
      id,
      finding_id,
      requirement_condition_id,
      project_id,
      organization_id
    ),
  add constraint document_annotations_condition_content_check check (
    condition_evaluation_id is null
    or (
      source_requirement_document_id is not null
      and requirement_condition_id is not null
      and matched_condition is not null and length(trim(matched_condition)) > 0
      and exact_evidence_text is not null and length(trim(exact_evidence_text)) > 0
      and concise_result is not null and length(trim(concise_result)) > 0
    )
  );

create trigger requirement_conditions_set_updated_at
before update on public.requirement_conditions
for each row execute function public.set_updated_at();

create trigger condition_evaluations_set_updated_at
before update on public.condition_evaluations
for each row execute function public.set_updated_at();

create index requirement_conditions_project_idx on public.requirement_conditions(project_id);
create index requirement_conditions_requirement_order_idx on public.requirement_conditions(requirement_id, condition_order);
create index requirement_conditions_type_idx on public.requirement_conditions(condition_type);
create index condition_evaluations_project_idx on public.condition_evaluations(project_id);
create index condition_evaluations_review_status_idx on public.condition_evaluations(review_id, status);
create index condition_evaluations_finding_idx on public.condition_evaluations(finding_id);
create index condition_evaluations_condition_idx on public.condition_evaluations(requirement_condition_id);
create index condition_evaluations_human_review_idx
  on public.condition_evaluations(project_id, is_human_review_required)
  where is_human_review_required;
create index condition_evidence_regions_evaluation_idx on public.condition_evidence_regions(condition_evaluation_id);
create index condition_evidence_regions_region_idx
  on public.condition_evidence_regions(evidence_region_id)
  where evidence_region_id is not null;
create unique index condition_evidence_regions_missing_expected_idx
  on public.condition_evidence_regions(condition_evaluation_id)
  where relationship_type = 'missing_expected_region';
create index document_annotations_requirement_condition_idx
  on public.document_annotations(requirement_condition_id)
  where requirement_condition_id is not null;
create index document_annotations_condition_evaluation_idx
  on public.document_annotations(condition_evaluation_id)
  where condition_evaluation_id is not null;
create index document_annotations_requirement_document_idx
  on public.document_annotations(source_requirement_document_id)
  where source_requirement_document_id is not null;

alter table public.requirement_conditions enable row level security;
alter table public.condition_evaluations enable row level security;
alter table public.condition_evidence_regions enable row level security;

create policy "requirement conditions visible within organization"
on public.requirement_conditions for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "writers manage requirement conditions within organization"
on public.requirement_conditions for all
using (organization_id = public.current_organization_id() and public.can_write())
with check (organization_id = public.current_organization_id() and public.can_write());

create policy "condition evaluations visible within organization"
on public.condition_evaluations for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "writers manage condition evaluations within organization"
on public.condition_evaluations for all
using (organization_id = public.current_organization_id() and public.can_write())
with check (
  organization_id = public.current_organization_id()
  and public.can_write()
  and (reviewed_by is null or reviewed_by = (public.current_profile()).id)
);

create policy "condition evidence links visible within organization"
on public.condition_evidence_regions for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "writers manage condition evidence links within organization"
on public.condition_evidence_regions for all
using (organization_id = public.current_organization_id() and public.can_write())
with check (organization_id = public.current_organization_id() and public.can_write());
