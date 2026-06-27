-- Controlled AI architecture foundation.
-- Manual review/application only. This migration does not enable or call an AI provider.

create type public.ai_provider as enum ('openai', 'anthropic', 'gemini', 'mistral', 'openrouter');

create type public.ai_task_type as enum (
  'document_classification',
  'document_understanding',
  'requirement_extraction',
  'requirement_decomposition',
  'evidence_retrieval',
  'condition_comparison',
  'standards_applicability',
  'finding_verification',
  'annotation_comment_generation',
  'report_summary',
  'project_chat'
);

create type public.ai_run_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');
create type public.ai_validation_status as enum ('pending', 'passed', 'failed', 'repaired');
create type public.ai_verification_status as enum ('pending', 'passed', 'failed', 'not_required');

create table public.organization_ai_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  ai_enabled boolean not null default false,
  consent_granted_at timestamptz,
  consent_granted_by uuid,
  consent_document_version text,
  default_provider public.ai_provider,
  enabled_providers public.ai_provider[] not null default '{}'::public.ai_provider[],
  model_routes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_ai_settings_consent_profile_fk
    foreign key (consent_granted_by, organization_id)
    references public.profiles(id, organization_id),
  constraint organization_ai_settings_consent_check check (
    (consent_granted_at is null and consent_granted_by is null and consent_document_version is null)
    or (consent_granted_at is not null and consent_granted_by is not null and consent_document_version is not null)
  ),
  constraint organization_ai_settings_enablement_check check (
    ai_enabled = false
    or (
      consent_granted_at is not null
      and default_provider is not null
      and default_provider = any(enabled_providers)
    )
  ),
  constraint organization_ai_settings_model_routes_object_check
    check (jsonb_typeof(model_routes) = 'object')
);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null,
  review_id uuid,
  document_id uuid,
  task_type public.ai_task_type not null,
  provider public.ai_provider not null,
  model text not null check (length(trim(model)) > 0),
  prompt_version text not null check (length(trim(prompt_version)) > 0),
  provider_run_id text,
  input_hash text not null check (input_hash ~ '^[0-9a-fA-F]{64}$'),
  status public.ai_run_status not null default 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost numeric(12,6) check (estimated_cost is null or estimated_cost >= 0),
  validation_status public.ai_validation_status not null default 'pending',
  verification_status public.ai_verification_status not null default 'pending',
  error_code text,
  error_message text,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint ai_runs_project_organization_fk
    foreign key (project_id, organization_id)
    references public.projects(id, organization_id)
    on delete cascade,
  constraint ai_runs_review_project_fk
    foreign key (review_id, project_id)
    references public.compliance_reviews(id, project_id)
    on delete cascade,
  constraint ai_runs_document_scope_fk
    foreign key (document_id, project_id, organization_id)
    references public.documents(id, project_id, organization_id)
    on delete cascade,
  constraint ai_runs_created_by_organization_fk
    foreign key (created_by, organization_id)
    references public.profiles(id, organization_id),
  constraint ai_runs_terminal_time_check check (
    (status in ('queued', 'running') and completed_at is null)
    or (status in ('completed', 'failed', 'cancelled') and completed_at is not null)
  ),
  constraint ai_runs_started_time_check check (
    status = 'queued' or started_at is not null
  ),
  constraint ai_runs_failed_error_check check (
    status <> 'failed'
    or (error_code is not null and length(trim(error_code)) > 0 and error_message is not null and length(trim(error_message)) > 0)
  )
);

create trigger organization_ai_settings_set_updated_at
before update on public.organization_ai_settings
for each row execute function public.set_updated_at();

create index ai_runs_organization_status_idx on public.ai_runs(organization_id, status, created_at desc);
create index ai_runs_project_task_idx on public.ai_runs(project_id, task_type, created_at desc);
create index ai_runs_review_idx on public.ai_runs(review_id) where review_id is not null;
create index ai_runs_document_idx on public.ai_runs(document_id) where document_id is not null;
create index ai_runs_provider_model_idx on public.ai_runs(provider, model, created_at desc);

alter table public.organization_ai_settings enable row level security;
alter table public.ai_runs enable row level security;

create policy "AI settings visible within organization"
on public.organization_ai_settings for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "admins manage AI settings within organization"
on public.organization_ai_settings for all
using (
  (organization_id = public.current_organization_id() and public.can_manage())
  or public.current_user_role() = 'super_admin'
)
with check (
  (organization_id = public.current_organization_id() and public.can_manage())
  or public.current_user_role() = 'super_admin'
);

create policy "AI runs visible within organization"
on public.ai_runs for select
using (organization_id = public.current_organization_id() or public.current_user_role() = 'super_admin');

create policy "writers create AI runs within organization"
on public.ai_runs for insert
with check (
  organization_id = public.current_organization_id()
  and public.can_write()
  and created_by = (public.current_profile()).id
  and exists (
    select 1
    from public.organization_ai_settings settings
    where settings.organization_id = ai_runs.organization_id
      and settings.ai_enabled = true
      and settings.consent_granted_at is not null
      and ai_runs.provider = any(settings.enabled_providers)
  )
);

create policy "writers update AI runs within organization"
on public.ai_runs for update
using (organization_id = public.current_organization_id() and public.can_write())
with check (
  organization_id = public.current_organization_id()
  and public.can_write()
  and exists (
    select 1
    from public.organization_ai_settings settings
    where settings.organization_id = ai_runs.organization_id
      and settings.ai_enabled = true
      and settings.consent_granted_at is not null
      and ai_runs.provider = any(settings.enabled_providers)
  )
);
