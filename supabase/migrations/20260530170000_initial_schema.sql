create extension if not exists "pgcrypto";
create extension if not exists "vector";

create type public.user_role as enum ('super_admin', 'admin', 'engineer', 'reviewer', 'viewer', 'contractor');
create type public.project_status as enum (
  'draft',
  'documents_uploaded',
  'processing',
  'ready_for_review',
  'ai_review_running',
  'ai_review_completed',
  'human_review_pending',
  'approved',
  'rejected',
  'archived'
);
create type public.document_role as enum (
  'main_specification',
  'reference_standard',
  'proposed_product',
  'product_datasheet',
  'certificate',
  'drawing',
  'manual',
  'compliance_statement',
  'supporting_evidence',
  'other'
);
create type public.processing_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');
create type public.compliance_status as enum (
  'complied',
  'partially_complied',
  'not_complied',
  'ambiguous_not_proven',
  'not_applicable',
  'not_verified'
);
create type public.risk_level as enum ('low', 'medium', 'high', 'critical');
create type public.review_status as enum ('draft', 'running', 'completed', 'failed', 'human_review_pending', 'approved');
create type public.job_type as enum (
  'document_extraction',
  'ocr',
  'table_extraction',
  'embedding_generation',
  'requirement_extraction',
  'evidence_extraction',
  'standards_applicability',
  'compliance_review',
  'reviewer_check',
  'report_generation'
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  full_name text,
  role public.user_role not null default 'viewer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  client_name text not null,
  discipline text not null,
  review_type text not null,
  description text,
  status public.project_status not null default 'draft',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  document_role public.document_role not null,
  version integer not null default 1 check (version > 0),
  page_count integer,
  processing_status public.processing_status not null default 'queued',
  ocr_required boolean not null default false,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  extracted_text text,
  extraction_method text not null,
  confidence numeric(4,3) check (confidence >= 0 and confidence <= 1),
  image_path text,
  created_at timestamptz not null default now(),
  unique (document_id, page_number)
);

create table public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  clause_number text,
  section_heading text,
  chunk_text text not null,
  normalized_text text not null,
  embedding vector(1536),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.extracted_requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_document_id uuid not null references public.documents(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  clause_number text,
  sub_clause_number text,
  requirement_text text not null,
  requirement_type text,
  discipline text,
  mandatory_level text,
  numeric_value numeric,
  unit text,
  standard_reference text,
  acceptance_criteria text,
  extraction_confidence numeric(5,2) not null check (extraction_confidence >= 0 and extraction_confidence <= 100),
  created_at timestamptz not null default now()
);

create table public.extracted_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_document_id uuid not null references public.documents(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  clause_number text,
  evidence_text text not null,
  evidence_type text,
  product_model text,
  manufacturer text,
  numeric_value numeric,
  unit text,
  standard_reference text,
  extraction_confidence numeric(5,2) not null check (extraction_confidence >= 0 and extraction_confidence <= 100),
  created_at timestamptz not null default now()
);

