-- Migration: 20260703000000_worker_liveness
--
-- Adds a worker_liveness table so the watch worker can periodically record a
-- heartbeat and the web application can distinguish:
--   recently active  — heartbeat within 2 minutes
--   stale            — heartbeat between 2–10 minutes ago
--   unknown          — no row found or heartbeat older than 10 minutes
--
-- The service-role client (used by the worker) bypasses RLS and can upsert
-- directly. Authenticated web clients can read the table to check liveness.

create table if not exists public.worker_liveness (
  worker_type       text        not null,
  worker_id         text        not null,
  last_heartbeat_at timestamptz not null default now(),
  started_at        timestamptz not null default now(),
  constraint worker_liveness_pkey primary key (worker_type)
);

alter table public.worker_liveness enable row level security;

-- Authenticated users can read worker liveness for progress-page messaging.
create policy "authenticated users can read worker liveness"
  on public.worker_liveness
  for select
  to authenticated
  using (true);

-- Index for efficient single-row lookup by worker type.
create index if not exists worker_liveness_worker_type_idx
  on public.worker_liveness (worker_type);
