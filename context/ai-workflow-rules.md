# AI Workflow Rules

## Approach

Build CompliAgent incrementally using a spec-driven workflow.

Context files define what to build, how to build it, and current progress. Always implement against them. Do not invent behavior from scratch.

## Source of Truth

1. `AGENTS.md`
2. `context/project-overview.md`
3. `context/architecture.md`
4. `context/code-standards.md`
5. `context/ui-context.md`
6. `context/progress-tracker.md`
7. Current explicit user instruction

When requirements change, update the relevant context file.

## Scoping Rules

- Work on one feature unit at a time.
- Prefer small, verifiable increments.
- Do not combine unrelated boundaries.
- Preserve working auth, project CRUD, Supabase, and upload flows.
- Separate architecture work from implementation.
- Separate extraction, AI review, annotation, and export work.
- Separate condition-model foundations from live AI pipeline implementation.
- Review migrations before applying.

## Split Work When It Combines

- UI and background jobs
- unrelated API routes
- schema changes and full feature implementation
- extraction and compliance reasoning
- annotation rendering and reviewer UI
- multiple providers
- unclear behavior
- work that cannot be verified quickly

## Unit Workflow

1. Read relevant context.
2. Inspect existing code.
3. Identify affected boundaries.
4. Identify migration/security impact.
5. Implement the smallest complete unit.
6. Add or update tests.
7. Run checks.
8. Update `progress-tracker.md`.
9. Report changes, limitations, and next unit.

## Missing Requirements

- Do not invent behavior.
- Add open questions to `progress-tracker.md`.
- Stop before implementation if the missing decision affects architecture, security, schema, or client-visible behavior.

## AI Safety Rules

- AI output is a draft.
- Human approval is mandatory.
- Never invent clauses, pages, standards, certifications, values, or citations.
- Missing evidence becomes `NOT_PROVEN`, `AMBIGUOUS`, or `NOT_VERIFIED`.
- Contradiction becomes `NOT_COMPLIED`.
- Direct proof may become `COMPLIED`.
- Exceeding one value does not prove total compliance.
- Every finding needs traceability.
- Every condition evaluation needs condition-level traceability.
- Evidence for one condition never proves another condition.
- Parent finding status is deterministic when child evaluations exist; AI may explain but cannot override derivation.
- Every annotation links to a finding and evidence region.
- Validate all AI output with Zod.
- Never send source content to a provider without organization-level enablement and recorded consent.
- Keep provider credentials server-side and outside run metadata.
- Use specialized task prompts and structured contracts; never collapse the review into one large prompt.
- Run independent verification after comparison and before deterministic parent derivation.
- Reject inexact quotes, unsupported citations, incompatible measurement conditions, ignored conditions, and unjustified applicability.
- Record provider, model, prompt version, run ID, input hash, usage, latency, validation, verification, and safe errors.
- Audit AI review start, completion, failure, and reviewer override when live execution is introduced.
- Enforce authenticated organization and project scope before reading organization AI settings.
- Require admin or super-admin authorization for AI settings changes and audit each change.
- Run consent/provider/task/transmission guards before creating an AI run.
- Mock execution may use logical provider routing but must identify itself as mock and must never use an external transport.
- Store only hashes, IDs, timing, usage, validation, verification, and normalized safe errors in the AI run ledger.
- Keep development mock endpoints strict, predefined, and disabled in production by default.

## Protected Files

Do not modify unless required:
- generated `src/components/ui/*`
- third-party code
- applied migration files
- original uploaded documents
- `.env` and `.env.local`
- generated build artifacts
- lockfiles unless dependencies change

Create new migrations; never rewrite applied migrations.

## Database Change Rules

Before migration:
1. Inspect current schema.
2. Describe entities and relationships.
3. Confirm backward compatibility.
4. Add indexes and RLS.
5. Note rollback considerations.
6. Update architecture docs.
7. Report migration before remote application.

## Document Processing Rules

- Native extraction first.
- OCR only when needed.
- Preserve pages, sections, clauses, and coordinates.
- Store extraction method and confidence.
- Keep originals unchanged.
- Never discard source metadata.

## Condition Persistence Rules

- Condition persistence services must depend on the `CompliancePersistenceGateway` interface, not on a concrete Supabase client.
- All service-layer mutations must return `ServiceResult<T>` — never throw directly to callers.
- Human override protection is mandatory at both TypeScript service layer and database RPC layer; never bypass either.
- Audit records must not contain evidence text, source text, or reasoning strings; only IDs, counts, statuses, and rule names.
- Parent finding status is always derived by `deriveParentFindingStatus` in TypeScript before the RPC is called; the RPC preserves the pre-computed status and applies the human override via `COALESCE`.
- Supersession (`is_active=false`) preserves history; do not delete rows that represent the audit trail.
- New in-memory gateway implementations for tests must implement every method in `CompliancePersistenceGateway`.

## Durable Processing Worker Rules

- Document processing workers must depend on the `ProcessingJobGateway` interface (`src/server/services/processing/gateway.ts`), not on a concrete Supabase client.
- Job claiming must use the `claim_processing_job` RPC (FOR UPDATE SKIP LOCKED); never implement claiming as a client-side SELECT + UPDATE.
- Page and chunk replacement must use the `replace_document_extraction_transactionally` RPC; never implement this as sequential JS DELETE then INSERT.
- The process route must enqueue and return immediately; no synchronous extraction runs inside an HTTP request handler.
- Workers must update heartbeat at a cadence shorter than the abandoned-job threshold; the threshold is 5 minutes and the heartbeat interval is 30 seconds.
- Audit records from the worker must not include raw page text or chunk text; only IDs, counts, version strings, and status codes.
- Dev endpoints that trigger worker execution must: check `NODE_ENV`, require authentication, check role, be disabled in production unless `ENABLE_PRODUCTION_DEV_WORKER=true`.
- New in-memory gateway implementations for tests must implement every method in `ProcessingJobGateway`; test extractors must not parse real files.
- Extraction version format is `{extractor-name}:{extractor-version}:{job-id}`; stored on the job row for traceability.

## Annotation Rules

Annotation is an optional export enhancement. It is preserved in the codebase but is not a primary project stage.

- Do not delete annotation tables, APIs, placement logic, or renderer code.
- Do not show annotation as a required step in the normal client workflow.
- Do not use annotation readiness as the primary success criterion for a review.
- Evidence-region data is important for compliance traceability even when annotated PDFs are not generated.
- Stabilize evidence-region storage before rendering.
- Every annotation references a finding.
- Condition annotations reference the matched condition, its evaluation, and the exact evidence region.
- Condition annotation content states what is proven, what remains missing, and the contractor action.
- Findings may reference multiple regions.
- Draft annotations require review.
- Reviewer edits are revision-tracked.
- Final output uses approved annotation state.
- Originals remain unchanged.

## Verification

Run before moving on:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Before Next Unit

1. Current unit works end to end.
2. No invariant is violated.
3. Security checks are present.
4. Tests cover critical logic.
5. Progress tracker is updated.
6. Build passes.
7. Limitations are documented.
8. Next unit is defined.
