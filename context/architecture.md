# Architecture Context

## Stack

| Layer | Technology | Role |
| --- | --- | --- |
| Framework | Next.js App Router + TypeScript | Web app, routes, server rendering |
| UI | Tailwind CSS + shadcn/ui + Lucide | Engineering-focused interface |
| Auth | Supabase Auth | Authentication and sessions |
| Database | Supabase PostgreSQL | Metadata, findings, approvals, audit history |
| Vector Search | pgvector | Semantic retrieval |
| Storage | Supabase Storage | Original files, page images, exports |
| Validation | Zod | Input and AI output validation |
| AI | Provider-agnostic adapter | OpenAI, Anthropic, Gemini, Mistral, OpenRouter |
| OCR | Pluggable adapter | Native extraction first, OCR when needed |
| Jobs | Background job abstraction | Extraction, OCR, AI review, exports |
| Deployment | Vercel + Supabase + worker if needed | Production hosting |

## System Boundaries

- `src/app/` — routes, pages, layouts, API endpoints
- `src/components/` — reusable UI
- `src/lib/documents/` — extraction, normalization, chunking, source mapping
- `src/lib/ocr/` — OCR adapters and OCR decision logic
- `src/lib/ai/` — provider abstraction and structured output handling
- `src/lib/agents/` — deterministic agent workflow
- `src/lib/compliance/` — status, scoring, numeric comparison
- `src/lib/annotations/` — evidence regions and annotation logic
- `src/lib/exports/` — Excel, Word, PDF, annotated PDF
- `src/lib/security/` — authorization and sanitization
- `src/lib/supabase/` — browser, server, admin clients
- `src/server/jobs/` — background jobs
- `src/server/services/` — server-only business services
- `supabase/migrations/` — schema, indexes, RLS, storage policies
- `context/` — project context and progress

## Storage Model

- **PostgreSQL**: organizations, profiles, projects, documents, pages, chunks, requirements, requirement conditions, evidence, condition evaluations, evidence links, reviews, findings, clarifications, annotations, approvals, organization AI settings, AI runs, jobs, exports, audit logs.
- **Supabase Storage**: originals, page renders, extracted assets, reports, annotated files.
- **pgvector**: embeddings on source-preserving chunks.

## Core Entities

Existing:
- organizations
- profiles
- projects
- documents
- document_pages
- document_chunks
- extracted_requirements
- extracted_evidence
- compliance_reviews
- compliance_findings
- contractor_clarifications
- processing_jobs
- report_exports
- audit_logs

Condition-level review additions:
- `requirement_conditions`
- `condition_evaluations`
- `condition_evidence_regions`

Annotation additions:
- `evidence_regions`
- `finding_evidence_regions`
- `document_annotations`
- `annotation_revisions`
- `annotation_approvals`

Controlled AI additions:
- `organization_ai_settings` stores explicit enablement, consent audit, enabled providers, and model routing without provider credentials.
- `ai_runs` stores task, provider, model, prompt version, input hash, provider run ID, lifecycle, latency, token usage, estimated cost, validation, verification, and safe failure metadata.

Relationships and ownership:
- One extracted requirement has ordered, independently checkable requirement conditions.
- Each condition evaluation belongs to one review, parent finding, requirement, condition, project, and organization.
- Condition evaluations link to zero or more exact evidence regions; a missing-expected-region marker records that no region exists without fabricating evidence.
- Parent finding status is derived by application code from effective child condition statuses. AI providers cannot independently assign it when condition rows exist.
- One finding may link to multiple evidence regions through `finding_evidence_regions`.
- Every annotation belongs to one organization, project, review, finding, document, and evidence region.
- Composite foreign keys enforce that linked projects, documents, findings, evidence regions, profiles, revisions, and approvals stay in the same organization/project scope.
- Annotation revisions are append-only history records.
- Each annotation has one current approval-state record; approved or rejected states require a reviewer and review timestamp.

