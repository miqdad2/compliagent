-- Visual evidence mapping and document annotation foundation.
-- This migration is additive and does not render or modify uploaded documents.

alter type public.compliance_status add value if not exists 'ambiguous';
alter type public.compliance_status add value if not exists 'not_proven';
alter type public.compliance_status add value if not exists 'exceeds_requirement';

alter type public.job_type add value if not exists 'page_rendering';
alter type public.job_type add value if not exists 'image_region_detection';
alter type public.job_type add value if not exists 'evidence_region_mapping';
alter type public.job_type add value if not exists 'annotation_generation';

create type public.evidence_region_type as enum (
  'text',
  'table',
  'image',
  'diagram',
  'cell',
  'signature',
  'stamp',
  'other'
);

create type public.document_coordinate_system as enum (
  'normalized',
  'pdf_points',
  'pixels',
  'spreadsheet_cells'
);

create type public.finding_evidence_relationship as enum (
  'supports',
  'contradicts',
  'context'
);

create type public.annotation_type as enum (
  'highlight',
  'callout',
  'connector',
  'evidence_marker'
);

create type public.annotation_status as enum (
  'draft',
  'pending_review',
  'approved',
  'rejected',
  'deleted'
);

create type public.annotation_approval_status as enum (
  'pending',
  'approved',
  'rejected'
);

-- These redundant unique constraints are intentional: they provide composite
-- foreign-key targets that enforce tenant and parent ownership on child rows.
alter table public.profiles
  add constraint profiles_id_organization_key unique (id, organization_id);

alter table public.projects
  add constraint projects_id_organization_key unique (id, organization_id);

alter table public.documents
  add constraint documents_id_project_organization_key unique (id, project_id, organization_id);

alter table public.compliance_reviews
  add constraint compliance_reviews_id_project_key unique (id, project_id);

alter table public.compliance_findings
  add constraint compliance_findings_id_project_key unique (id, project_id),
  add constraint compliance_findings_id_review_project_key unique (id, review_id, project_id);

