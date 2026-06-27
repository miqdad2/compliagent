-- Durable document processing queue.
-- Additive only: does not enable live AI, OCR, or annotation rendering.
-- Adds durable locking fields and extraction versioning to processing_jobs.
-- Provides atomic RPCs for job claiming, page/chunk replacement, and abandoned-job recovery.

-- ============================================================
-- 1. New processing status enum values
-- ============================================================
-- 'claimed'    : atomically locked by a worker, not yet running
-- 'retry_wait' : waiting for the next retry attempt (available_at is in the future)

do $$ begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'claimed'
      and enumtypid = (select oid from pg_type where typname = 'processing_status')
  ) then
    alter type public.processing_status add value 'claimed';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_enum
    where enumlabel = 'retry_wait'
      and enumtypid = (select oid from pg_type where typname = 'processing_status')
  ) then
    alter type public.processing_status add value 'retry_wait';
  end if;
end $$;

-- ============================================================
-- 2. Durable processing_jobs fields
-- ============================================================

alter table public.processing_jobs
  add column if not exists priority integer not null default 5
    check (priority >= 1 and priority <= 10),
  add column if not exists attempts integer not null default 0,
  add column if not exists maximum_attempts integer not null default 4,
  add column if not exists available_at timestamptz not null default now(),
  add column if not exists locked_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists worker_id text,
  add column if not exists heartbeat_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists safe_error_message text,
  add column if not exists extraction_version text,
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- ============================================================
-- 3. Indexes for efficient job claiming and monitoring
-- ============================================================

create index if not exists processing_jobs_claimable_idx
  on public.processing_jobs(job_type, priority desc, available_at)
  where status in ('queued', 'retry_wait');

create index if not exists processing_jobs_running_heartbeat_idx
  on public.processing_jobs(heartbeat_at)
  where status in ('claimed', 'running');

create index if not exists processing_jobs_document_active_idx
  on public.processing_jobs(document_id, status)
  where status in ('queued', 'claimed', 'running', 'retry_wait');

-- ============================================================
-- 4. Atomic job claiming RPC
-- ============================================================
-- Uses FOR UPDATE SKIP LOCKED to prevent multiple workers from claiming the same job.
-- Increments attempts here so each claim attempt is counted even if the worker crashes
-- before completing.

create or replace function public.claim_processing_job(
  p_worker_id text,
  p_job_type  text
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_job_id uuid;
begin
  select id
  into v_job_id
  from public.processing_jobs
  where job_type = p_job_type::public.job_type
    and status in ('queued', 'retry_wait')
    and available_at <= now()
  order by priority desc, available_at
  limit 1
  for update skip locked;

  if v_job_id is null then
    return null;
  end if;

  update public.processing_jobs
  set
    status      = 'claimed',
    locked_at   = now(),
    locked_by   = p_worker_id,
    worker_id   = p_worker_id,
    heartbeat_at = now(),
    attempts    = attempts + 1
  where id = v_job_id;

  return v_job_id;
end;
$$;

comment on function public.claim_processing_job is
  'Atomically claims one available processing job for the given worker using '
  'SELECT ... FOR UPDATE SKIP LOCKED. Returns the claimed job id or null.';

-- ============================================================
-- 5. Atomic document extraction persistence RPC
-- ============================================================
-- Replaces all pages and chunks for a document within a single transaction.
-- If the insertion fails, the DELETE is rolled back and previous data is preserved.
-- Idempotent: if the same extraction_version and job_id were already committed,
-- returns the cached result without re-persisting.

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

  -- 2. Idempotency: if this extraction_version was already persisted for this job, return the cached result.
  if exists (
    select 1 from public.processing_jobs
    where id = p_job_id and extraction_version = p_extraction_version and status = 'completed'
  ) then
    select count(*) into v_page_count from public.document_pages where document_id = p_document_id;
    select count(*) into v_chunk_count from public.document_chunks where document_id = p_document_id;
    return jsonb_build_object(
      'pageCount', v_page_count,
      'chunkCount', v_chunk_count,
      'idempotent', true
    );
  end if;

  -- 3. Delete previous pages and chunks (within this transaction).
  delete from public.document_chunks where document_id = p_document_id;
  delete from public.document_pages where document_id = p_document_id;

  -- 4. Insert new pages.
  if p_pages is not null and jsonb_array_length(p_pages) > 0 then
    insert into public.document_pages (
      document_id,
      project_id,
      page_number,
      extracted_text,
      extraction_method,
      confidence
    )
    select
      p_document_id,
      p_project_id,
      (p->>'pageNumber')::integer,
      p->>'rawText',
      p->>'extractionMethod',
      case when p->>'confidence' is null then null else (p->>'confidence')::numeric end
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
    status              = 'completed',
    progress            = 100,
    extraction_version  = p_extraction_version,
    completed_at        = now(),
    heartbeat_at        = now(),
    updated_at          = now()
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
    'pageCount',   v_page_count,
    'chunkCount',  v_chunk_count,
    'idempotent',  false
  );