## Evidence Region Model

Each evidence region should support:
- organization_id
- project_id
- document_id
- page/slide/sheet reference
- cell range where relevant
- region type
- x, y, width, height
- coordinate system
- extracted text
- extraction confidence
- source hash

Coordinates use one declared coordinate system: `normalized` (0–1 per page), `pdf_points`, `pixels`, `spreadsheet_cells`, or `slide_emu` (EMU units used by DrawingML). Normalized boxes must remain within the unit page boundary. Spreadsheet evidence may use a sheet and cell range without a visual box; rendered annotations always require an explicit box.

Evidence regions also carry `extraction_method`, `job_id`, and `extraction_version` for provenance tracing, and optional `normalized_x/y/width/height` parallel coordinates for cross-format spatial queries.

`document_pages` rows store `source_hash`, `source_label`, `normalized_text`, `ocr_required`, `page_width`, `page_height`, `page_rotation`, and `coordinate_system` alongside the existing text and extraction method.

## Annotation Model

- Annotation types: highlight, callout, connector, evidence marker.
- Annotation lifecycle states: draft, pending review, approved, rejected, deleted.
- Approval states: pending, approved, rejected.
- Annotation content snapshots source/standard reference, clause/sub-clause, compliance status, reasoning, missing information, and contractor action so rendered output remains auditable.
- Condition-level annotations additionally reference the source requirement document, requirement condition, condition evaluation, exact evidence text, concise result, and parent finding status.
- Annotation types include highlight, callout, connector, evidence marker, outline, and cloud so future renderers can choose a non-overlapping visual treatment.
- The initial `ambiguous_not_proven` compliance enum value remains readable for backward compatibility. New findings can distinguish `ambiguous` and `not_proven`; `exceeds_requirement` is also supported.
- Rendering is behind an adapter and must create a new private artifact. It must never overwrite the uploaded source document.

## Auth and Access

- Every profile belongs to an organization.
- Every project and child entity inherits organization ownership.
- RLS enforces organization isolation.
- Server-side authorization is mandatory.
- Service-role access is server-only.
- Viewers cannot mutate.
- Engineers/reviewers can review.
- Admins manage organization resources.
- Super admins have full access.

## Processing Pipeline

1. Validate file
2. Native extraction
3. OCR decision
4. OCR/layout extraction
5. Page rendering
6. Clause detection
7. Source-preserving chunking
8. Embeddings
9. Requirement extraction
10. Requirement-condition decomposition
11. Evidence extraction and standards applicability
12. Condition-level evidence-region retrieval
13. Deterministic checks and condition-level comparison
14. Independent finding verification
15. Deterministic parent finding derivation
16. Evidence-region mapping
17. Draft annotation generation
18. Human review and approval
19. Report generation
20. Export and audit logging

## Controlled AI Architecture

- Explicit task types cover classification, understanding, requirement extraction/decomposition, retrieval, condition comparison, standards applicability, verification, annotation comments, report summaries, and project chat.
- Organization configuration and consent are required before routing any task to an external provider. API keys remain server-only and are not stored in AI settings or run rows.
- Task routing selects a configured lightweight, multimodal, reasoning, or verifier model; model names are organization configuration, not business-logic constants.
- Provider adapters accept text or multimodal inputs and structured output schemas, and return normalized usage and validation metadata.
- Full confidential document text is not stored in the AI run ledger. The ledger stores a SHA-256 input hash and operational metadata.
- Retrieval, comparison, and verification use separate Zod-validated contracts. Verification cannot pass with an invalid citation, inexact quote, incomplete condition coverage, incompatible units, unjustified applicability, or unsupported claim.
- Deterministic comparison code handles directly comparable numeric ranges and evidence-presence checks. Different units or measurement conditions remain ambiguous unless an explicit safe conversion/comparison basis exists.
- AI events use audit actions for review start, completion, failure, and reviewer override. Live event emission is deferred until the background run service is implemented.
- No live provider adapter or production AI review pipeline is enabled by this foundation.