create table public.compliance_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  review_scope text,
  status public.review_status not null default 'draft',
  ai_model text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.compliance_findings (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.compliance_reviews(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  requirement_id uuid references public.extracted_requirements(id) on delete set null,
  evidence_id uuid references public.extracted_evidence(id) on delete set null,
  clause_number text,
  sub_clause_number text,
  requirement_text text not null,
  evidence_text text,
  status public.compliance_status not null,
  weightage_score integer not null check (weightage_score >= 0 and weightage_score <= 10),
  confidence_score integer not null check (confidence_score >= 0 and confidence_score <= 100),
  reasoning text not null,
  missing_information text,
  contractor_action text,
  risk_level public.risk_level not null default 'medium',
  human_override_status public.compliance_status,
  human_comment text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contractor_clarifications (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.compliance_reviews(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  finding_id uuid references public.compliance_findings(id) on delete cascade,
  clause_number text,
  issue text not null,
  why_it_matters text not null,
  required_action text not null,
  required_document text not null,
  priority text not null check (priority in ('Critical', 'High', 'Medium', 'Low')),
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.report_exports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  review_id uuid not null references public.compliance_reviews(id) on delete cascade,
  export_type text not null check (export_type in ('excel', 'word', 'pdf', 'chat_summary')),
  storage_path text not null,
  generated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  review_id uuid references public.compliance_reviews(id) on delete cascade,
  job_type public.job_type not null,
  status public.processing_status not null default 'queued',
  progress integer not null default 0 check (progress >= 0 and progress <= 100),
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger projects_set_updated_at before update on public.projects for each row execute function public.set_updated_at();
create trigger documents_set_updated_at before update on public.documents for each row execute function public.set_updated_at();
create trigger compliance_reviews_set_updated_at before update on public.compliance_reviews for each row execute function public.set_updated_at();
create trigger compliance_findings_set_updated_at before update on public.compliance_findings for each row execute function public.set_updated_at();
create trigger contractor_clarifications_set_updated_at before update on public.contractor_clarifications for each row execute function public.set_updated_at();
create trigger processing_jobs_set_updated_at before update on public.processing_jobs for each row execute function public.set_updated_at();

create or replace function public.current_profile()
returns public.profiles
language sql
security definer
set search_path = public
stable
as $$
  select *
  from public.profiles
  where user_id = auth.uid()
  limit 1
$$;

create or replace function public.current_organization_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select organization_id from public.profiles where user_id = auth.uid() limit 1
$$;

create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where user_id = auth.uid() limit 1
$$;

create or replace function public.can_write()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_user_role() in ('super_admin', 'admin', 'engineer', 'reviewer'), false)
$$;

create or replace function public.can_manage()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_user_role() in ('super_admin', 'admin'), false)
$$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.documents enable row level security;
alter table public.document_pages enable row level security;
alter table public.document_chunks enable row level security;
alter table public.extracted_requirements enable row level security;
alter table public.extracted_evidence enable row level security;
alter table public.compliance_reviews enable row level security;
alter table public.compliance_findings enable row level security;
alter table public.contractor_clarifications enable row level security;
alter table public.report_exports enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.audit_logs enable row level security;

create policy "organization members can read their organization"
on public.organizations for select
using (id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "admins can update their organization"
on public.organizations for update
using ((id = public.current_organization_id() and public.can_manage()) or public.current_user_role() = 'super_admin');

create policy "profiles are visible within organization"
on public.profiles for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "admins manage profiles in organization"
on public.profiles for all
using ((organization_id = public.current_organization_id() and public.can_manage()) or public.current_user_role() = 'super_admin')
with check ((organization_id = public.current_organization_id() and public.can_manage()) or public.current_user_role() = 'super_admin');

create policy "projects are visible within organization"
on public.projects for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "writers create projects in organization"
on public.projects for insert
with check (organization_id = public.current_organization_id() and public.can_write());

create policy "writers update projects in organization"
on public.projects for update
using (organization_id = public.current_organization_id() and public.can_write())
with check (organization_id = public.current_organization_id() and public.can_write());

create policy "admins delete projects in organization"
on public.projects for delete
using (organization_id = public.current_organization_id() and public.can_manage());

create policy "documents are visible within organization"
on public.documents for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "writers manage documents in organization"
on public.documents for all
using (organization_id = public.current_organization_id() and public.can_write())
with check (organization_id = public.current_organization_id() and public.can_write());

create policy "document pages visible by project organization"
on public.document_pages for select
using (exists (
  select 1 from public.projects p
  where p.id = document_pages.project_id
  and (p.organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin')
));

create policy "writers manage document pages"
on public.document_pages for all
using (exists (select 1 from public.projects p where p.id = document_pages.project_id and p.organization_id = public.current_organization_id() and public.can_write()))
with check (exists (select 1 from public.projects p where p.id = document_pages.project_id and p.organization_id = public.current_organization_id() and public.can_write()));

create policy "document chunks visible by project organization"
on public.document_chunks for select
using (exists (
  select 1 from public.projects p
  where p.id = document_chunks.project_id
  and (p.organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin')
));

create policy "writers manage document chunks"
on public.document_chunks for all
using (exists (select 1 from public.projects p where p.id = document_chunks.project_id and p.organization_id = public.current_organization_id() and public.can_write()))
with check (exists (select 1 from public.projects p where p.id = document_chunks.project_id and p.organization_id = public.current_organization_id() and public.can_write()));

create policy "project child records visible within organization"
on public.extracted_requirements for select
using (exists (select 1 from public.projects p where p.id = extracted_requirements.project_id and (p.organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin')));

create policy "writers manage extracted requirements"
on public.extracted_requirements for all
using (exists (select 1 from public.projects p where p.id = extracted_requirements.project_id and p.organization_id = public.current_organization_id() and public.can_write()))
with check (exists (select 1 from public.projects p where p.id = extracted_requirements.project_id and p.organization_id = public.current_organization_id() and public.can_write()));

create policy "project evidence visible within organization"
on public.extracted_evidence for select
using (exists (select 1 from public.projects p where p.id = extracted_evidence.project_id and (p.organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin')));

create policy "writers manage extracted evidence"
on public.extracted_evidence for all
using (exists (select 1 from public.projects p where p.id = extracted_evidence.project_id and p.organization_id = public.current_organization_id() and public.can_write()))
with check (exists (select 1 from public.projects p where p.id = extracted_evidence.project_id and p.organization_id = public.current_organization_id() and public.can_write()));

create policy "reviews visible by project organization"
on public.compliance_reviews for select
using (exists (select 1 from public.projects p where p.id = compliance_reviews.project_id and (p.organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin')));

create policy "writers manage reviews"
on public.compliance_reviews for all
using (exists (select 1 from public.projects p where p.id = compliance_reviews.project_id and p.organization_id = public.current_organization_id() and public.can_write()))
with check (exists (select 1 from public.projects p where p.id = compliance_reviews.project_id and p.organization_id = public.current_organization_id() and public.can_write()));

create policy "findings visible by project organization"
on public.compliance_findings for select
using (exists (select 1 from public.projects p where p.id = compliance_findings.project_id and (p.organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin')));

create policy "writers manage findings"
on public.compliance_findings for all
using (exists (select 1 from public.projects p where p.id = compliance_findings.project_id and p.organization_id = public.current_organization_id() and public.can_write()))
with check (exists (select 1 from public.projects p where p.id = compliance_findings.project_id and p.organization_id = public.current_organization_id() and public.can_write()));

create policy "clarifications visible by project organization"
on public.contractor_clarifications for select
using (exists (select 1 from public.projects p where p.id = contractor_clarifications.project_id and (p.organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin')));

create policy "writers manage clarifications"
on public.contractor_clarifications for all
using (exists (select 1 from public.projects p where p.id = contractor_clarifications.project_id and p.organization_id = public.current_organization_id() and public.can_write()))
with check (exists (select 1 from public.projects p where p.id = contractor_clarifications.project_id and p.organization_id = public.current_organization_id() and public.can_write()));

create policy "report exports visible by project organization"
on public.report_exports for select
using (exists (select 1 from public.projects p where p.id = report_exports.project_id and (p.organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin')));

create policy "writers create report exports"
on public.report_exports for insert
with check (exists (select 1 from public.projects p where p.id = report_exports.project_id and p.organization_id = public.current_organization_id() and public.can_write()));

create policy "jobs visible within organization"
on public.processing_jobs for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "writers manage jobs"
on public.processing_jobs for all
using (organization_id = public.current_organization_id() and public.can_write())
with check (organization_id = public.current_organization_id() and public.can_write());

create policy "audit logs visible within organization"
on public.audit_logs for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "authenticated users can write audit logs for their organization"
on public.audit_logs for insert
with check (organization_id = public.current_organization_id());

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false), ('exports', 'exports', false)
on conflict (id) do nothing;

create policy "organization users can read scoped document objects"
on storage.objects for select
using (
  bucket_id in ('documents', 'exports')
  and auth.role() = 'authenticated'
  and split_part(name, '/', 2)::uuid = public.current_organization_id()
);

create policy "writers can upload scoped document objects"
on storage.objects for insert
with check (
  bucket_id in ('documents', 'exports')
  and auth.role() = 'authenticated'
  and public.can_write()
  and split_part(name, '/', 2)::uuid = public.current_organization_id()
);
