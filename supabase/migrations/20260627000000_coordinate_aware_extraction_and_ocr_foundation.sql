-- Coordinate-aware extraction and OCR foundation.
-- Additive only: no paid OCR, no live LLM, no external transmission, no annotation rendering.
-- Adds slide_emu to coordinate system enum.
-- Extends document_pages with coordinate and quality metadata.
-- Extends evidence_regions with normalized coordinates and provenance columns.
-- Updates the extraction persistence RPC to include new page fields.

-- ============================================================
-- 1. Add slide_emu to document_coordinate_system enum
-- ============================================================

do $$ begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'slide_emu'
      and enumtypid = (select oid from pg_type where typname = 'document_coordinate_system')
  ) then
    alter type public.document_coordinate_system add value 'slide_emu';
  end if;
end $$;

-- ============================================================
-- 2. Extend document_pages with coordinate and quality metadata
-- ============================================================

alter table public.document_pages
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists normalized_text  text,
  add column if not exists source_hash      text,
  add column if not exists source_label     text,
  add column if not exists ocr_required     boolean not null default false,
  add column if not exists page_width       numeric,
  add column if not exists page_height      numeric,
  add column if not exists page_rotation    smallint check (page_rotation in (0, 90, 180, 270)),
  add column if not exists coordinate_system text;

-- Backfill organization_id from parent document where still null.
update public.document_pages dp
set organization_id = d.organization_id
from public.documents d
where dp.document_id = d.id
  and dp.organization_id is null;

-- ============================================================
-- 3. Extend evidence_regions with normalized coordinates and provenance
-- ============================================================

alter table public.evidence_regions
  add column if not exists normalized_x         numeric check (normalized_x >= 0 and normalized_x <= 1),
  add column if not exists normalized_y         numeric check (normalized_y >= 0 and normalized_y <= 1),
  add column if not exists normalized_width     numeric check (normalized_width > 0 and normalized_width <= 1),
  add column if not exists normalized_height    numeric check (normalized_height > 0 and normalized_height <= 1),
  add column if not exists extraction_method    text,
  add column if not exists job_id               uuid references public.processing_jobs(id) on delete set null,
  add column if not exists extraction_version   text;

-- Index to find regions for a given job (useful for provenance queries).
create index if not exists evidence_regions_job_idx
  on public.evidence_regions(job_id)
  where job_id is not null;

-- ============================================================
-- 4. Updated extraction persistence RPC (includes new page fields)
-- ============================================================