### Server-Only Mock Execution Foundation

- Organization AI settings are read and mutated only through server services. Missing or invalid settings are treated as disabled.
- Settings mutations require an admin or super-admin in the same organization and create an audit event. RLS remains the database backstop.
- Allowed task types, transmission permissions, retention preference, and strict model routes are stored in the existing `model_routes` JSON object; arbitrary route keys and credential fields are rejected.
- The reusable consent guard checks authentication, organization/project scope, enablement, recorded consent, provider/task allowlists, external transmission permission, and multimodal permission before a run is created.
- AI runs move from queued to running and then completed or failed, with hashes, identifiers, provider/model/prompt metadata, timing, usage, validation, verification, and normalized safe errors. Provider input and full document text are never written to `ai_runs`.
- Four deterministic mock capability tiers implement the provider-neutral transport contract: lightweight, multimodal, reasoning, and verifier. They support success, invalid output, one repair, timeout, and provider failure without network access.
- The development mock endpoint accepts only a strict predefined payload and is disabled in production unless `ENABLE_PRODUCTION_MOCK_AI_TEST_ENDPOINT=true` is explicitly set.
- Mock execution proves infrastructure only. It does not perform document understanding, retrieval, comparison, verification, or compliance review.

## Condition-Level Compliance Model

- Clauses are parent requirements; each independently checkable statement or numeric constraint is a child condition.
- Conditions preserve subject, attribute, operator, expected text/value/range/unit, mandatory state, exact source text, and extraction confidence.
- Each condition evaluation stores its status, reasoning, evidence summary, missing information, contradiction or verification-failure reason, contractor action, confidence, weightage, and human override audit.
- `COMPLIED` and `EXCEEDS_REQUIREMENT` require direct linked evidence. `AMBIGUOUS` requires relevant but unclear evidence. `NOT_PROVEN` records missing information without inventing a region.
- Parent derivation uses mandatory conditions. `NOT_VERIFIED` source failures take precedence, followed by direct contradictions. Mixed proven and unresolved conditions produce `PARTIALLY_COMPLIED`.
- A parent result is `EXCEEDS_REQUIREMENT` only when every applicable mandatory condition exceeds its requirement; a mix of complied and exceeded conditions derives `COMPLIED`.

## Controlled Technical Review Pipeline

The orchestrator at `src/server/services/reviews/review-orchestrator.ts` coordinates:

1. **Document role confirmation** — classifies documents as specification-role or submission-role using `specificationRoles` / `submissionRoles` from `domain.ts`; only processed (`completed`) documents are used.
2. **Requirement discovery** — uses `RequirementDiscoveryService`: maps pre-extracted `extracted_requirements` rows for specification documents; scans chunks for mandatory language when no rows exist (provisional, not yet persisted).
3. **Condition retrieval** — loads active `requirement_conditions` for each requirement via `CompliancePersistenceGateway`.
4. **Evidence retrieval** — `EvidenceRetrievalService` performs hybrid exact-phrase + keyword + numeric scoring across submission-role chunks; capped at 5 results per condition; classifies sufficiency as direct/partial/contextual/irrelevant.
5. **Condition comparison** — `ConditionComparisonService` uses `compareNumericRange` for numeric types and `compareRequiredEvidencePresence` for boolean/feature/standard/certificate types; placeholder result for text/conditional types requiring live AI.
6. **Independent verification** — `FindingVerifierService` checks citation validity, quote exactness, unit compatibility, condition completeness, and applicability; separate from comparison (invariant 18).
7. **Parent-finding derivation** — `deriveParentFindingStatus` computes deterministic status from all condition evaluations.
8. **Atomic persistence** — one evaluation at a time via existing `persist_condition_evaluation_and_refresh_parent` RPC; `ParentFindingService` handles human-override protection.
9. **Human-review handoff** — `complete_controlled_review_to_human_review` RPC transitions review to `awaiting_human_review`; never auto-approves.
10. **Audit** — every lifecycle event emits a `ReviewAuditRecord`; metadata never contains full evidence or reasoning text.