create table public.evidence_regions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  document_id uuid not null,
  page_number integer check (page_number is null or page_number > 0),
  slide_number integer check (slide_number is null or slide_number > 0),
  sheet_name text,
  cell_range text,
  region_type public.evidence_region_type not null,
  x numeric,
  y numeric,
  width numeric,
  height numeric,
  coordinate_system public.document_coordinate_system not null,
  extracted_text text,
  extraction_confidence numeric(5,4) not null check (extraction_confidence >= 0 and extraction_confidence <= 1),
  source_hash text not null check (length(trim(source_hash)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint evidence_regions_project_organization_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete cascade,
  constraint evidence_regions_document_scope_fk
    foreign key (document_id, project_id, organization_id)
    references public.documents(id, project_id, organization_id)
    on delete cascade,
  constraint evidence_regions_source_locator_check check (
    page_number is not null
    or slide_number is not null
    or (sheet_name is not null and length(trim(sheet_name)) > 0)
  ),
  constraint evidence_regions_cell_locator_check check (
    coordinate_system <> 'spreadsheet_cells'
    or (
      sheet_name is not null
      and length(trim(sheet_name)) > 0
      and cell_range is not null
      and length(trim(cell_range)) > 0
    )
  ),
  constraint evidence_regions_coordinates_check check (
    (
      x is null and y is null and width is null and height is null
      and coordinate_system = 'spreadsheet_cells'
    )
    or (
      x is not null and y is not null and width is not null and height is not null
      and x >= 0 and y >= 0 and width > 0 and height > 0
      and (
        coordinate_system <> 'normalized'
        or (x <= 1 and y <= 1 and width <= 1 and height <= 1 and x + width <= 1 and y + height <= 1)
      )
    )
  ),
  unique (id, project_id, organization_id),
  unique (id, document_id, project_id, organization_id)
);

create table public.finding_evidence_regions (
  finding_id uuid not null,
  evidence_region_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  relationship_type public.finding_evidence_relationship not null default 'supports',
  created_at timestamptz not null default now(),
  primary key (finding_id, evidence_region_id),
  constraint finding_evidence_regions_project_organization_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete cascade,
  constraint finding_evidence_regions_finding_scope_fk
    foreign key (finding_id, project_id)
    references public.compliance_findings(id, project_id)
    on delete cascade,
  constraint finding_evidence_regions_region_scope_fk
    foreign key (evidence_region_id, project_id, organization_id)
    references public.evidence_regions(id, project_id, organization_id)
    on delete cascade
);

create table public.document_annotations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  review_id uuid not null,
  finding_id uuid not null,
  document_id uuid not null,
  evidence_region_id uuid not null,
  page_number integer not null check (page_number > 0),
  annotation_type public.annotation_type not null,
  status public.annotation_status not null default 'draft',
  label text not null check (length(trim(label)) > 0),
  comment text,
  source_reference text not null check (length(trim(source_reference)) > 0),
  clause_number text,
  sub_clause_number text,
  compliance_status public.compliance_status not null,
  reasoning text not null check (length(trim(reasoning)) > 0),
  missing_information text,
  contractor_action text,
  x numeric not null check (x >= 0),
  y numeric not null check (y >= 0),
  width numeric not null check (width > 0),
  height numeric not null check (height > 0),
  coordinate_system public.document_coordinate_system not null default 'normalized',
  connector_target_region_id uuid,
  style_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(style_metadata) = 'object'),
  is_ai_generated boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_annotations_project_organization_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete cascade,
  constraint document_annotations_document_scope_fk
    foreign key (document_id, project_id, organization_id)
    references public.documents(id, project_id, organization_id)
    on delete cascade,
  constraint document_annotations_review_scope_fk
    foreign key (review_id, project_id)
    references public.compliance_reviews(id, project_id)
    on delete cascade,
  constraint document_annotations_finding_scope_fk
    foreign key (finding_id, review_id, project_id)
    references public.compliance_findings(id, review_id, project_id),
  constraint document_annotations_evidence_scope_fk
    foreign key (evidence_region_id, document_id, project_id, organization_id)
    references public.evidence_regions(id, document_id, project_id, organization_id),
  constraint document_annotations_connector_target_fk
    foreign key (connector_target_region_id, document_id, project_id, organization_id)
    references public.evidence_regions(id, document_id, project_id, organization_id),
  constraint document_annotations_creator_scope_fk
    foreign key (created_by, organization_id)
    references public.profiles(id, organization_id),
  constraint document_annotations_coordinates_check check (
    coordinate_system <> 'normalized'
    or (x <= 1 and y <= 1 and width <= 1 and height <= 1 and x + width <= 1 and y + height <= 1)
  ),
  unique (id, project_id, organization_id)
);

create table public.annotation_revisions (
  id uuid primary key default gen_random_uuid(),
  annotation_id uuid not null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  previous_payload jsonb not null check (jsonb_typeof(previous_payload) = 'object'),
  new_payload jsonb not null check (jsonb_typeof(new_payload) = 'object'),
  changed_by uuid not null,
  changed_at timestamptz not null default now(),
  constraint annotation_revisions_annotation_scope_fk
    foreign key (annotation_id, project_id, organization_id)
    references public.document_annotations(id, project_id, organization_id)
    on delete cascade,
  constraint annotation_revisions_changed_by_scope_fk
    foreign key (changed_by, organization_id)
    references public.profiles(id, organization_id),
  unique (annotation_id, revision_number)
);

create table public.annotation_approvals (
  id uuid primary key default gen_random_uuid(),
  annotation_id uuid not null unique,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null,
  approval_status public.annotation_approval_status not null default 'pending',
  reviewer_id uuid,
  reviewer_comment text,
  reviewed_at timestamptz,
  constraint annotation_approvals_annotation_scope_fk
    foreign key (annotation_id, project_id, organization_id)
    references public.document_annotations(id, project_id, organization_id)
    on delete cascade,
  constraint annotation_approvals_reviewer_scope_fk
    foreign key (reviewer_id, organization_id)
    references public.profiles(id, organization_id),
  constraint annotation_approvals_review_state_check check (
    (approval_status = 'pending' and reviewed_at is null)
    or (approval_status in ('approved', 'rejected') and reviewer_id is not null and reviewed_at is not null)
  )
);

