# Vercel Web Application Deployment Guide

## What Runs on Vercel

The Next.js web application only. This includes:
- Authentication pages (login, signup, callback)
- Dashboard, project, document, and review workspace pages
- All `/api/` routes (authenticated, short-lived request handlers)

**The document processing worker does NOT run on Vercel.** It runs as a
separate Railway service. See `context/deployment-railway-worker.md`.

---

## Vercel Project Setup

### 1. Create the project

1. Go to [vercel.com](https://vercel.com) → Add New Project → Import Git Repository.
2. Select the `CompliAgent` repository.
3. Vercel detects Next.js automatically.

### 2. Build settings (auto-detected)

| Setting | Value |
|---|---|
| Framework | Next.js |
| Build command | `pnpm build` |
| Output directory | `.next` |
| Install command | `pnpm install --frozen-lockfile` |

### 3. Set environment variables

Set these in Vercel → Project Settings → Environment Variables.

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Required** | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Required** | Supabase anon/public key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** | Supabase service-role key (server-only, never exposed to browser) |
| `NEXT_PUBLIC_SHOW_DEV_TOOLS` | Optional | Set to `false` in production (default) |
| `APP_SESSION_SECRET` | Recommended | Secret for session signing |
| `ENCRYPTION_KEY` | Recommended | For encrypting sensitive data at rest |
| `NEXT_PUBLIC_APP_URL` | Optional | Full URL of the deployment (e.g. `https://compliagent.vercel.app`) |

**Important**: `NEXT_PUBLIC_*` variables are included in the browser bundle.
Only place public/non-secret values in `NEXT_PUBLIC_*` variables.
`SUPABASE_SERVICE_ROLE_KEY` is server-only and must NOT have the `NEXT_PUBLIC_` prefix.

### 4. Deploy

Push to the `main` branch to trigger a production deployment, or use the
Vercel dashboard to deploy manually.

---

## Environment Variable Notes

- Changes to environment variables require a **redeployment** to take effect.
- `NEXT_PUBLIC_SHOW_DEV_TOOLS=false` hides the Dev navigation links (System
  readiness, Demo checklist) in production.
- Never set `WORKER_DOCUMENT_*` variables on Vercel — those belong on Railway.
- Never set `AI_PROVIDER` or `ANTHROPIC_API_KEY` on Vercel unless live AI
  review is explicitly enabled.

---

## Supabase Checklist

Before the first production deployment, verify in Supabase:

### Migrations (all must be applied)

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

### Required RPC functions (created by migrations)

- `claim_processing_job`
- `replace_document_extraction_transactionally`
- `recover_abandoned_processing_jobs`
- `persist_condition_evaluation_and_refresh_parent`
- `begin_controlled_review`
- `complete_controlled_review_to_human_review`
- `fail_controlled_review`
- `upsert_review_finding`

### Storage buckets

| Bucket | Visibility | Purpose |
|---|---|---|
| `documents` | **Private** | Uploaded specification and submission files |
| `exports` | **Private** | Generated annotated PDFs |

Both buckets must be **private** (not public). Access is via signed URLs only.

### Row-Level Security

RLS must be enabled on all tables. The initial migration enables RLS and creates
org-scoped policies. Verify in Supabase → Table Editor → RLS column shows
"Enabled" for all tables.

### Authentication

- Email/password auth must be enabled in Supabase Auth settings.
- The site URL and redirect URLs must include the Vercel deployment URL.
- Configure in Supabase → Auth → URL Configuration.

---

## Vercel Deployment Checklist

- [ ] Vercel project created from GitHub repo
- [ ] `NEXT_PUBLIC_SUPABASE_URL` set
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` set
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set
- [ ] `NEXT_PUBLIC_SHOW_DEV_TOOLS` set to `false`
- [ ] All Supabase migrations applied
- [ ] `documents` and `exports` storage buckets are private
- [ ] Supabase Auth site URL configured
- [ ] Railway worker service is running (see `context/deployment-railway-worker.md`)
- [ ] `pnpm deploy:check` passes locally with production env vars