create or replace function public.replace_document_extraction_transactionally(
  p_document_id         uuid,
  p_organization_id     uuid,
  p_project_id          uuid,
  p_job_id              uuid,
  p_extraction_version  text,
  p_page_count          integer,
  p_ocr_required        boolean,
  p_pages               jsonb,
  p_chunks              jsonb,
  p_created_by          uuid
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_doc_org     uuid;
  v_page_count  integer;
  v_chunk_count integer;
begin
  -- 1. Verify document ownership.
  select organization_id
  into v_doc_org
  from public.documents
  where id = p_document_id
    and project_id = p_project_id;

  if not found then
    raise exception 'DOCUMENT_NOT_FOUND: Document % not found for project %.',
      p_document_id, p_project_id;
  end if;

  if v_doc_org <> p_organization_id then
    raise exception 'ORGANIZATION_MISMATCH: Document % belongs to a different organization.',
      p_document_id;
  end if;

  -- 2. Idempotency: if this extraction_version was already persisted for this job, return cached result.
  if exists (
    select 1 from public.processing_jobs
    where id = p_job_id and extraction_version = p_extraction_version and status = 'completed'
  ) then
    select count(*) into v_page_count  from public.document_pages  where document_id = p_document_id;
    select count(*) into v_chunk_count from public.document_chunks where document_id = p_document_id;
    return jsonb_build_object(
      'pageCount', v_page_count,
      'chunkCount', v_chunk_count,
      'idempotent', true
    );
  end if;

  -- 3. Delete previous pages and chunks (within this transaction).
  delete from public.document_chunks where document_id = p_document_id;
  delete from public.document_pages  where document_id = p_document_id;

  -- 4. Insert new pages with extended metadata.
  if p_pages is not null and jsonb_array_length(p_pages) > 0 then
    insert into public.document_pages (
      document_id,
      organization_id,
      project_id,
      page_number,
      extracted_text,
      normalized_text,
      extraction_method,
      confidence,
      ocr_required,
      source_hash,
      source_label,
      page_width,
      page_height,
      page_rotation,
      coordinate_system
    )
    select
      p_document_id,
      p_organization_id,
      p_project_id,
      (p->>'pageNumber')::integer,
      p->>'rawText',
      p->>'normalizedText',
      p->>'extractionMethod',
      case when p->>'confidence' is null then null else (p->>'confidence')::numeric end,
      coalesce((p->>'ocrRecommended')::boolean, false),
      p->>'sourceHash',
      p->>'sourceLabel',
      case when p->>'pageWidth' is null then null else (p->>'pageWidth')::numeric end,
      case when p->>'pageHeight' is null then null else (p->>'pageHeight')::numeric end,
      case when p->>'pageRotation' is null then null else (p->>'pageRotation')::smallint end,
      p->>'coordinateSystem'
    from jsonb_array_elements(p_pages) as p;
  end if;

  -- 5. Insert new chunks.
  if p_chunks is not null and jsonb_array_length(p_chunks) > 0 then
    insert into public.document_chunks (
      document_id,
      project_id,
      page_number,
      clause_number,
      section_heading,
      chunk_text,
      normalized_text,
      metadata
    )
    select
      p_document_id,
      p_project_id,
      (c->>'pageNumber')::integer,
      nullif(c->>'clauseNumber', ''),
      nullif(c->>'sectionHeading', ''),
      c->>'chunkText',
      c->>'normalizedText',
      jsonb_build_object(
        'chunkIndex',       (c->>'chunkIndex')::integer,
        'tokenCount',       (c->>'tokenCount')::integer,
        'extractionMethod', c->>'extractionMethod',
        'confidence',       case when c->>'confidence' is null then null else (c->>'confidence')::numeric end,
        'sourceLabel',      c->>'sourceLabel'
      )
    from jsonb_array_elements(p_chunks) as c;
  end if;

  select count(*) into v_page_count  from public.document_pages  where document_id = p_document_id;
  select count(*) into v_chunk_count from public.document_chunks where document_id = p_document_id;

  -- 6. Update document status and metadata.
  update public.documents
  set
    processing_status = case when p_ocr_required then 'failed' else 'completed' end :: public.processing_status,
    page_count        = p_page_count,
    ocr_required      = p_ocr_required,
    updated_at        = now()
  where id = p_document_id;

  -- 7. Mark the job completed.
  update public.processing_jobs
  set
    status             = 'completed',
    progress           = 100,
    extraction_version = p_extraction_version,
    completed_at       = now(),
    heartbeat_at       = now(),
    updated_at         = now()
  where id = p_job_id;

  -- 8. Write audit event.
  insert into public.audit_logs (
    organization_id, project_id, user_id, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id,
    p_project_id,
    p_created_by,
    'document.extraction_persisted',
    'documents',
    p_document_id,
    jsonb_build_object(
      'jobId',             p_job_id,
      'extractionVersion', p_extraction_version,
      'pageCount',         v_page_count,
      'chunkCount',        v_chunk_count,
      'ocrRequired',       p_ocr_required
    )
  );

  return jsonb_build_object(
    'pageCount',  v_page_count,
    'chunkCount', v_chunk_count,
    'idempotent', false
  );

exception
  when others then
    raise exception '%', sqlerrm;
end;
$$;

comment on function public.replace_document_extraction_transactionally is
  'Atomically replaces all pages and chunks for a document within one transaction. '
  'Includes coordinate and quality metadata in document_pages. '
  'If any insertion fails the DELETE is rolled back. Idempotent on matching '
  'extraction_version + job_id. The caller must verify ownership before calling.';