**Review lifecycle states** (additive, new values in `review_status` enum): `draft → ready → running → awaiting_human_review → approved`; `cancelled` and `superseded` for aborted or replaced reviews.

**Idempotency**: a review with matching `source_hash + extraction_version + prompt_version + review_version` already at `awaiting_human_review` is returned immediately without re-running.

**Gateway split**:
- `ReviewPersistenceGateway` (`src/server/services/reviews/gateway.ts`) — review lifecycle, finding upsert, document listing, requirement/chunk/region loading.
- `CompliancePersistenceGateway` (`src/server/services/compliance/gateway.ts`) — condition retrieval and per-condition evaluation persistence.

**Test implementations**: `MemoryReviewGateway` (in-memory with seed helpers), `MemoryComplianceGateway` (shared, exported from `src/server/services/compliance/memory-compliance-gateway.ts`).

## Condition Persistence Service Model

All condition-level writes go through the `CompliancePersistenceGateway` interface (`src/server/services/compliance/gateway.ts`):

- `RequirementConditionsService` — create, replace AI-generated (human-confirmed protected), list, get, mark superseded.
- `ConditionEvaluationsService` — create draft, update AI draft (human-reviewed protected), apply human review, list, get with condition, mark superseded.
- `ConditionEvidenceService` — link evidence region (supports / contradicts / partially_supports / contextual / missing_expected_region), remove unapproved draft link, list for evaluation, list evaluations by region.
- `ParentFindingService` — compute parent status (deterministic derivation only), persist evaluation and atomically refresh parent (calls PostgreSQL RPC).

Gateway implementations:
- `SupabaseComplianceGateway` — production; uses Supabase admin client; calls `persist_condition_evaluation_and_refresh_parent` via `.rpc()`.
- `MemoryComplianceGateway` — test-only in-memory implementation; no database dependency.

Revision model:
- Old records keep their rows with `is_active=false`, `superseded_at`, and `superseded_reason` for audit history.
- Uniqueness for active rows enforced by partial unique indexes `WHERE is_active = true`.

Human override protection:
- TypeScript services check `human_status` before allowing any supersession or AI update.
- The PostgreSQL RPC raises `HUMAN_APPROVAL_PROTECTED` if the existing active evaluation has `human_status IS NOT NULL`.

Transactional parent refresh:
- `persist_condition_evaluation_and_refresh_parent` PL/pgSQL function (SECURITY INVOKER) atomically: supersedes existing active evaluation, inserts new one, inserts evidence links, updates `compliance_findings.deterministic_derived_status` and `status`.
- TypeScript pre-computes the deterministic parent status from active evaluations and passes it to the RPC; the RPC uses `COALESCE(human_override_status, p_deterministic_parent_status)` for the final status.

Audit events:
- Every mutation writes one or more `ComplianceAuditRecord` entries.
- Metadata must not include full evidence text, source text, or reasoning strings — only IDs, counts, statuses, and rule names.

Error handling:
- All service methods return `ServiceResult<T>` (discriminated union).
- `ok(data)` wraps success; `fail(errorCode, message, retryable?)` wraps failure.
- Error codes: `REQUIREMENT_NOT_FOUND`, `CONDITION_NOT_FOUND`, `EVALUATION_NOT_FOUND`, `FINDING_NOT_FOUND`, `EVIDENCE_REGION_NOT_FOUND`, `ORGANIZATION_ACCESS_DENIED`, `PROJECT_ACCESS_DENIED`, `REVIEW_ACCESS_DENIED`, `CROSS_PROJECT_LINK_DENIED`, `CROSS_ORGANIZATION_LINK_DENIED`, `HUMAN_APPROVAL_PROTECTED`, `DUPLICATE_CONDITION`, `DUPLICATE_EVIDENCE_LINK`, `INVALID_CONDITION`, `INVALID_EVALUATION`, `TRANSACTION_FAILED`.

