# Railway Worker Deployment Guide

## Architecture

```
Client browser
    │
    ▼
Vercel (Next.js web application)
    │
    ▼
Supabase (database, authentication, storage)
    ▲
    │
Railway (continuous document processing worker)
```

The web application and the worker share the same Supabase project. The worker
reads and writes Supabase directly via the service-role client. No HTTP calls
pass between Vercel and Railway.

---

## Railway Service Setup

### 1. Create the service

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo.
2. Select the `CompliAgent` repository.
3. Railway will auto-detect the Node.js project.

### 2. Set the start command

In Railway Settings → Deploy:

```
pnpm worker:documents:watch
```

This runs the continuous watch worker. Railway restarts it automatically on crash.

### 3. Set environment variables

Set these variables in Railway → Variables. Railway injects them into `process.env`
at runtime — no `.env` file is needed or used.

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Required** | Your Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** | Supabase service-role key (never the anon key) |
| `SUPABASE_STORAGE_BUCKET_DOCUMENTS` | Optional | Storage bucket name (default: `documents`) |
| `WORKER_DOCUMENT_BATCH_SIZE` | Optional | Max docs per poll cycle (default: `10`, max: `100`) |
| `WORKER_DOCUMENT_POLL_INTERVAL_MS` | Optional | Poll delay after productive batch in ms (default: `3000`) |
| `WORKER_DOCUMENT_IDLE_BACKOFF_MS` | Optional | Poll delay when queue empty in ms (default: `5000`) |

**Security**: Never set `NEXT_PUBLIC_SUPABASE_ANON_KEY` on Railway — the anon key
is not needed by the worker.

### 4. Verify healthy startup logs

After deployment, the Railway log panel should show:

```
Document watch worker starting (Ctrl+C to stop)…
  Batch size:          10
  Poll interval:       3000ms
  Idle backoff:        5000ms
  Supabase configuration: present
  Documents bucket:    documents (configured)
  Worker ID:           watch-railway-XXXX-XXXX
[watch-worker] Starting. batchSize=10 pollIntervalMs=3000 idleBackoffMs=5000
```

The worker polls every 3 seconds and backs off to 5 seconds on an empty queue.
No output during idle is expected — the worker logs only when it processes jobs.

---

## Worker Liveness Monitoring

The worker upserts a heartbeat row into the `worker_liveness` Supabase table
every 30 seconds. The CompliAgent web application reads this table to show
accurate messaging on the progress page:

| Heartbeat age | Web app shows |
|---|---|
| ≤ 2 minutes | "Processing uploaded documents." |
| 2–10 minutes | "The document-processing service is temporarily unavailable…" |
| > 10 minutes or no row | "The document-processing service is temporarily unavailable…" |

To check liveness manually, run in Supabase SQL editor:

```sql
select worker_type, worker_id, last_heartbeat_at,
       now() - last_heartbeat_at as age
from worker_liveness;
```

---

## Crash and Restart Behavior

Railway restarts the service automatically on crash. The watch worker is
stateless — on restart it:

1. Loads env vars from Railway (no `.env` file needed).
2. Validates required env vars — exits with a safe error if missing.
3. Resumes polling the `processing_jobs` queue.
4. Recovers any abandoned jobs (claimed by the previous instance) via the
   `recover_abandoned_processing_jobs` RPC.

Jobs claimed by a crashed worker are recovered automatically on the next
startup. No manual intervention is required.

---

## Troubleshooting

### Worker starts but no jobs are processed

1. Check Supabase that documents exist with `status = 'queued'` in `processing_jobs`.
2. Confirm `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct.
3. Run `pnpm deploy:check` locally to verify all schema requirements.

### Worker fails with "missing environment variable"

Railway is missing a required variable. Check Railway → Variables and ensure
both `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set.

### Progress page shows "temporarily unavailable"

The worker heartbeat in `worker_liveness` is stale (older than 10 minutes) or
absent. Check the Railway service is running and the Supabase connection is
healthy. Apply the `20260703000000_worker_liveness.sql` migration if not yet
applied.

### Worker exits with code 2

A required environment variable is missing. Check Railway Variables.

### Worker exits with code 3

A runtime error occurred after startup (e.g., Supabase connection refused).
Check Railway logs for the specific error and verify Supabase project status.

---

## Required Supabase Migrations

All migrations in `supabase/migrations/` must be applied to the Supabase
project before the worker can function. Apply them in filename order via the
Supabase dashboard SQL editor or the Supabase CLI:

```
20260530170000_initial_schema.sql
20260620120000_visual_evidence_annotation_foundation.sql
20260620233000_requirement_condition_evaluation_foundation.sql
20260620235900_controlled_ai_architecture_foundation.sql
20260625000000_condition_persistence_transactional_foundation.sql
20260626000000_durable_document_processing_queue.sql
20260627000000_coordinate_aware_extraction_and_ocr_foundation.sql
20260628000000_controlled_review_pipeline.sql
20260628000001_controlled_review_pipeline_schema.sql
20260629000000_provisional_requirement_persistence.sql
20260630000000_annotation_outputs.sql
20260701000000_processing_job_dedup_index.sql
20260702000000_review_execution_mode.sql
20260703000000_worker_liveness.sql
```

---

## Final Railway Setup Checklist

- [ ] Railway project created from GitHub repo
- [ ] Start command set to `pnpm worker:documents:watch`
- [ ] `NEXT_PUBLIC_SUPABASE_URL` set in Railway Variables
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set in Railway Variables
- [ ] All Supabase migrations applied (including `20260703000000_worker_liveness.sql`)
- [ ] `documents` storage bucket exists and is private
- [ ] Worker starts and logs "Supabase configuration: present"
- [ ] Worker liveness row appears in `worker_liveness` table within 30 seconds
- [ ] Web app progress page shows "Processing uploaded documents." when a job is running