create trigger evidence_regions_set_updated_at
before update on public.evidence_regions
for each row execute function public.set_updated_at();

create trigger document_annotations_set_updated_at
before update on public.document_annotations
for each row execute function public.set_updated_at();

create index evidence_regions_project_idx on public.evidence_regions(project_id);
create index evidence_regions_document_page_idx on public.evidence_regions(document_id, page_number);
create index evidence_regions_document_slide_idx on public.evidence_regions(document_id, slide_number) where slide_number is not null;
create index evidence_regions_document_sheet_idx on public.evidence_regions(document_id, sheet_name) where sheet_name is not null;
create index finding_evidence_regions_project_idx on public.finding_evidence_regions(project_id);
create index finding_evidence_regions_finding_idx on public.finding_evidence_regions(finding_id);
create index finding_evidence_regions_region_idx on public.finding_evidence_regions(evidence_region_id);
create index document_annotations_project_idx on public.document_annotations(project_id);
create index document_annotations_document_page_idx on public.document_annotations(document_id, page_number);
create index document_annotations_finding_idx on public.document_annotations(finding_id);
create index document_annotations_review_status_idx on public.document_annotations(review_id, status);
create index document_annotations_status_idx on public.document_annotations(status);
create index annotation_revisions_annotation_idx on public.annotation_revisions(annotation_id, revision_number desc);
create index annotation_revisions_changed_by_idx on public.annotation_revisions(changed_by, changed_at desc);
create index annotation_approvals_project_status_idx on public.annotation_approvals(project_id, approval_status);
create index annotation_approvals_reviewer_idx on public.annotation_approvals(reviewer_id, approval_status) where reviewer_id is not null;

alter table public.evidence_regions enable row level security;
alter table public.finding_evidence_regions enable row level security;
alter table public.document_annotations enable row level security;
alter table public.annotation_revisions enable row level security;
alter table public.annotation_approvals enable row level security;

create policy "evidence regions visible within organization"
on public.evidence_regions for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "writers manage evidence regions within organization"
on public.evidence_regions for all
using (organization_id = public.current_organization_id() and public.can_write())
with check (organization_id = public.current_organization_id() and public.can_write());

create policy "finding evidence links visible within organization"
on public.finding_evidence_regions for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "writers manage finding evidence links within organization"
on public.finding_evidence_regions for all
using (organization_id = public.current_organization_id() and public.can_write())
with check (organization_id = public.current_organization_id() and public.can_write());

create policy "annotations visible within organization"
on public.document_annotations for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "writers create annotations within organization"
on public.document_annotations for insert
with check (
  organization_id = public.current_organization_id()
  and public.can_write()
  and created_by = (public.current_profile()).id
);

create policy "writers update annotations within organization"
on public.document_annotations for update
using (organization_id = public.current_organization_id() and public.can_write())
with check (organization_id = public.current_organization_id() and public.can_write());

create policy "writers delete annotations within organization"
on public.document_annotations for delete
using (organization_id = public.current_organization_id() and public.can_write());

create policy "annotation revisions visible within organization"
on public.annotation_revisions for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "writers append annotation revisions within organization"
on public.annotation_revisions for insert
with check (
  organization_id = public.current_organization_id()
  and public.can_write()
  and changed_by = (public.current_profile()).id
);

create policy "annotation approvals visible within organization"
on public.annotation_approvals for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "reviewers create annotation approvals within organization"
on public.annotation_approvals for insert
with check (
  organization_id = public.current_organization_id()
  and public.can_write()
  and (reviewer_id is null or reviewer_id = (public.current_profile()).id)
);

create policy "reviewers update annotation approvals within organization"
on public.annotation_approvals for update
using (organization_id = public.current_organization_id() and public.can_write())
with check (
  organization_id = public.current_organization_id()
  and public.can_write()
  and (reviewer_id is null or reviewer_id = (public.current_profile()).id)
);