## Native Document Processing Foundation

- PDF extraction preserves each physical PDF page, including pages where selectable text is absent.
- DOCX extraction preserves logical pages only when the source contains explicit or rendered page-break markers. A reported page count without reliable break markers is stored without inventing page-to-text mappings.
- XLSX extraction treats each worksheet as a source page and prefixes extracted values with cell addresses.
- PPTX extraction reads `ppt/presentation.xml` to count slides, then reads each `ppt/slides/slideN.xml` and extracts paragraph text from DrawingML `<a:p>/<a:t>` elements (including table cells). Each slide maps to a sequential page number.
- Native extraction records the document ID, source page or worksheet, raw text, normalized text, extraction method, heuristic confidence, section heading, clause number, and source document SHA-256 hash across `document_pages`, `document_chunks`, and `ProcessingResult`.
- `sourceHash` is the SHA-256 hex digest of the original file buffer, computed before extraction and attached to every `ExtractedDocumentText`, `ProcessingResult`, and `ExtractionOutput` result for lineage tracking.
- Low-content or malformed native text is marked as requiring OCR. This foundation records the OCR requirement but does not execute OCR.
- Chunks never cross page boundaries. New section headings and clause numbers start new source units, and oversized units split at readable source boundaries.
- Document extraction jobs move through queued, claimed, running, retry_wait, completed, or failed states with progress, safe error codes, warnings, OCR-required pages, and retry metadata.
- The original private storage object is read-only during processing and is never replaced or modified.

## Durable Document Processing Worker

- `DocumentExtractor` interface (`src/server/services/processing/document-extractor.ts`) decouples file parsing from the job runner; the `NativeDocumentExtractor` wraps the existing extraction pipeline.
- `ProcessingJobGateway` interface (`src/server/services/processing/gateway.ts`) decouples the worker from Supabase; `SupabaseProcessingGateway` uses the admin client; `MemoryProcessingGateway` is used for tests.
- `DocumentExtractionJobRunner.executeJob` is the single execution unit: validate claim, audit start, load document, check extractor support, download file, heartbeat, extract, handle OCR-required, persist atomically, audit completion.
- `DocumentProcessingWorker` (platform-agnostic): recovers abandoned jobs before each batch, sets a heartbeat interval per job, respects a batch-size limit, and stops cleanly.
- Pages and chunks are replaced atomically by `replace_document_extraction_transactionally` (PostgreSQL PL/pgSQL RPC): DELETE existing rows → INSERT new rows in a single transaction; if the INSERT fails, the DELETE rolls back and previous data is preserved.
- Job claiming uses `claim_processing_job` (RPC with `FOR UPDATE SKIP LOCKED`): two workers calling simultaneously cannot claim the same job.
- Extraction version format: `{extractor-name}:{version}:{job-id}`; stored on the job row for auditable lineage.
- Retry policy: bounded exponential backoff (1 min / 5 min / 15 min / 60 min); `DocumentExtractionError.retryable` distinguishes transient from permanent failures.
- Abandoned-job recovery: `recover_abandoned_processing_jobs` resets running jobs whose heartbeat is older than the threshold back to `retry_wait`.
- The process route (`POST /api/documents/[documentId]/process`) enqueues a job and returns immediately; the worker executes separately.
- Dev endpoint `POST /api/dev/processing/run-worker` triggers batch processing in development; disabled in production unless `ENABLE_PRODUCTION_DEV_WORKER=true`.

## Background Jobs

Job types:
- document_extraction
- ocr
- page_rendering
- table_extraction
- image_region_detection
- embedding_generation
- requirement_extraction
- requirement_decomposition
- evidence_extraction
- condition_evidence_retrieval
- condition_evaluation
- parent_finding_derivation
- standards_applicability
- compliance_review
- reviewer_check
- evidence_region_mapping
- annotation_generation
- annotation_comment_generation
- report_generation