exception
  when others then
    raise exception '%', sqlerrm;
end;
$$;

comment on function public.replace_document_extraction_transactionally is
  'Atomically replaces all pages and chunks for a document within one transaction. '
  'If any insertion fails the DELETE is rolled back. Idempotent on matching '
  'extraction_version + job_id. The caller must verify ownership before calling.';

-- ============================================================
-- 6. Abandoned-job recovery RPC
-- ============================================================
-- Finds jobs in claimed/running state with a stale heartbeat and either schedules
-- a retry (if attempts < maximum_attempts) or permanently fails them.

create or replace function public.recover_abandoned_processing_jobs(
  p_heartbeat_threshold_minutes integer,
  p_worker_id                   text
) returns integer
language plpgsql
security invoker
as $$
declare
  v_job        record;
  v_recovered  integer := 0;
  v_cutoff     timestamptz := now() - (p_heartbeat_threshold_minutes * interval '1 minute');
begin
  for v_job in
    select id, attempts, maximum_attempts, organization_id, project_id, document_id
    from public.processing_jobs
    where status in ('claimed', 'running')
      and (heartbeat_at is null or heartbeat_at < v_cutoff)
    for update skip locked
  loop
    if v_job.attempts < v_job.maximum_attempts then
      -- Schedule a retry with bounded exponential backoff.
      update public.processing_jobs
      set
        status       = 'retry_wait',
        locked_at    = null,
        locked_by    = null,
        available_at = now() + (
          case v_job.attempts
            when 1 then interval '1 minute'
            when 2 then interval '5 minutes'
            when 3 then interval '15 minutes'
            else            interval '60 minutes'
          end
        ),
        safe_error_message = 'Worker heartbeat expired. Retrying.',
        last_error_code    = 'heartbeat_expired',
        heartbeat_at       = now()
      where id = v_job.id;
    else
      -- Permanently fail.
      update public.processing_jobs
      set
        status             = 'failed',
        failed_at          = now(),
        safe_error_message = 'Worker heartbeat expired and maximum attempts exhausted.',
        last_error_code    = 'heartbeat_expired_max_attempts'
      where id = v_job.id;

      update public.documents
      set processing_status = 'failed', updated_at = now()
      where id = v_job.document_id;
    end if;

    insert into public.audit_logs (
      organization_id, project_id, action, entity_type, entity_id, metadata
    ) values (
      v_job.organization_id,
      v_job.project_id,
      'document.processing_job_recovered',
      'processing_jobs',
      v_job.id,
      jsonb_build_object(
        'workerId',    p_worker_id,
        'attempts',    v_job.attempts,
        'maxAttempts', v_job.maximum_attempts,
        'action',      case when v_job.attempts < v_job.maximum_attempts then 'retry_scheduled' else 'permanently_failed' end
      )
    );

    v_recovered := v_recovered + 1;
  end loop;

  return v_recovered;
end;
$$;

comment on function public.recover_abandoned_processing_jobs is
  'Finds claimed/running jobs with stale heartbeats and either schedules a retry '
  '(bounded exponential backoff) or permanently fails them when maximum_attempts '
  'is exhausted. Returns the number of jobs recovered.';
