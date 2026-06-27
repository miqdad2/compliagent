-- Annotation output tracking.
-- Records the metadata for each generated annotated PDF artifact.
-- The actual files are stored in Supabase Storage (exports bucket).
-- Applied after: 20260629000000_provisional_requirement_persistence.sql

create table if not exists public.annotation_outputs (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id),
  project_id          uuid not null references public.projects(id),
  review_id           uuid not null references public.compliance_reviews(id),
  source_document_id  uuid not null references public.documents(id),
  source_hash         text not null,
  output_storage_path text not null,
  output_hash         text not null,
  page_count          integer not null check (page_count > 0),
  annotation_count    integer not null default 0,
  renderer_version    text not null,
  contract_version    text not null,
  draft_status        text not null default 'draft'
                        check (draft_status in ('draft', 'approved', 'superseded')),
  finding_ids         jsonb not null default '[]'::jsonb,
  warnings            jsonb not null default '[]'::jsonb,
  approved_by         uuid references public.profiles(id),
  approved_at         timestamptz,
  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.annotation_outputs enable row level security;

create policy "annotation_outputs_org_select"
  on public.annotation_outputs for select
  using (
    organization_id in (
      select organization_id from public.profiles where user_id = auth.uid()
    )
  );

create policy "annotation_outputs_org_insert"
  on public.annotation_outputs for insert
  with check (
    organization_id in (
      select organization_id from public.profiles where user_id = auth.uid()
    )
  );

create policy "annotation_outputs_org_update"
  on public.annotation_outputs for update
  using (
    organization_id in (
      select organization_id from public.profiles where user_id = auth.uid()
    )
  );

create index if not exists annotation_outputs_review_idx
  on public.annotation_outputs(review_id, draft_status);

create index if not exists annotation_outputs_org_project_idx
  on public.annotation_outputs(organization_id, project_id);