States:
- queued
- claimed
- running
- retry_wait
- completed
- failed
- cancelled

## Primary Output

The primary client-facing output is a **clause-by-clause compliance assessment** stored in:
- `compliance_reviews` — review metadata and lifecycle
- `compliance_findings` — per-clause findings with status, reasoning, evidence, missing information, and contractor actions
- `condition_evaluations` — per-condition evaluations linked to exact evidence regions

The primary **export** is a structured compliance report (PDF/DOCX/XLSX). Implementation of report generation is deferred.

The annotated PDF is an **optional export enhancement** — not the primary deliverable and not required for first release.

## Annotation Reclassification

The annotation subsystem (`src/lib/annotations/`, `src/server/services/annotations/`) is preserved but reclassified:

- **Reclassified as**: optional export enhancement
- **Not**: a primary project stage
- **Not**: the primary final deliverable
- **Not**: shown in the normal client workflow
- **Not** required for first client release

The annotation tables (`evidence_regions`, `finding_evidence_regions`, `document_annotations`, `annotation_revisions`, `annotation_approvals`) remain in the database for traceability. Evidence-region data is important for compliance traceability regardless of whether annotated PDFs are generated.

Annotation API routes (`/api/reviews/[reviewId]/annotations`, `/api/reviews/[reviewId]/ready-for-annotation`) are preserved and functional. They are accessible to reviewers who choose to use them but are not linked from the primary client workflow.

## Invariants

1. Original documents are never overwritten.
2. Every finding preserves requirement and evidence traceability.
3. Pages, clauses, quotes, and coordinates must come from stored extraction data.
4. Missing evidence never becomes assumed compliance.
5. Every AI output is schema-validated.
6. Final approval is human-controlled.
7. RLS and server-side authorization are both enforced.
8. Long processing never runs synchronously in request handlers.
9. Confidential files remain private.
10. Service-role keys never reach the browser.
11. Provider logic stays behind adapters.
12. Every annotation links to a finding and evidence region.
13. Applied migrations are never rewritten.
14. Working auth, project CRUD, and upload flows must not be broken.
15. Evidence for one condition never proves a sibling condition.
16. Parent clause status must be derived from child conditions when child evaluations exist.
17. External AI calls require organization enablement and recorded consent.
18. Comparison and independent verification are separate runs.
19. AI run logs store hashes and necessary excerpts only, never full confidential documents by default.
20. Unverified AI output cannot enter final human-approved review output.
21. Condition persistence services must use the `CompliancePersistenceGateway` interface; services must never call Supabase directly.
22. Multi-table condition writes must be atomic; use the PostgreSQL RPC, not sequential JS awaits.
23. Audit metadata must not contain full confidential evidence text or source text.
24. Document processing workers must use the `ProcessingJobGateway` interface; workers must never call Supabase directly.
25. Pages and chunks must be replaced atomically via the `replace_document_extraction_transactionally` RPC; never DELETE some rows then INSERT new rows outside of a transaction.
26. Job claiming must use the `claim_processing_job` RPC (FOR UPDATE SKIP LOCKED); no application-level SELECT + UPDATE pattern is acceptable for job claiming.
27. Document processing status displayed to users must be resolved from the latest `processing_jobs` row (ordered by `created_at DESC, updated_at DESC, id DESC`), not from `documents.processing_status` alone. The `documents.processing_status` column is only a fallback when no job exists.
28. Only one active processing job (status IN queued/claimed/running/retry_wait) may exist per (document_id, job_type). Enforced by the partial unique index `processing_jobs_no_dup_active_idx` (migration 20260701000000).
29. Development navigation items (System readiness, Demo checklist) are shown only when `NODE_ENV !== "production"` AND `NEXT_PUBLIC_SHOW_DEV_TOOLS === "true"`. Never shown in production or client mode without the explicit flag.
