# Progress Tracker

Update after every meaningful implementation change.

## Current Phase

**Phase 1 — Foundation and core setup**

Status: **In progress**

## Current Goal

Unit 16 complete. Next: live browser verification — manually navigate the deployed app to confirm the full upload → process → review → approve → annotate → download flow works end-to-end. All pending migrations must be applied before this can be done.

## Delivery Boundary Status

- AI architecture foundation: complete and applied
- Controlled AI persistence and consent enforcement: complete with mock providers only
- Native document extraction: complete — PDF, DOCX, XLSX, and PPTX all supported with sourceHash, clause detection, heading detection, quality scoring, and golden test fixtures
- OCR: detection only; provider abstraction and execution pending
- Live AI review pipeline: pending
- Independent verification: schemas, prompt, and trust rules complete; live verifier execution pending
- Annotation: data architecture complete; final rendering pending
- Human review: existing review state foundation only; full reviewer workflow pending
- Exports: pending

## Completed

### Foundation
- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn-compatible UI foundation
- Reusable project structure
- Architecture and methodology docs

### Supabase
- Initial migration created and applied manually
- Core tables created
- RLS policies created
- Private storage buckets created
- Seed organization added
- Live server-side connection verified
- organizations count verified as 1

### Authentication
- Auth middleware
- Session refresh
- Dashboard protection
- Signup, login, logout
- Auth callback
- Automatic profile creation
- Default organization bootstrap
- First profile becomes admin
- Later profiles become engineer

### Projects
- Dashboard shell
- Project list
- Project creation
- Project detail
- Project CRUD API foundation
- Supabase-connected access

### Documents
- Upload form
- Role assignment
- Metadata route
- Organization access check
- Native PDF extraction with physical page preservation
- Native DOCX extraction with explicit page-break preservation and conservative pagination warnings
- Native XLSX extraction with worksheet and cell-address traceability
- Page-level extraction method, confidence, source label, and OCR-required detection
- Section heading and clause-number detection
- Page-bounded, source-preserving chunking with document/page/source metadata
- Processing job queued, running, progress, completed, failed, stale-job, and retry states
- Clear safe extraction errors for unsupported, invalid, encrypted, transient, and OCR-required outcomes

### AI/Compliance Foundation
- Agent interfaces
- Zod schemas
- Prompt templates
- AI JSON validation
- Compliance statuses
- Weightage and confidence logic
- Tests

### Controlled AI Architecture Foundation
- Explicit AI task types added for document classification/understanding, requirements, retrieval, comparison, applicability, verification, annotations, summaries, and chat
- Provider-agnostic text/multimodal structured-output interface added with timeouts, retry limits, usage metadata, and normalized errors
- Organization-consent-aware provider selection and task-to-capability model routing added
- Zod schemas added for AI run metadata, retrieval results, comparison results, and independent verification results
- Deterministic numeric-range and required certificate/standard/feature presence comparisons added
- Independent verification rejects unsupported citations and cannot pass failed source/unit/completeness/applicability checks
- One-repair structured JSON validation flow added
- Controlled prompt contracts added/updated for document understanding, decomposition, retrieval, comparison, standards applicability, finding verification, and annotation comments
- Audit action names defined for AI review start, completion, failure, and reviewer override; live emission remains pending
- New additive migration created: `20260620235900_controlled_ai_architecture_foundation.sql`
- Organization AI settings require explicit consent and contain no provider credentials
- AI run ledger preserves provider/model/prompt/run/usage/latency/validation/verification metadata without storing full source text
- Controlled AI migration intentionally not applied automatically
- No live provider SDK, live review orchestration, OCR execution, or annotation rendering added

### Server-Only AI Run Persistence and Consent Enforcement
- Organization AI settings service added with disabled-by-default behavior, organization-scoped reads, admin-only mutations, consent audit fields, provider/task allowlists, transmission permissions, retention preference, and strict credential-free model routes
- Reusable typed consent guard added for authentication, organization/project ownership, enablement, consent, provider, task, external transmission, and multimodal transmission checks
- AI run persistence service added for queued, running, completed, and failed lifecycle states with provider/model/task/prompt/hash/timing/usage/cost/validation/verification/error metadata
- Full provider inputs and confidential document text are excluded from `ai_runs`
- Deterministic lightweight, multimodal, reasoning, and verifier mock providers added with success, invalid JSON, one repair, timeout, and provider failure simulations
- Mock execution orchestrator added with guarded routing, run persistence, validation/repair, normalized errors, and safe audit events
- Development-only `/api/dev/ai/mock-run` endpoint added; it accepts only predefined payload fields and is production-disabled unless explicitly enabled
- Audit events added for settings updates, run requests, consent blocks, starts, completions, failures, validation failures, and mock repairs
- No external network request, provider SDK, provider credential, uploaded-file transmission, OCR, or live review execution added
- Existing applied schema supports the unit through validated `model_routes`; no new migration was required

### Condition-Level Compliance Foundation
- Requirement clauses decompose into ordered, independently checkable conditions
- Condition types and operators support text, feature, material, configuration, certificate, standard, exact-value, minimum, maximum, range, boolean, and conditional requirements
- Condition evaluations preserve status, exact evidence links, reasoning, missing information, contradiction and verification-failure reasons, contractor action, confidence, weightage, and human override audit
- Condition-to-evidence-region links support supporting, contradicting, partial, contextual, and missing-expected-region relationships
- Parent finding status derives deterministically from effective child condition statuses
- Driver-size/full-range/neodymium partial-compliance example covered by tests
- Annotation contracts now support source requirement documents, matched conditions, evaluations, exact evidence text, concise results, outlines, and clouds
- Placeholder prompt contracts added for decomposition, condition evidence retrieval, condition comparison, parent explanation, and annotation comments
- New additive migration created: `20260620233000_requirement_condition_evaluation_foundation.sql`
- Condition migration intentionally not applied automatically
- OCR, live AI condition review, persistence services, and final PDF rendering remain pending

### Visual Evidence and Annotation Architecture
- Additive migration created for evidence regions, finding-region links, document annotations, revision history, and approval state
- Composite foreign keys defined for organization/project/document/review/finding ownership consistency
- Organization-aware RLS and query indexes defined
- Compliance status enum additions defined for ambiguous, not proven, and exceeds requirement while preserving the legacy combined value
- Background job enum additions defined for page rendering, image-region detection, evidence-region mapping, and annotation generation
- TypeScript annotation models, Zod validation, ownership helpers, and provider/service boundaries added
- Annotation schema, coordinate, status, approval, revision, and organization ownership tests added
- Annotation architecture migration reviewed and applied successfully

### Document Processing Foundation
- Existing `pdf-parse`, `mammoth`, and `xlsx` libraries connected to source-preserving native extractors
- PDF pages with insufficient selectable text are retained and marked for OCR
- DOCX text is mapped only from trustworthy page-break markers; metadata-only page counts do not create fabricated page mappings
- Spreadsheet values preserve worksheet labels and exact cell addresses
- Raw and normalized chunk text preserve document, page, section, clause, method, confidence, and source labels
- Existing `documents`, `document_pages`, `document_chunks`, and `processing_jobs` tables used without a schema migration
- Original uploaded storage objects remain unchanged
- No OCR provider, AI compliance review, or annotation renderer added

### Verification (Unit 8)
- `pnpm lint` passed (warnings only)
- `pnpm typecheck` passed
- `pnpm test` passed: 161 tests across 15 files
- `pnpm build` passed

### Unit 9 — Native Document Intelligence and Golden-Test Foundation
Completed:
- `pptx_text` added to `extractionMethods` in `chunking.ts`; `ExtractionMethod` union now covers PDF, DOCX, XLSX, PPTX, OCR, and manual.
- PPTX extraction added to `extraction.ts`: reads `ppt/presentation.xml` to count `<p:sldId>` elements, reads `ppt/slides/slideN.xml` per slide, extracts paragraph text from DrawingML `<a:p>/<a:t>` elements (including table cells) using the existing ZIP reader.
- `sourceHash: string` (SHA-256 hex of the source buffer) added to `ExtractedDocumentText`, `ProcessingResult`, and `ExtractionOutput`; computed once in `extractDocumentText` and spread onto the result.
- `supportsDirectTextExtraction` updated to include PPTX MIME type.
- Error messages in `document-extractor.ts` and `job-runner.ts` updated to say "PDF, DOCX, XLSX, and PPTX".
- `ExtractionOutput.sourceHash` added to the `NativeDocumentExtractor` return value.
- New `src/tests/extraction-golden.test.ts` (24 tests) covering: PPTX extraction (5), source hash (5), golden specification fixture in DOCX (6), golden submission fixture in DOCX (4), golden PPTX specification (3). Uses synthetic in-memory buffers; no real documents committed.
- Golden fixtures represent the client's line-array speaker example: specification clause "2.2.1 Driver Units — Drivers must be high-quality full-range units from 3.5 inches to 4 inches with neodymium magnets" vs. submission evidence "8 x 3.5-inch HQ drivers". Tests verify that the extraction layer preserves clause numbers, section headings, and exact evidence text for later comparison stages.
- `document-processing-worker.test.ts` updated: `makeExtractionOutput` now includes `sourceHash`.
- No live AI provider, no OCR execution, no exports enabled.
- No new migration required.

### Verification (Unit 9)
- `pnpm lint` passed (warnings only, all pre-existing)
- `pnpm typecheck` passed (clean, no errors)
- `pnpm test` passed: 185 tests across 16 files
- `pnpm build` passed

### Unit 10 — Coordinate-Aware Extraction, Quality Assessment and OCR Foundation
Completed:
- `src/lib/documents/coordinates.ts` — `BoundingBox`, `CoordinateSystem`, `ConversionContext`; `validateBoundingBox`, `validateNormalizedBox`, `clampToPageBoundary`, `normalizeBox` (with 0/90/180/270 rotation), `overlappingArea`, `containsPoint`.
- `src/lib/documents/layout-types.ts` — `ExtractedTextBlock`, `ExtractedTableCell`, `ExtractedTableRow`, `ExtractedTable`, `ExtractedVisualRegion`, `ExtractedPage`, `PageQualityResult`, `ExtractionQualityResult`, `QualityClassification`.
- `src/lib/ocr/provider.ts` — `OcrBoundingBox`, `OcrWord`, `OcrLine`, `OcrInput`, `OcrResult`, `OcrProviderError`, `OcrProvider` interface; server-only; no external calls.
- `src/lib/ocr/mock-provider.ts` — `MockOcrProvider` with 7 deterministic scenarios: success, low_confidence, empty_result, malformed_coordinates, timeout, provider_failure, mixed_confidence.
- `src/lib/ocr/decision.ts` — `makeOcrDecision` with 6 typed outcomes: USE_NATIVE, OCR_PAGE, OCR_DOCUMENT, OCR_NOT_ALLOWED, OCR_PROVIDER_UNAVAILABLE, MANUAL_REVIEW_REQUIRED; checks org settings, provider availability, external transmission consent, and page-image availability.
- `src/lib/ocr/renderer.ts` — `DocumentPageRenderer` boundary interface for future PDF/PPTX rasterization.
- `src/lib/documents/chunking.ts` extended: `TextBlockType`, `ExtractedTextBlockInfo` (with id, boundingBox, normalizedBoundingBox, coordinateSystem, confidence), optional `textBlocks/pageWidth/pageHeight/pageRotation/coordinateSystem` on `ExtractedTextPage`, `blockIds` on `DocumentChunk` (traces blocks to evidence regions).
- `src/lib/documents/text-quality.ts` extended: `assessPageQuality` (per-page score, classification, requiresOcr, reasons) and `assessExtractionQuality` (document-level aggregation) added backward-compatibly.
- `src/lib/documents/extraction.ts` fully rewritten:
  - PPTX: relationship-based slide ordering via `ppt/_rels/presentation.xml.rels` + `<p:sldId r:id>` ordering in `ppt/presentation.xml`; slide dimensions from `<p:sldSz cx cy/>`; per-shape EMU coordinates from `<a:xfrm><a:off x y/><a:ext cx cy/>`; shapes normalized to [0,1] via `normalizeBox(slide_emu)`; title placeholder detection; `ExtractedTextBlockInfo[]` per slide.
  - DOCX: `extractDocxStructureBlocks` returns `ExtractedTextBlockInfo[]` with heading level, list_item, table_cell block types; `extractDocxTables` returns `ExtractedTable[]` with row/col/colSpan metadata.
  - XLSX: `worksheet['!merges']` decoded to human-readable range strings; `buildXlsxTextBlocks` returns `ExtractedTextBlockInfo[]` with sheet_cells coordinate system.
  - `createExtractedPage` extended with optional `textBlocks`, `pageWidth`, `pageHeight`, `coordinateSystem`.
- `src/lib/annotations/schemas.ts`: `coordinateSystems` updated to include `"slide_emu"`.
- `src/types/database.ts`: `document_pages` Row/Insert types added; `evidence_regions` Row/Insert extended with `normalized_x/y/width/height`, `extraction_method`, `job_id`, `extraction_version`.
- `src/server/services/processing/types.ts`: `SerializedPage` extended with optional `normalizedText`, `sourceLabel`, `sourceHash`, `pageWidth`, `pageHeight`, `pageRotation`, `coordinateSystem`.
- `src/server/services/processing/document-extractor.ts`: new fields passed through from extraction result.
- `supabase/migrations/20260627000000_coordinate_aware_extraction_and_ocr_foundation.sql`: adds `slide_emu` to `document_coordinate_system` enum; extends `document_pages` with org_id, normalized_text, source_hash, source_label, ocr_required, page_width/height/rotation, coordinate_system; extends `evidence_regions` with normalized coords and provenance; updates `replace_document_extraction_transactionally` RPC.
- `src/tests/coordinate-extraction.test.ts`: 53 tests (exceeds target of 35) covering BoundingBox validation, rotation-aware normalization, overlap/containment, page-level quality, document-level quality, all 6 OCR decision branches, 5 mock provider scenarios, PPTX relationship ordering, PPTX EMU coordinate extraction, DOCX structural metadata, XLSX merged ranges, blockId propagation.
- No paid OCR provider, no live LLM, no external transmission enabled.

### Verification (Unit 10)
- `pnpm lint` passed (warnings only, all pre-existing)
- `pnpm typecheck` passed (clean)
- `pnpm test` passed: 238 tests across 17 files
- `pnpm build` passed

### Unit 11 — Controlled Technical Review Pipeline
Completed:

**Pre-implementation assessment**: All 18 items inspected and reported — existing review table gaps identified, document role gaps identified, no transaction RPC existed for review lifecycle, organization_id missing from compliance_reviews and compliance_findings.

**Migration** (`20260628000000_controlled_review_pipeline.sql`):
- `document_role` enum extended with: `specification`, `contractor_submission`, `calculation`, `method_statement`, `test_report`, `correspondence`
- `review_status` enum extended with: `ready`, `awaiting_human_review`, `cancelled`, `superseded`
- `compliance_reviews` extended with: `organization_id`, `review_version`, `source_hash`, `extraction_version`, `prompt_version`, `started_at`, `completed_at`, `failed_at`; index added; partial unique index for version idempotency; org-scoped RLS policies added
- `compliance_findings` extended with: `organization_id`; index added; org-scoped RLS policies added
- Three new PostgreSQL RPCs: `begin_controlled_review` (atomic RUNNING transition), `complete_controlled_review_to_human_review` (atomic AWAITING_HUMAN_REVIEW transition), `fail_controlled_review` (atomic FAILED transition), `upsert_review_finding` (idempotent finding row creation)

**Types** (`src/types/database.ts`, `src/types/domain.ts`, `src/lib/documents/roles.ts`):
- New document roles added to `documentRoles` enum; legacy roles kept for backward compatibility
- `specificationRoles` and `submissionRoles` arrays added to domain.ts for orchestrator classification
- `compliance_reviews` Row/Insert types updated with new columns and status values
- `compliance_findings` Row/Insert types updated with `organization_id`
- `documentRoleLabels` extended with all new roles

**Review gateway** (`src/server/services/reviews/`):
- `types.ts` — `ReviewStatus`, `ReviewErrorCode`, `ReviewServiceResult<T>`, `DiscoveredRequirement`, `RetrievedEvidence`, `EvidenceSufficiency`, `ConditionEvaluationDraft`, `FindingDraft`, `RunControlledReviewInput`, `RunControlledReviewResult`, `ReviewAuditRecord`, gateway scope types
- `gateway.ts` — `ReviewPersistenceGateway` typed interface (getReview, beginReview, completeReview, failReview, upsertFinding, updateFindingStatus, listRequirementsForProject, listChunksForDocuments, listEvidenceRegionsForDocuments, listFindingsForReview, listProjectDocuments, writeAudit)
- `memory-review-gateway.ts` — In-memory test implementation with seed helpers (`seedReview`, `seedRequirements`, `seedChunks`, `seedEvidenceRegions`, `seedProjectDocuments`) and state accessors
- `supabase-review-gateway.ts` — Production Supabase implementation calling the new RPCs

**Shared compliance memory gateway** (`src/server/services/compliance/memory-compliance-gateway.ts`):
- Extracted and promoted from condition-persistence.test.ts into a shared, exportable class
- Added `seedCondition`, `seedFinding`, `seedEvidenceRegion`, `seedRequirementScope` helpers
- Added `enableFindingStubs()` for cross-gateway tests where findings are created by the review gateway
- `condition-persistence.test.ts` updated: `makeFinding` now includes `organization_id`

**Pipeline services**:
- `requirement-discovery.ts` — `RequirementDiscoveryService`: maps pre-extracted requirements; scans chunks for mandatory language (shall/must/is required/is to/required to); `filterCheckable` for mandatory-level and mandatory-language filtering; `hasMandatoryLanguage` and `extractLeadingClauseNumber` exported for unit tests
- `evidence-retrieval.ts` — `EvidenceRetrievalService`: hybrid exact-phrase + keyword + numeric scoring; top-5 retrieval results per condition; `EvidenceSufficiency` classification (direct/partial/contextual/irrelevant); submission-document-scoped search only; evidence region linking
- `condition-comparison.ts` — `ConditionComparisonService`: numeric range comparisons via `compareNumericRange` (dimensionless-unit handling added); evidence-presence checks via `compareRequiredEvidencePresence` with correct `evidenceKind` mapping; placeholder result for text/conditional types requiring live AI
- `finding-verifier.ts` — `FindingVerifierService`: deterministic independent verification checking citation validity, quote exactness, clause validity, unit compatibility, condition completeness, applicability justification, unsupported claims; `requiresHumanReview` flag for low-confidence or failed checks

**Review orchestrator** (`src/server/services/reviews/review-orchestrator.ts`):
- Full pipeline: document role confirmation → requirement discovery → condition retrieval → evidence retrieval → deterministic + placeholder comparison → independent verification → parent-finding derivation → atomic condition persistence (via existing `persist_condition_evaluation_and_refresh_parent` RPC) → human-review handoff
- Idempotency: skips re-run when all hashes match and status is already `awaiting_human_review`
- Audit: emits events for review start, condition evaluation, finding creation, completion, failure, and idempotent skips
- Audit metadata never contains full evidence text or reasoning strings
- Never auto-approves — always transitions to `awaiting_human_review`
- Previous findings with human override protected via existing RPC guard (skips condition, continues review)
- Spec-only documents excluded from evidence search

**API routes**:
- `POST /api/reviews/controlled` — Creates draft review row, invokes orchestrator; returns status + counts; authenticated + org-scoped + canRunReview role check
- `GET /api/reviews/[reviewId]` — Returns review status, timing, finding count by status; authenticated + org-scoped

**Tests** (`src/tests/review-orchestrator.test.ts`): 56 tests (294 total across 18 files) covering:
- Golden speaker test: spec clause "2.2.1 A.1(b)" (8 × 3.5-inch HQ drivers) vs submission → awaiting_human_review
- Auto-approval prevention invariant
- RequirementDiscoveryService: hasMandatoryLanguage (7), extractLeadingClauseNumber (4), fromExtracted (2), discoverFromChunks (2), filterCheckable (3)
- EvidenceRetrievalService: no-match → irrelevant, exact phrase → direct, keyword partial, submission-only scope, numeric match, null primaryQuote, cap at 5 results
- ConditionComparisonService: not_proven for no evidence, exact numeric → complied, text_match no evidence, humanReviewRequired flag, contractorAction, numeric range in-range → complied, out-of-range → not_complied
- FindingVerifierService: all checks pass, complied without citation, unsupported claim, incompatible units, missing_information, human review flag
- Orchestrator reliability: REVIEW_NOT_FOUND, PROJECT_ACCESS_DENIED, REVIEW_STATE_CONFLICT (running/approved), idempotent skip, non-idempotent hash mismatch, zero findings for unprocessed docs, awaiting_human_review with zero requirements, multiple requirements, no conditions → skip, audit events, audit metadata safety, spec-only evidence exclusion, restart from failed, org access denial, multiple conditions per requirement

**Limitations and deferred scope**:
- Provisional requirements (discovered from chunks when no extracted_requirements rows exist) are not persisted — they are included in discovery but skipped in the condition evaluation loop since they have no DB row
- Semantic search (pgvector embeddings) not yet implemented — keyword + numeric scoring only
- Live AI comparison and verification are not wired — comparison service returns `ambiguous` for text/conditional types with evidence; verifier is fully deterministic
- Migration `20260628000000_controlled_review_pipeline.sql` must be reviewed and applied manually before controlled reviews can run in production
- Controlled review is an additive pipeline separate from the legacy `POST /api/reviews` route; the legacy route is preserved intact

### Verification (Unit 11)
- `pnpm lint` passed (warnings only, all pre-existing)
- `pnpm typecheck` passed (clean)
- `pnpm test` passed: 294 tests across 18 files
- `pnpm build` passed

### Unit 12 — Controlled Live AI Wiring for Semantic Review
Completed:

**Pre-implementation assessment (18 items)**:
- AI provider interface (`AiProviderClient`) existed with injectable transport
- Provider router, consent guard, AI-run persistence, mock providers all existed
- No real provider adapters existed; all API keys empty in .env
- All prompts at v1.0.0-placeholder; no production system prompts
- No task-specific AI schemas for: requirement refinement, condition decomposition, reranking
- No execution mode concept in orchestrator
- No AI-wired comparison, verification, or reranking services
- No per-condition AI run tracking or confidence flags
- Architecture supports real provider without migration; ai_runs schema complete

**New AI task types and schemas**:
- `requirement_refinement` and `evidence_reranking` added to `aiTaskTypes` and `taskModelTier`
- `organization-settings.ts` `taskModelsSchema` extended with both new types
- `src/lib/ai/review-schemas.ts` created: `requirementRefinementOutputSchema`, `conditionDecompositionOutputSchema` (with validation for ranges, numeric required, duplicate key rejection), `evidenceRerankingOutputSchema`, `aiComparisonOutputSchema` (with complied-requires-citation and not_proven-requires-missing guard), `confidenceFlags` constant and `ConfidenceFlag` type

**Real system prompts** (updated from v1.0.0-placeholder to v1.0.0):
- `src/lib/prompts/requirement-refinement.ts` — new file with production `requirementRefinementPrompt`
- `src/lib/prompts/evidence-reranking.ts` — new file with production `evidenceRerankingPrompt`
- `src/lib/prompts/condition-review.ts` — `requirementDecompositionPrompt` and `conditionComparisonPrompt` updated to production prompts with conservative evidence rules
- `src/lib/prompts/finding-verification.ts` — `findingVerificationPrompt` updated to production prompt with independent verification rules

**Anthropic provider adapter** (`src/server/services/ai/anthropic-provider.ts`):
- Implements `AiProviderClient` for the Anthropic Messages API
- Injectable `transport` function for mocked-transport unit testing
- Normalizes HTTP errors to `AiProviderError` codes (auth_error, rate_limited, provider_unavailable, etc.)
- Implements `repair()` for one repair attempt
- Cost estimation from model tier rates
- **Live external calls NOT verified** — `ANTHROPIC_API_KEY` is empty in the current environment; adapter tested with mocked transport only

**Provider registry** (`src/server/services/ai/provider-registry.ts`):
- `resolveProviderClient(provider)` returns typed `AiProviderClient | null`
- Reads credentials from `process.env` only — never from Supabase tables
- `_injectTestTransport()` for test transport injection
- `anyProviderAvailable(allowedProviders)` for pre-flight credential check
- OpenAI, Gemini, Mistral, OpenRouter: adapter not yet implemented; `resolveProviderClient` returns null for those

**Controlled AI execution service** (`src/server/services/ai/controlled-execution.ts`):
- `ControlledAiExecutionService.execute<T>()`: full lifecycle — consent → routing → credential check → create run → execute → validate/repair → complete run → audit
- `hashSafeInputRef()` for SHA-256 hash of safe ID fields (never raw text)
- Returns `ControlledExecutionResult<T>`: typed success with runId/provider/model/repaired, or typed error
- Runs audit events: RUN_REQUESTED, RUN_STARTED, RUN_COMPLETED, RUN_FAILED, OUTPUT_VALIDATION_FAILED
- Audit metadata never contains confidential input text

**AI-wired review services**:
- `ai-condition-comparison.ts` — `AiConditionComparisonService`: uses deterministic first; calls AI only for text/conditional/feature/material types; falls back to deterministic + `DETERMINISTIC_FALLBACK_USED` flag on failure; conservative override when AI is more optimistic than deterministic
- `ai-finding-verifier.ts` — `AiFindingVerifierService`: always runs deterministic verifier first; runs separate AI verifier run with `finding_verification` task; detects disagreement (passed ≠, citation ≠, quote ≠); resolves to conservative status on disagreement; combines both results (AND logic); sets `VERIFIER_DISAGREEMENT` flag
- `evidence-reranker.ts` — `EvidenceRerankerService`: sends bounded candidate list (max 5) to AI; applies DIRECT/PARTIAL/CONTRADICTORY/CONTEXTUAL/IRRELEVANT/UNVERIFIED classification; re-sorts candidates; updates sufficiency; falls back silently on AI failure

**Review orchestrator** updated (`src/server/services/reviews/review-orchestrator.ts`):
- `ExecutionMode` type: `"deterministic" | "mock" | "controlled_live"`
- Constructor accepts optional `ControlledAiExecutionService`; instantiates `AiConditionComparisonService`, `AiFindingVerifierService`, `EvidenceRerankerService`
- `runControlledReview` accepts `executionMode` in input and optional `actor` (required for AI stages)
- AI stages active only when `executionMode !== "deterministic"` AND executor is provided AND actor is present
- Result includes: `executionMode`, `aiRunCount`, `humanReviewRequiredCount`, `flags: ConfidenceFlag[]`
- Disagreement detection: conservative status applied when comparison and verifier disagree
- `DETERMINISTIC_FALLBACK_USED` flag emitted when AI unavailable; `VERIFIER_DISAGREEMENT` when disagreement detected

**API route updated** (`POST /api/reviews/controlled`):
- Accepts optional `executionMode`: `"deterministic"` (default) | `"mock"` | `"controlled_live"`
- For live mode: pre-flight checks AI settings and provider credentials before creating review row
- Wires `ControlledAiExecutionService` + `SupabaseAiPersistenceGateway` for non-deterministic modes
- Response includes: `executionMode`, `aiRunCount`, `humanReviewRequiredCount`, `flags`
- Prompt version bumped to `1.0.0`

**Tests** (`src/tests/ai-live-wiring.test.ts`): 44 new tests (338 total across 19 files) covering:
- Anthropic adapter: POST to endpoint, x-api-key header, response text extraction, 401→auth_error, 429→rate_limited (retryable), 500→provider_unavailable (retryable), repair request
- Provider registry: null when key missing, AnthropicProvider when key set, null for unimplemented providers
- AI review schemas: valid requirement refinement, empty requirement rejected, valid decomposition, duplicate keys rejected, range without min/max rejected, valid reranking, complied without citation rejected, not_proven without missingInformation rejected, low confidence requires human review
- ControlledAiExecutionService: AI disabled blocked, consent missing blocked, disallowed provider blocked, disallowed task blocked, external transmission blocked, no credentials blocked, success + audit events, repair once on invalid output, fail safely on repeated invalid output, timeout normalized, audit logs exclude confidential text
- hashSafeInputRef: 64-char hex, different entity IDs produce different hashes
- Golden speaker review — execution modes: deterministic → awaiting_human_review, never auto-approves, mock mode falls back to deterministic + flag, parent status always deterministic
- AiConditionComparisonService: deterministic for numeric conditions, fallback for text without executor, no evidence → missing_evidence flag
- AiFindingVerifierService: fallback without executor, citation failure blocks complied
- Conservative evidence rules: optional capability = PARTIAL not DIRECT, complied without citation fails, verification passed=true with citationValid=false fails

**Limitations and deferred scope**:
- **Live external calls NOT verified**: `ANTHROPIC_API_KEY` is empty; no live API call has been made. The adapter is implemented and tested with mocked transport only.
- OpenAI, Gemini, Mistral, OpenRouter adapters are not yet implemented (`resolveProviderClient` returns null for those)
- Requirement refinement service is defined as a prompt contract but not wired into the orchestrator (requirement discovery uses the existing deterministic + DB-extracted approach)
- Provisional requirements (discovered from chunks) are not persisted to `extracted_requirements` — they are still skipped in the condition loop
- pgvector semantic embedding search not yet implemented in `EvidenceRetrievalService`
- Migration `20260628000001_controlled_review_pipeline_schema.sql` must be applied manually before live reviews can run
- No reviewer UI page for controlled review status

**Environment variables required**:
- `ANTHROPIC_API_KEY` — must be set for Anthropic live mode
- `AI_PROVIDER` — legacy config; new architecture uses org AI settings, not this env var

### Verification (Unit 12)
- `pnpm lint` passed (warnings only, all pre-existing)
- `pnpm typecheck` passed (clean)
- `pnpm test` passed: 338 tests across 19 files
- `pnpm build` passed

### Unit 13 — Provisional Requirement Persistence and First Human Review Workspace
Completed:

**Pre-implementation assessment (14 items)**:
- Two unapplied migrations: `20260628000001_*` (pending, must apply first) and new `20260629000000_*`
- `extracted_requirements` lacked organization_id, is_active, requirement_state, and all provisional metadata
- Provisional requirements were silently skipped (synthetic `"provisional-{i}"` IDs, no DB row)
- Human review fields existed on `compliance_findings` and `condition_evaluations` but no review workspace existed
- No API for workspace data, finding approval, or requirement confirmation
- No three-panel review workspace page

**Migration** (`20260629000000_provisional_requirement_persistence.sql`) — *must apply AFTER 20260628000001*:
- Extends `extracted_requirements` with: `organization_id`, `review_id`, `requirement_state` (check constraint: discovered/provisional/confirmed/rejected/superseded), `section_heading`, `normalized_text`, `discovery_confidence`, `refinement_confidence`, `ai_run_id`, `prompt_version`, `human_review_required`, `human_review_reasons`, `is_active`, `superseded_at`, `superseded_reason`, `created_by`, `updated_at`
- RLS enabled on `extracted_requirements` (was previously unprotected); org-scoped select/insert/update policies
- Indexes: org+project (active), review+is_active, document+active
- `compliance_findings` extended with `reviewer_comment`, `annotation_ready`
- `compliance_reviews` extended with `annotation_ready`, `annotation_ready_at`, `annotation_ready_by`, `annotation_blockers`

**Database types** (`src/types/database.ts`):
- `extracted_requirements` Row/Insert types updated with all new columns
- `compliance_findings` Row/Insert types updated with `reviewer_comment`, `annotation_ready`
- `compliance_reviews` Row/Insert types updated with annotation-ready columns

**Provisional requirement persistence service** (`src/server/services/reviews/provisional-requirements.ts`):
- `ProvisionalRequirementService`: `persistDiscovered()` (idempotent, human-confirmed protected, duplicate prevention), `confirm()` (idempotent, sets state to confirmed), `reject()` (auditable, confirmed requirements cannot be rejected)
- `ProvisionalRequirementGateway` interface with `findExisting`, `insert`, `get`, `setState`, `listActive`, `listForReview`, `writeAudit`
- `SupabaseProvisionalRequirementGateway` — production implementation
- `MemoryProvisionalRequirementGateway` — test implementation with in-memory storage

**Review orchestrator** updated:
- Constructor accepts optional `provisionalGateway: ProvisionalRequirementGateway | null`
- When gateway is provided: discovered-from-chunk requirements are persisted as `requirement_state = "provisional"` with `human_review_required = true`; they receive a real DB ID and continue into the condition evaluation loop
- When gateway is null: falls back to old behavior (synthetic ID, skipped in loop) for backward compatibility
- Provisional findings use lower weightage (0.5) and special reasoning marker
- `const discovered` replaces `let discovered` (push instead of reassignment)

**Human review API routes**:
- `GET /api/reviews/[reviewId]/workspace` — full review workspace data (review, requirements, conditions, findings, evaluations, evidence links, regions, documents, summary counts)
- `PATCH /api/reviews/[reviewId]/findings/[findingId]` — approve/reject/update finding with validation: positive statuses require evidence, explanation statuses require reasoning, writes audit event
- `PATCH /api/reviews/[reviewId]/requirements/[requirementId]` — confirm/reject provisional requirement via `ProvisionalRequirementService`
- `GET /api/reviews/[reviewId]/ready-for-annotation` — gate validation (returns blockers)
- `POST /api/reviews/[reviewId]/ready-for-annotation` — marks review annotation-ready if all blockers clear; writes audit event

**Ready-for-annotation gate** blockers:
- `JOBS_RUNNING` — active processing jobs
- `REVIEW_TERMINAL` — review in failed/cancelled/superseded state
- `UNDECIDED_FINDINGS` — high-risk findings without reviewer decision
- `UNRESOLVED_CITATION_FAILURE` — not_verified findings without human override
- `PROVISIONAL_REQUIREMENTS` — provisional requirements not confirmed/rejected

**Review workspace page** (`/projects/[projectId]/reviews/[reviewId]`):
- Three-panel layout: requirement tree (left) | evidence viewer (centre) | finding inspector (right)
- Left panel: clause/status filtering, search, requirement state badges, status badges
- Centre panel: evidence excerpt display; warning when visual coordinates unavailable; text-only evidence for this unit (no PDF rendering)
- Right panel: requirement details, provisional confirmation, conditions with evaluations, draft finding status (separate: deterministic / human override), approve/reject/comment actions; sticky reviewer controls
- Reviewer decision model clearly separated: deterministic → AI → reviewer override
- `ReviewWorkspace` client component: self-contained with inline fetch for actions

**Supporting components**:
- `RequirementStateBadge` — discovered/provisional/confirmed/rejected/superseded with color tones
- `ConfidenceFlagBadge` + `ConfidenceFlagList` — warning/info badges for AI confidence flags

**AI settings page** (`/settings/ai`):
- Shows org AI status (enabled, consent, default provider, transmission allowance)
- Shows provider credential status: "Configured in server environment" or "Credential missing"
- Never displays API key values
- Live provider verification endpoint reference for admins

**Live provider verification** (`POST /api/admin/ai-verify`):
- Admin-only, production-disabled unless `ENABLE_PRODUCTION_DEV_WORKER=true`
- Sends predefined non-confidential test clause only — never transmits client documents
- Requires org AI settings and consent
- Persists AI run for audit
- Returns: verified, runId, provider, model, latency, schema validation result
- **Live calls still unverified** — `ANTHROPIC_API_KEY` remains empty

**Tests** (`src/tests/provisional-requirements.test.ts`): 39 new tests (377 total across 20 files) covering:
- Valid provisional requirement persisted
- Empty requirementText rejected (source grounding)
- Duplicate active requirement at same source location prevented
- Different clause numbers at same page are not duplicates
- Human-confirmed requirement protected on rerun
- Rejected requirement remains auditable in DB
- Cannot reject a confirmed requirement (must supersede instead)
- Confirmation writes audit event
- Confirm is idempotent
- Provisional requirement carries humanReviewRequired=true
- Non-existent requirement → error on confirm
- Cross-project access denied on confirm
- Audit records exclude requirement text
- Orchestrator: persists provisional from chunk scan when gateway provided
- Orchestrator: no persistence when gateway=null (backward-compat)
- Orchestrator: confirmed requirement protected on rerun
- Mandatory language detection (9 positive/negative cases)
- RequirementDiscoveryService chunk scanning (discovers/excludes correctly)
- Ready-for-annotation gate: provisional blocks, zero provisional passes, not_verified blocks, not_verified with override passes, all clear → passes
- Reviewer decision precedence: override > deterministic > raw; override survives rerun
- Positive status requires evidence; not_proven does not

**Reviewer decision model enforced**:
- `effectiveStatus = human_override_status ?? deterministic_derived_status ?? status`
- Human override is never silently replaced by AI reruns
- Verifier result does not replace comparison result in the inspector; both are shown separately
- Parent status always derived deterministically (never set by AI)

**Limitations and deferred scope**:
- Evidence viewer shows text excerpts only — no PDF page rendering
- Workspace page uses server-rendered initial data; refresh on action completion uses `refreshKey` state (no server revalidation without full reload)
- AI settings page is read-only — settings mutations require admin API (covered by existing `PUT /api/admin/ai-settings` or direct Supabase admin)
- Live provider verification (`ANTHROPIC_API_KEY`) remains unverified with real credentials
- Both Unit 11 and Unit 13 migrations remain unapplied in production

### Verification (Unit 13)
- `pnpm lint` passed (warnings only, all pre-existing)
- `pnpm typecheck` passed (clean)
- `pnpm test` passed: 377 tests across 20 files
- `pnpm build` passed

### Unit 14 — Production Verification and Approved-Finding Annotation Foundation
Completed:

**Part A — Database-Backed End-to-End Verification**

Pre-implementation assessment (12 items): All applied migrations verified to match database.ts types. No discrepancies found. `compliance_reviews`, `extracted_requirements`, `compliance_findings`, and `evidence_regions` all correctly typed. `annotation_ready` gate columns present.

**Project review navigation** added to `/projects/[projectId]/page.tsx`:
- Reviews card showing all review rows with status badges and workspace links
- "Open workspace" button visible for `awaiting_human_review` and `approved` reviews
- "Start controlled review" link to new `/projects/[projectId]/reviews/start` page
- `StartReviewForm` client component: picks execution mode (deterministic/mock/live), optional title, calls `POST /api/reviews/controlled`, redirects to workspace on success

**Workspace action refresh fixed**: `ReviewWorkspace` client component now calls `router.refresh()` after every approve/reject/confirm action, triggering Next.js server-component re-fetch without a full page reload.

**Part B — Approved-Finding PDF Annotation Foundation**

**Dependency**: `pdf-lib@^1.17.1` added to `package.json`; installed via `pnpm install --no-frozen-lockfile`.

**Migration** (`20260630000000_annotation_outputs.sql`) — *must be applied manually*:
- New `annotation_outputs` table: tracks generated annotated PDFs with organization/project/review scope, source + output hashes, renderer version, contract version, draft status, finding IDs, page-level warnings, approver, timestamps
- RLS: org-scoped select/insert/update policies
- Indexes: review + draft_status, org + project

**Annotation content templates** (`src/lib/annotations/content.ts`):
- `generateAnnotationText()` — pure function, no AI calls
- Produces: `calloutText` (≤500 chars with header, reasoning, missing info, action), `fullReasoning` (unlimited), `actionLine`, `statusLabel`, `clauseLabel`

**Annotation styles** (`src/lib/annotations/styles.ts`):
- `getAnnotationStyle(status)` returns `AnnotationStyleMeta` with `highlightShape` (rectangle/cloud), `connectorDash`, and `AnnotationColors` for all 9 compliance statuses
- All RGB values are 0–255; no hardcoded hex in component code

**Annotation placement engine** (`src/lib/annotations/placement.ts`):
- `computeAnnotationPlacement()` — pure deterministic function
- Priority: right → left → above → below
- Sorts candidates: unclipped first, then lowest collision score
- Output: highlight box, callout box, connector start/end, side, collision score, warnings
- Page-boundary protection: all outputs clamped to page
- Collision avoidance: computes overlap area with existing callouts
- Manual-positioning warning when no unclipped placement found
- Same input always produces same output (deterministic)

**Annotation preparation service** (`src/server/services/annotations/annotation-preparation.ts`):
- `AnnotationPreparationService.prepare()` validates each finding before render
- Rejection reasons: not reviewer-approved, superseded, stale source hash, complied/exceeds without quote, invalid normalized box, missing evidence document, page number < 1
- Returns `PreparedAnnotation[]` (passed) + `AnnotationRejection[]` (failed) — failed findings are excluded, not blocking
- Generates content text and style for each prepared annotation

**PDF renderer interface** (`src/lib/annotations/pdf-renderer.ts`):
- `PdfAnnotationRenderer` interface: `render(input) → Promise<PdfAnnotationRenderResult>`
- Result includes: outputBuffer, outputHash (SHA-256), outputStoragePath, pageCount, page-level warnings, annotationCount, rendererVersion

**pdf-lib renderer** (`src/server/services/annotations/pdf-lib-renderer.ts`):
- `PdfLibAnnotationRenderer` implements `PdfAnnotationRenderer` using pdf-lib
- Downloads source PDF from Supabase private storage
- Verifies SHA-256 source hash before rendering
- Converts normalized (0–1) bounding boxes to PDF points (with y-axis flip for PDF bottom-left origin)
- Draws: evidence highlight rectangle + callout box (filled) + connector line
- Uses `HelveticaBold` for header, `Helvetica` for body; renders clause + status + reasoning text in callout
- Applies status-specific colors from `AnnotationStyleMeta`
- Calls `computeAnnotationPlacement` per annotation; skips pages not in PDF
- Uploads output to `exports` bucket as a new private file (never overwrites source)
- Records output hash; returns with per-page warnings

**API routes**:
- `GET /api/reviews/[reviewId]/annotations` — lists existing draft outputs
- `POST /api/reviews/[reviewId]/annotations` — generates annotation draft for all approved findings; validates annotation-ready gate; groups by PDF document; records in `annotation_outputs`; writes audit event
- `GET /api/reviews/[reviewId]/annotations/[outputId]/download` — generates signed URL (10 min TTL) for private download; writes audit event

**Annotation preview page** (`/projects/[projectId]/reviews/[reviewId]/annotations`):
- Shows annotation-ready status (green/amber)
- Lists existing draft outputs with: annotation count, page count, draft status badge, download link, warnings summary, output SHA-256 prefix
- "Generate annotation draft" button with `GenerateAnnotationsButton` client component
- Download links to signed URL endpoint (private storage, no public URL)

**Tests** (`src/tests/annotation-foundation.test.ts`): 42 new tests (419 total across 21 files) covering:
- `AnnotationPreparationService`: valid finding accepted, not-approved rejected, superseded rejected, stale hash rejected, complied without quote rejected, exceeds_requirement without quote rejected, invalid normalized box rejected, null box accepted, page < 1 rejected, partial success (some pass/some fail), content text generation, style correct, no auto-approval
- `generateAnnotationText`: header with clause+status, 500-char limit, full reasoning with quote, null actionLine, fallback clause label, all statuses produce valid labels
- `getAnnotationStyle`: complied→green+rectangle, partially_complied→cloud, not_complied→cloud, ambiguous→dashed, not_proven→dashed, all RGB in 0–255
- `computeAnnotationPlacement`: right-first default, page boundary protection, left fallback when right clipped, no evidence overlap, connector start on callout boundary, connector end at evidence center, collision minimization, warning when no unclipped placement, deterministic output, rotated page
- Golden speaker test: 2.2.1 A.1(b) partially_complied → validation passes, callout contains clause+status, full reasoning states proven+missing+neodymium+quote, cloud highlight style, placement within A4 page

**Limitations and deferred scope**:
- PDF renderer tested via unit tests only; integration with real Supabase storage requires both migrations and the `exports` bucket to be set up
- Cloud/outline annotation shape is recorded in style but rendered as rectangle in current pdf-lib implementation (cloud PDF shape requires polygon path — future enhancement)
- Word, PowerPoint, Excel annotation exports are not implemented
- Final compliance reports remain pending
- Live AI calls remain unverified (ANTHROPIC_API_KEY is empty)
- `annotation_outputs` table not yet applied to production database

### Verification (Unit 14)
- `pnpm lint` passed (warnings only, all pre-existing)
- `pnpm typecheck` passed (clean)
- `pnpm test` passed: 419 tests across 21 files
- `pnpm build` passed

### Unit 15 — Full Client-Demo Workflow Verification and Annotation Hardening
Completed:

**Manual setup (user-confirmed before implementation)**:
- Migration `20260630000000_annotation_outputs.sql` applied to Supabase
- Private `exports` Supabase Storage bucket created
- Existing auth, projects, uploads, and private storage confirmed working

**Pre-implementation assessment (16 items)**:
- All applied migrations verified against database.ts types — no discrepancies
- Schema: `annotation_outputs` table with `draft_status` check constraint (`draft`/`approved`/`superseded`), org-scoped RLS, correct indexes
- Storage path convention: output path was missing `projectId` (could cause cross-project path collision) — fixed
- Annotation revision: no supersession on regen — fixed
- Evidence viewer: `primaryRegion` always null (evidenceLinks not loaded, IIFE not computing) — fixed
- Workspace annotation link went to JSON API endpoint instead of page — fixed
- Callout text had no word wrapping — fixed
- Dead code with RGB typo (`d:` instead of `b:`) in styles.ts — removed

**Code changes**:
- `src/lib/annotations/styles.ts` — Removed 6 dead-code RGB constants (none were used; GREEN had `d: 61` typo); all styles use `rgb()` helper directly
- `src/server/services/annotations/pdf-lib-renderer.ts` — Added `wrapWords(text, maxChars)` pure word-wrap function; updated callout text rendering to per-line wrap with overflow indicator; fixed `buildOutputPath` to include `projectId` in storage path
- `src/components/reviews/generate-annotations-button.tsx` — Removed unused `rendererVersion` destructuring
- `src/app/api/reviews/[reviewId]/annotations/route.ts` — Removed unused `docIds` variable; added explicit type for `results`; added supersession block before each render to mark previous `draft` outputs as `superseded`
- `src/components/reviews/review-workspace.tsx` — Added `EvidenceLink` type; added `evidenceLinks` prop; computed `primaryRegion` via IIFE from evaluations + evidenceLinks; replaced broken API link with proper `<Link>` to annotations page; removed `primaryRegion` and `documents` from `FindingInspector` (never used there)
- `src/app/(dashboard)/projects/[projectId]/reviews/[reviewId]/page.tsx` — After loading evaluations, now loads `condition_evidence_regions` and `evidence_regions` from DB; passes both as props to `ReviewWorkspace`

**New tests** (`src/tests/demo-verification.test.ts`): 61 tests (480 total across 22 files) covering:
- Placement engine — edge cases: landscape, rotated page, left/right/top/bottom edge, multiple existing callouts, very small evidence box
- Callout content and overflow: long reasoning truncated at 500 chars, fullReasoning not truncated, missing info in both outputs, contractor action, null action, callout ends with `…` when overflowed
- Annotation styles — all statuses: cloud for partially_complied/not_complied, rectangle for complied/exceeds_requirement, dashed connector for ambiguous/not_proven, all RGB in 0–255 range, unknown status fallback
- Preparation validation: valid finding passes, no reviewer rejected, stale hash rejected, matching hash passes, complied without quote rejected, partially_complied/not_proven without quote accepted, box outside [0,1] rejected, box summing past edge rejected, null box accepted, page 0 rejected, no auto-approval
- Annotation revision lifecycle: stable contractVersion, multiple findings produce multiple entries, superseded excluded, finding ID preserved, different statuses produce different styles
- Source document integrity: prepare does not mutate inputs, hash mismatch detected, hash match passes, SHA-256 output is 64-char hex
- Security invariants: signed URL TTL ≤600s constant, contractVersion is "1.0", no storage paths or credentials in prepared output, empty reviewerId rejects, output path unique from source path
- Ready-for-annotation gate: zero inputs → zero prepared, all rejected → zero prepared, partial batch passes the passing ones
- No external AI calls: generateAnnotationText, computeAnnotationPlacement, AnnotationPreparationService.prepare — none make fetch calls
- Golden demo — 2.2.1 A.1(b) active speaker (10 tests): passes validation, callout contains clause reference, status label correct, full reasoning contains proven/missing/neodymium/quote/contractor action, cloud style, placement within A4 bounds, connector end at evidence center, no auto-approval

**Limitations and deferred scope**:
- Browser verification not yet performed — no browser is available in this environment; must be verified manually by navigating the deployed app
- Cloud/scalloped annotation outline still renders as rectangle in pdf-lib (cloud polygon path not yet implemented)
- Word/Excel/PowerPoint annotation exports not implemented
- Final compliance matrix (Excel) and draft Word report not implemented
- Live AI calls remain unverified (ANTHROPIC_API_KEY is empty)

### Verification (Unit 15)
- `pnpm lint` passed (warnings only, all pre-existing)
- `pnpm typecheck` passed (clean)
- `pnpm test` passed: 480 tests across 22 files
- `pnpm build` passed

### Unit 16 — Client-Demo Readiness and Browser Smoke Test Infrastructure
Completed:

**Pre-implementation assessment**: 3 UX deficiencies identified:
- Start-review page showed `{uuid.slice(0,8)}…` instead of filename
- Project page reviews list showed workspace link only for `awaiting_human_review`/`approved`
- Document processing queued only; user saw "Run the worker" message with no auto-trigger

**System readiness diagnostics service** (`src/lib/diagnostics/`):
- `readiness.ts` — injectable `DiagnosticsClient` interface + `runReadinessChecks()` with 12 checks: Supabase URL, anon key, service-role key, Anthropic key, DB connectivity, 5 required tables, RPC functions (3 RPCs probed), annotation outputs RLS, worker queue, documents bucket, exports bucket, production guard
- `client.ts` — `buildDiagnosticsClient(admin)` wraps Supabase admin client; RPC existence probed via empty call + PGRST202 error check; `buildEnvFlags()` returns boolean presence flags only — never credential values

**Dev-only UI pages** (disabled in production unless `ENABLE_DEV_DIAGNOSTICS=true`):
- `/dev/system-readiness` (`src/app/(dashboard)/dev/system-readiness/page.tsx`) — server component; shows READY/WARNING/BLOCKED table with color-coded rows; overall banner; "Trigger document processing" button; security reminder footer; no secrets exposed
- `/dev/demo-checklist` (`src/app/(dashboard)/dev/demo-checklist/page.tsx`) — static page; before-demo checklist (7 items), during-demo script (7 items), do-not-claim section (7 items)

**`TriggerWorkerButton` client component** (`src/components/dev/trigger-worker-button.tsx`):
- Calls `POST /api/dev/processing/run-worker` with batchSize=10
- Shows spinner, success result (processed/succeeded/failed/skipped), and error state
- No-op in production (endpoint returns 404 there)

**UX fixes**:
- `src/app/(dashboard)/projects/[projectId]/reviews/start/page.tsx` — added `file_name` to document query; shows filename instead of UUID fragment in "Documents ready for review" list
- `src/app/(dashboard)/projects/[projectId]/page.tsx` — reviews list now shows workspace/progress/details link for ALL review states (not just `awaiting_human_review`/`approved`); link label is context-sensitive ("Open workspace", "View progress", "View details")
- `src/components/reviews/start-review-form.tsx` — redirects to workspace for all statuses when `reviewId` is returned (previously only redirected for `awaiting_human_review`/`completed`)
- `src/components/documents/document-process-button.tsx` — fire-and-forget call to `/api/dev/processing/run-worker` after successful queue; seamless processing in dev without manual worker trigger; production-safe (endpoint guards itself)

**Sidebar dev links** (`src/components/layout/app-sidebar.tsx`):
- "Dev" section added below main nav when `NODE_ENV !== "production"`
- Links to `/dev/system-readiness` and `/dev/demo-checklist` with amber color scheme and "DEV ONLY" visual treatment
- Both mobile header and desktop sidebar updated

**`pnpm worker:documents` script** added to `package.json`:
- Runs `curl -s -X POST http://localhost:3000/api/dev/processing/run-worker` with batchSize=10
- Requires the app to be running (`pnpm dev`) and the user to be authenticated

**Tests** (`src/tests/system-readiness.test.ts`): 30 tests (510 total across 23 files) covering:
- Secrets hidden (3): env values not in report, detail shows var name not value, Anthropic absence → WARNING
- Missing migration → blocked (3): missing table → blocked, missing RPC → blocked with name, all present → ready
- Missing exports bucket → blocked (2)
- Public exports/documents buckets → blocked (3)
- Worker warning (2): queued > 0 → warning with count, zero → ready
- DB connectivity (4): null → blocked, throws → blocked, connected → table checks run, not connected → table checks skipped
- Annotation outputs RLS (2): false → warning, true → ready
- Production guard (2): production → warning, development → ready
- Overall status aggregation (4): all ready → ready, warning present → warning, blocked overrides warning, checkedAt timestamp valid
- No credentials in items (2): no JWT/key patterns in detail, checkRequiredRpcs called with correct RPC names
- RPC error handling (1): throws → warning not blocked
- Service-role key missing (2): serviceRoleKeySet false → blocked, supabaseUrlSet false → blocked

**Scope restrictions honored**:
- No live Anthropic calls enabled
- No secrets exposed in diagnostics page
- Dev pages return 404 in production (notFound() guard)
- No browser tests claimed as passed (browser verification remains pending)
- No pgvector, no Word/Excel exports, no auto-approval, no public storage

**Limitations**:
- Browser verification not yet performed — manual navigation required in the deployed app
- `pnpm worker:documents` requires `curl` on PATH (pre-installed on Linux/Mac; on Windows, use Git Bash or the /dev/system-readiness page button instead)
- Worker endpoint requires active browser session (cookie-based auth); curl invocation without cookies will return 401

### Verification (Unit 16)
- `pnpm lint` passed (warnings only, all pre-existing — no new errors)
- `pnpm typecheck` passed (clean)
- `pnpm test` passed: 510 tests across 23 files
- `pnpm build` passed

### Unit 17A — CLI Worker Entry Point and Diagnostics Liveness Split
Completed:

**Problem solved**: `pnpm worker:documents` used `curl` with Unix shell quoting incompatible with Windows PowerShell. Even with Windows-compatible curl, the API route required browser session cookies (`getCurrentProfile()`), making it impossible to invoke from a terminal without an active browser session.

**CLI entry point** (`src/server/workers/run-document-worker.ts`):
- Directly instantiates `createSupabaseAdminClient()` → `SupabaseProcessingGateway` → `createDocumentProcessingWorker()` → `worker.processBatch(batchSize)`
- No HTTP calls, no browser cookies, no Next.js routes
- `parseBatchSize(args)` — validates `--batch-size=N` flag; returns `{ valid, size }` or `{ valid: false, reason }`; default 10, maximum 100
- `buildWorkerId()` — `cli-{host}-{pid}-{timestamp}`
- `runDocumentWorkerBatch(options)` — injectable `gateway`, `workerFactory`, `log` for test isolation
- CLI entry block runs only when `process.argv[1]` ends in `run-document-worker.ts/.js`
- Validates `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` before creating client
- Logs only safe batch counts (never credentials, document body, or extracted text)
- `process.exit(0)` on success or empty queue; `process.exit(2)` on config failure; `process.exit(3)` on runtime error

**package.json changes**:
- `tsx@^4.19.3` added to `devDependencies` (installed: 4.22.4)
- `worker:documents` script replaced: `tsx --env-file .env src/server/workers/run-document-worker.ts`
- No curl, no Unix shell quoting, cross-platform compatible

**Diagnostics split** (`src/lib/diagnostics/readiness.ts`):
- Renamed `worker_queue` item label to "Queue depth" — reports queued/retry-wait job counts only
- Added `worker_liveness` item — always WARNING: "Continuous worker liveness cannot be confirmed. Run `pnpm worker:documents` to process queued jobs, or set up a persistent worker process."
- This prevents the page from falsely claiming the worker is running merely because the queue schema exists or jobs are queued

**Existing dev route unchanged** (`/api/dev/processing/run-worker`):
- Still requires `getCurrentProfile()` and `canUploadDocument(profile.role)`
- Still protected: dev-only unless `ENABLE_PRODUCTION_DEV_WORKER=true`
- Used by `TriggerWorkerButton` in the browser; not callable from CLI

**Tests** (`src/tests/cli-worker.test.ts`): 29 tests (539 total across 24 files) covering:
- Package configuration (4): script exists, uses tsx not curl, references entry file, tsx in devDependencies
- `parseBatchSize` (7): default 10, explicit size, minimum 1, maximum 100, 101 rejected, 0 rejected, abc rejected
- `buildWorkerId` (2): starts with "cli-", consecutive calls differ
- `runDocumentWorkerBatch` (6): returns result shape, calls processBatch with batchSize, passes workerId to factory, returns worker result, uses provided gateway, propagates errors
- Security invariants (3): log output no service_role/JWT, no document text, parseBatchSize reason is safe human-readable
- Diagnostics `worker_liveness` (4): always WARNING, mentions `pnpm worker:documents`, no credentials in detail, overall status is warning
- Browser route auth guard (3): source requires `getCurrentProfile`, returns 401, CLI source has no fetch/localhost

**Existing system-readiness test updated** (`src/tests/system-readiness.test.ts`):
- "all ready → overallStatus is ready" updated to "best-case overallStatus is warning (worker_liveness is always warning)"
- All 30 existing tests still pass under the new behavior

**Live execution confirmed**:
```
Document worker started
Worker ID: cli-DESKTOP-R022D4N-1552-1782490832645
Batch size: 10
Recovered abandoned: 0
Processed: 0
Succeeded: 0
Retried: 0
Failed: 0
Skipped: 0
Document worker finished
Queue was empty — no jobs to process.
```

**Security invariants preserved**:
- CLI never logs credentials, document body, extracted text, or storage tokens
- Error messages truncated to 200 characters at the catch boundary
- `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` read only at startup; never printed
- Browser dev route authentication guard (cookies) unchanged and intact

### Verification (Unit 17A)
- `pnpm install` passed: tsx 4.22.4 installed
- `pnpm lint` passed (warnings only, all pre-existing)
- `pnpm typecheck` passed (clean)
- `pnpm test` passed: 539 tests across 24 files
- `pnpm build` passed
- `pnpm worker:documents` ran successfully against live Supabase (queue was empty)

### Unit 17H — Product Direction Correction (completed)

**Core correction**: The client's primary requirement is automated clause-by-clause technical compliance review. The annotated PDF was a reference example only, not the primary deliverable. This unit corrects the product direction across context files, UI, and tests.

**Files created:**
- `src/lib/compliance/client-stages.ts` — `ClientProjectStage` type, `classifyFinding()`, `countAutoVerified()`, `countRequiresAttention()`, `CLIENT_STAGE_ACTION`, `CLIENT_STAGE_LABEL`, `COMPLIANCE_REPORT_SECTIONS`
- `src/tests/product-direction.test.ts` — 52 regression tests (22 required + additional)

**Files modified:**
- `src/app/(dashboard)/projects/[projectId]/page.tsx`:
  - Workflow stepper: removed "Annotation" step; added "Automated review", "Human verification", "Compliance report" steps
  - Tabs: "Review" → "Automated review"; "Findings" → "Compliance matrix"; "Activity" → "Report"
  - Status label: `awaiting_human_review` → "Needs your review"
  - Header action: "Open workspace" → "Review flagged findings"; "Start review" → "Run automated review"
  - Overview tab: exception-based review summary (auto-verified count + requires-attention count + "Review flagged findings" CTA)
  - Readiness card: "Submission evidence" → "Proposed product / contractor submission"
  - Removed Document assistant from side panel
  - Report tab: compliance report placeholder replacing activity tab
- `src/app/(dashboard)/projects/page.tsx`:
  - Status label: `human_review_pending` → "Needs your review"
  - Next action: "Open workspace" → "Review flagged findings"
- `src/tests/project-first-navigation.test.ts` — updated stale assertions for renamed tab ("report") and renamed action ("Run automated review")
- `context/project-overview.md` — full rewrite with correct product definition, client requirement, primary user flow, exception-based review model
- `context/architecture.md` — added Primary Output and Annotation Reclassification sections
- `context/ui-context.md` — added Automated Review UI section, Terminology Map
- `context/code-standards.md` — updated E2E test scope
- `context/ai-workflow-rules.md` — updated Annotation Rules with "optional enhancement" classification
- `AGENTS.md` — updated Current Product Principle

**Key product corrections recorded:**
- Client requirement: automated clause-by-clause review so client does not need to manually cross-check every clause
- Example annotated PDF was a reference only, not the primary deliverable
- Primary output: compliance matrix + structured compliance report
- Primary export: PDF/DOCX/XLSX report (deferred implementation)
- Annotated PDF: optional export enhancement, hidden from normal workflow
- Exception-based review: reviewers inspect only flagged findings
- `NOT_PROVEN` remains distinct from `NOT_COMPLIED`
- Live AI remains disabled
- Source documents remain immutable

**Annotation subsystem status:**
- Preserved: all annotation tables, APIs, placement logic, renderer, styles, and tests
- Reclassified: optional export enhancement, not a primary stage
- Hidden from: normal client workflow, workflow stepper, project tabs
- Available via: direct URL `/projects/[id]/reviews/[id]/annotations`

**Verification:**
- `pnpm lint` — warnings only (pre-existing)
- `pnpm typecheck` — clean
- `pnpm test` — 771/771 (29 test files)
- `pnpm build` — succeeded

---

### Unit 17I — Fix Automated Review Navigation, State Synchronization, and Client Workflow (completed)

**Real browser test exposed 7 workflow defects:**
1. Start-review page stayed on "Starting review…" forever — never redirected
2. Project page showed duplicate/contradictory actions simultaneously
3. Workspace showed "Mode: controlled live" even when Deterministic was selected
4. Workspace showed "Annotations & readiness" link not part of normal client workflow
5. All 66 findings showed "pending review" / "provisional" — exception-based filtering absent
6. Evidence was visibly irrelevant to requirements
7. Malformed extracted text display (e.g., `u Typical coverage…` bullet artifacts)

**Root causes:**
- Redirect failure: `POST /api/reviews/controlled` ran the entire orchestrator synchronously inside the HTTP handler. Browser fetch timed out before response.
- Mode display: workspace page checked `review.prompt_version` which is always `"1.0.0"`, always showed "controlled_live".
- Provisional requirements: all 66 chunk-discovered requirements created as `provisional`, none auto-confirmed.
- Evidence threshold: `compositeScore > 0` — any shared keyword passed through as evidence.

**Fixes:**

**Two-phase review creation:**
- `src/app/api/reviews/controlled/route.ts` — Now creates `"draft"` row and returns `redirectUrl` immediately. Active-review guard. Stores `execution_mode`.
- `src/app/api/reviews/[reviewId]/execute/route.ts` (NEW) — Runs orchestrator. Called by progress page on mount.

**DB migration:**
- `supabase/migrations/20260702000000_review_execution_mode.sql` (NEW) — Adds `execution_mode` column to `compliance_reviews`.

**Progress page:**
- `src/components/reviews/review-progress-page.tsx` (NEW) — Stage progress display. Auto-triggers execute route. Polls when already running. Shows retry on failure.
- `src/app/(dashboard)/projects/[projectId]/reviews/[reviewId]/page.tsx` — Shows `ReviewProgressPage` for `draft`/`running`. Reads `execution_mode` from DB.

**Workspace fixes:**
- Filter default: `"all"` → `"requires_attention"`
- Mode/status label maps: `deterministic → "Deterministic review"`, `awaiting_human_review → "Needs your review"`
- Removed "Annotations & readiness" link
- Added `requires_attention` filter (provisional + non-complied statuses)
- Applied `normalizeDisplayText()` to evidence text

**Project page action consolidation:**
- `deriveHeaderAction` links to actual workspace URL (was linking to non-existent `/reviews` route)
- `ReviewTab`: no duplicate run button when review exists; "Legacy assessment run" section removed
- `CompactProjectPanel`: hides run button when review exists

**Provisional auto-confirmation:**
- `canAutoConfirm()` — auto-confirms requirements with clause number + mandatory language + text ≥ 30 chars + confidence ≥ 0.6

**Evidence quality:**
- Minimum threshold raised from `> 0` to `>= 0.15`

**Text normalization:**
- `src/lib/documents/text-display.ts` (NEW) — `normalizeDisplayText()` for display-only artifact correction (`u ` → `•`). Never modifies stored text.

**Start page title:**
- "Start controlled review" → "Run automated technical review"

**Tests:**
- `src/tests/review-workflow-17i.test.ts` (NEW) — 30 regression tests
- `src/tests/provisional-requirements.test.ts` — updated for auto-confirm behavior, added provisional-without-clause-number test
- Total: 809/809 (30 test files)

**Constraints honored:** No live AI, no report exports, annotation subsystem preserved.

**Pending migration:** `supabase/migrations/20260702000000_review_execution_mode.sql` must be applied manually.

**Verification:**
- `pnpm lint` — warnings only (all pre-existing)
- `pnpm typecheck` — clean
- `pnpm test` — 809/809 (30 test files)
- `pnpm build` — succeeded

---

### Unit 17J — One-Click Automated Review Orchestration (completed)

**Problem solved**: The previous workflow required a reviewer to: (1) open the Documents tab, (2) click Process on each document individually, (3) wait for each document to complete, (4) navigate to the Automated Review tab, (5) start the review, (6) wait again. Unit 17J collapses this into a single button press anywhere on the project page.

**New files created:**

- `src/lib/projects/automated-review-state.ts` — Pure shared state resolver: `AutomatedReviewActionState` discriminated union (9 states), `AutomatedReviewPrimaryAction` discriminated union, `resolveAutomatedReviewAction()` pure function. No IO. Used everywhere; no state logic duplicated across components.

- `src/app/api/projects/[projectId]/run-automated-review/route.ts` — One-click orchestration endpoint:
  - Authenticates + checks `canRunReview` permission
  - Verifies project ownership
  - Guards: reuses existing `draft/running/awaiting_human_review` review if present
  - Checks that at least one spec-role and one submission-role document exist (returns 422 otherwise)
  - Enqueues any non-completed, non-actively-processing documents
  - Creates draft review with `execution_mode: "deterministic"`
  - Returns `{ data: { reviewId, status, enqueuedDocCount, redirectUrl } }` immediately
  - `redirectUrl` points to the project-level progress page (`/projects/[id]/review-progress?reviewId=[id]`)

- `src/app/api/projects/[projectId]/processing-status/route.ts` — Lightweight poll endpoint:
  - Returns `{ totalCount, processingCount, completedCount, failedCount, allDocsReady }`
  - `allDocsReady` = no docs actively processing + at least one completed spec + one completed submission
  - Used by `ProjectProgressClient` to know when to trigger review execution

- `src/app/(dashboard)/projects/[projectId]/review-progress/page.tsx` — Server component:
  - Reads `reviewId` from `searchParams`
  - Verifies review ownership (org-scoped)
  - Redirects immediately to workspace if review is in terminal state
  - Computes `initialAllDocsReady` from two-query document + job pattern
  - Renders `ProjectProgressClient` with initial state

- `src/components/projects/project-progress-client.tsx` — Client polling component:
  - Six stages: "Checking documents" → "Processing files" → "Discovering requirements" → "Searching evidence" → "Evaluating compliance" → "Preparing findings"
  - If docs not ready: polls `GET /api/projects/[projectId]/processing-status` every 3s
  - Once docs ready: calls `POST /api/reviews/[reviewId]/execute`
  - Polls review completion if `initialReviewStatus === "running"` on mount
  - Retry button on retryable errors
  - "Check for results" manual refresh

- `src/components/projects/run-review-button.tsx` — One-click action button:
  - Calls `POST /api/projects/[projectId]/run-automated-review`
  - Shows spinner + "Starting…" during call
  - On success: `router.push(data.redirectUrl)` to project progress page
  - Three variants: `primary`, `compact`, `full-width`
  - Inline error message on failure

- `src/tests/one-click-review.test.ts` — 28 regression tests (7 describe blocks):
  - Block 1 (resolver review states, 6 tests): approved, awaiting_human_review, draft/running with reviewId propagation
  - Block 2 (resolver document states, 6 tests): missing spec, missing submission, processing, failed, ready, ready_to_process
  - Block 3 (orchestration endpoint, 6 tests): file exists, nodejs runtime, canRunReview check, active-review guard, enqueues docs, returns redirectUrl
  - Block 4 (processing-status endpoint, 3 tests): file exists, auth check, allDocsReady field
  - Block 5 (review-progress page, 3 tests): file exists, reads reviewId, renders ProjectProgressClient
  - Block 6 (ProjectProgressClient, 3 tests): file exists, polls processing-status, calls execute
  - Block 7 (RunReviewButton, 3 tests): file exists, calls run-automated-review, navigates to redirectUrl

**Files modified:**

- `src/app/(dashboard)/projects/[projectId]/page.tsx`:
  - Imports `resolveAutomatedReviewAction`, `AutomatedReviewActionResult`, `RunReviewButton`
  - Computes `anySpecDoc`, `anySubmissionDoc`, `hasAnyFailed` from resolved docs
  - Computes `actionResult` via `resolveAutomatedReviewAction()` for all UI decisions
  - `deriveHeaderAction()` refactored: takes `actionResult` + `projectId`; returns resolver-driven JSX (review_findings → amber link, view_progress → blue link, view_approved → emerald link, run_review → `RunReviewButton`, upload_documents → `ProjectUploadButton`)
  - `OverviewTab`: `canRunReview` prop replaced by `actionResult`; "Run automated review" link replaced by `<RunReviewButton>`
  - `ReviewTab`: `canRunReview` prop replaced by `actionResult`; run link replaced by `<RunReviewButton>`
  - `CompactProjectPanel`: `canRunReview` + `latestReview` props replaced by `actionResult`; run link replaced by `<RunReviewButton>`
  - `DocumentRegister`: "Action" column header renamed "Options"; per-document Process buttons moved inside `<details><summary>More ▾</summary>` disclosure (hidden by default, reveal on click)

- `src/tests/review-workflow-17i.test.ts`: Two 17I tests updated to reflect 17J refactor:
  - "deriveHeaderAction takes latestReviewId parameter" → checks `actionResult` + `resolveAutomatedReviewAction` imports
  - "CompactProjectPanel hides run button when review exists" → checks `action.type === "run_review"` pattern + `RunReviewButton`

**Architecture invariants preserved:**
- Two-phase review creation (draft row → separate execute) from Unit 17I unchanged
- Per-document process APIs (`POST /api/documents/[documentId]/process`) preserved — one-click endpoint enqueues by calling the same DB operations directly
- No live AI enabled
- No compliance report export implemented
- Annotation subsystem untouched
- All RLS + org-ownership checks present in new endpoints

**Constraints honored:** No live AI, no report exports, no per-doc API deletion, no architectural rewrites.

**Verification:**
- `pnpm lint` — warnings only (all pre-existing)
- `pnpm typecheck` — clean
- `pnpm test` — 843/843 (31 test files)
- `pnpm build` — succeeded, new route `/projects/[projectId]/review-progress` in build output

---

### Unit 17K — Continuous Document Worker and Truthful Progress Messaging (completed)

**Problem solved**: The one-click orchestration endpoint (Unit 17J) creates queued processing jobs but `pnpm worker:documents` exits after one batch. Jobs remain stuck in "queued" state indefinitely. The progress page displayed "Processing files" even when no worker was active — a misleading message that gave users no path to resolution.

**Files created:**

- `src/server/workers/watch-document-worker.ts` — Continuous polling worker:
  - Reads `WORKER_DOCUMENT_BATCH_SIZE` (default 10, max 100), `WORKER_DOCUMENT_POLL_INTERVAL_MS` (default 3000), `WORKER_DOCUMENT_IDLE_BACKOFF_MS` (default 5000) from env
  - `parseWatchWorkerConfig()` — pure config resolver, injectable for tests
  - `createStopSignal()` — returns `{ stopped, stop() }` mutable signal
  - `runWatchWorkerLoop(options)` — async loop; awaits each batch sequentially (no batch overlap); backs off with `idleBackoffMs` on empty queue; logs work cycles; swallows batch errors and continues; exits cleanly when `stopSignal.stopped`
  - `buildBatchRunner()` — creates real `DocumentProcessingWorker` from Supabase admin client; never creates an HTTP connection
  - CLI entry block: validates env vars, registers SIGINT/SIGTERM handlers that call `stopSignal.stop()`, starts loop, exits cleanly
  - Exports: `DEFAULT_WATCH_BATCH_SIZE`, `MAX_WATCH_BATCH_SIZE`, `DEFAULT_POLL_INTERVAL_MS`, `DEFAULT_IDLE_BACKOFF_MS`, `WatchWorkerConfig`, `StopSignal`, `MutableStopSignal`, `WatchWorkerLoopOptions`

- `src/tests/watch-worker.test.ts` — 33 regression tests (7 describe blocks):
  - Block 1 (`parseWatchWorkerConfig`, 5 tests): defaults, reads all 3 env vars, clamps batch size > max
  - Block 2 (source structure, 4 tests): file exists, no Next.js imports, exports `runWatchWorkerLoop` + `parseWatchWorkerConfig`
  - Block 3 (`runWatchWorkerLoop` actual behavior, 5 tests): runs one batch before stopping, pre-stopped runs zero batches, continues after error, logs work cycles, silent on idle
  - Block 4 (package.json script, 2 tests): `worker:documents:watch` exists, points to `watch-document-worker.ts`
  - Block 5 (.env.example, 3 tests): all 3 env vars present
  - Block 6 (CLI shutdown, 3 tests): SIGINT/SIGTERM handlers registered, env var validation present
  - Block 7 (processing-status enrichment, 3 tests): `queuedCount`, `stalledCount`, backward-compat fields
  - Block 8 (ProjectProgressClient messaging, 4 tests): `queuedCount`, worker hint, stalled warning, active state
  - Block 9 (exported constants, 4 tests): correct values for all 4 defaults

**Files modified:**

- `package.json` — added `"worker:documents:watch": "tsx --env-file .env src/server/workers/watch-document-worker.ts"` script

- `.env.example` — added `WORKER_DOCUMENT_BATCH_SIZE=10`, `WORKER_DOCUMENT_POLL_INTERVAL_MS=3000`, `WORKER_DOCUMENT_IDLE_BACKOFF_MS=5000` under a `# Document processing worker` comment

- `src/app/api/projects/[projectId]/processing-status/route.ts` — enriched response:
  - Now selects `heartbeat_at` in addition to existing job fields
  - Builds separate per-doc stall-detection map (first occurrence per doc = latest, since ordered by `created_at DESC`)
  - Computes `queuedCount` (latest job = "queued"), `claimedCount` (latest job = "claimed"/"running"), `stalledCount` (claimed/running with `heartbeat_at` > 5 min stale)
  - Returns all three new fields alongside existing `{ totalCount, processingCount, completedCount, failedCount, allDocsReady }`
  - Backward-compatible: existing fields unchanged

- `src/components/projects/project-progress-client.tsx` — truthful messaging:
  - Added `DocWorkerState = "active" | "queued" | "stalled" | null` type
  - `ProcessingStatusResponse` type extended with `queuedCount`, `claimedCount`, `stalledCount`
  - `pollDocuments()` now sets `docWorkerState` from each poll response: `stalledCount > 0` → "stalled", `claimedCount > 0` → "active", `queuedCount > 0` → "queued"
  - `docPhaseHeading()` / `docPhaseDetail()` — return truthful text based on `docWorkerState`
  - Worker hint box shown when `docWorkerState === "queued"`: shows `pnpm worker:documents:watch` command
  - Stalled-job warning shown when `docWorkerState === "stalled"`: amber alert with restart command
  - `handleRetry()` resets `docWorkerState` to null

**Architecture invariants preserved:**
- `DocumentProcessingWorker.processBatch()` not duplicated — watch worker calls it directly
- Claim/heartbeat/retry/abandoned-recovery logic untouched
- No HTTP connections from the worker
- No live AI enabled
- No compliance-report export
- No worker running inside the Next.js web process
- Original documents not overwritten

**Constraints honored:**
- "Do not run the worker inside the Next.js web process" — watch worker is a standalone `tsx` process
- "Do not enable live AI" — no AI code paths
- "Do not implement compliance-report export" — not touched
- "Do not redesign unrelated pages" — only `project-progress-client.tsx` and `processing-status` route changed
- "Do not rebuild the processing engine" — `DocumentProcessingWorker` unchanged

**Verification:**
- `pnpm lint` — warnings only (all pre-existing)
- `pnpm typecheck` — clean
- `pnpm test` — 876/876 (32 test files)
- `pnpm build` — succeeded

**Next implementation unit:** Real browser verification of the full one-click flow with `pnpm worker:documents:watch` running: upload spec + submission → "Run automated review" → progress page shows "Waiting for worker" → start watch worker → progress updates to "Processing files" → findings workspace opens.

## In Progress

- Live browser verification of the full workflow (upload → process → review → flagged findings → approve → report) — must be done manually in a browser by navigating to the running app
- Pending migrations must be applied before live browser verification can succeed:
  - `20260628000001_controlled_review_pipeline_schema.sql`
  - `20260629000000_provisional_requirement_persistence.sql`
  - `20260630000000_annotation_outputs.sql`
  - `20260703000000_worker_liveness.sql` (new — worker health marker table)
- Live AI provider activation pending (ANTHROPIC_API_KEY empty)

---

### Unit 17L — Prepare CompliAgent for Vercel Web + Railway Worker Deployment (completed)

**Problem solved**: Both worker scripts used `tsx --env-file .env` which requires a physical `.env` file. Railway injects env vars directly into `process.env`, so the flag would break in production. The progress page also showed infrastructure commands (terminal commands) to all users regardless of environment.

**Files created:**

- `src/server/workers/load-env.ts` — optional local env loader:
  - Reads `.env` from project root (or a custom path) when the file is present; no-op when absent
  - Never overwrites existing `process.env` values (Railway-injected vars take precedence)
  - Does not evaluate shell syntax — treats `$(...)` and backtick expressions as literal strings
  - Silently ignores missing or unreadable files

- `src/server/workers/worker-env.ts` — Zod validation at the env boundary:
  - Validates `NEXT_PUBLIC_SUPABASE_URL` (required), `SUPABASE_SERVICE_ROLE_KEY` (required), `SUPABASE_STORAGE_BUCKET_DOCUMENTS` (default: "documents"), and optional numeric vars
  - Throws with a safe message listing only field names — never logs values
  - Used at startup of both worker entry points

- `supabase/migrations/20260703000000_worker_liveness.sql` — worker heartbeat table:
  - `worker_liveness` table with `worker_type` (PK), `worker_id`, `last_heartbeat_at`, `started_at`
  - RLS enabled; authenticated users can read (for progress-page messaging)
  - Service-role client (worker) bypasses RLS and can upsert directly
  - Must be applied manually before the liveness heartbeat can be stored

- `src/server/workers/check-deployment-readiness.ts` — `pnpm deploy:check` script:
  - Loads `.env` optionally, validates env vars via Zod, creates admin client
  - Checks: DB connectivity, 8 required tables, 4 required RPCs, documents storage bucket (must be private)
  - Prints `✓`/`✗` per check; exits 0 on full pass, 1 on any failure
  - Never prints secret values — only field names and safe status strings

- `context/deployment-railway-worker.md` — Railway deployment guide:
  - Service setup, start command, required env vars, healthy startup logs, liveness monitoring, crash/restart behavior, troubleshooting, migration list, final setup checklist

- `context/deployment-vercel.md` — Vercel deployment guide:
  - Project setup, build settings, required env vars, Supabase checklist (migrations, RPCs, buckets, RLS, Auth), deployment checklist

- `src/tests/deployment-17l.test.ts` — 35 regression tests (10 describe blocks):
  - `loadLocalEnv` (4 tests): sets missing vars, does not overwrite existing, silent when absent, literal shell syntax
  - `validateWorkerEnv` (5 tests): valid env passes, missing URL throws, missing key throws, error has no secret values, bucket defaults to "documents"
  - `packageManager` (2 tests): field present, matches `pnpm@X.Y.Z` pattern
  - Railway separation (4 tests): no `--env-file` in either script, both workers call `loadLocalEnv`
  - Startup diagnostics (2 tests): logs batch size, doesn't log URL value
  - Worker liveness migration (2 tests): file exists, contains `last_heartbeat_at`
  - Processing-status route (2 tests): queries `worker_liveness`, returns `workerLiveness` field
  - Vercel separation (1 test): no `runWatchWorkerLoop` in route handlers
  - Production messaging (4 tests): `NODE_ENV` guard before pnpm command, active/unavailable messages present, `workerLiveness` tracked in client
  - deploy:check (2 tests): script in package.json, source file exists
  - Deployment docs (4 tests): both markdown files exist with expected content
  - Secret-safety (3 tests): worker-env.ts never logs, load-env.ts no eval/exec, check script never prints key value

**Files modified:**

- `package.json`:
  - Added `"packageManager": "pnpm@10.33.4"` field
  - `worker:documents` script: removed `--env-file .env` → `tsx src/server/workers/run-document-worker.ts`
  - `worker:documents:watch` script: removed `--env-file .env` → `tsx src/server/workers/watch-document-worker.ts`
  - Added `"deploy:check": "tsx src/server/workers/check-deployment-readiness.ts"` script

- `src/server/workers/run-document-worker.ts`:
  - Added import of `loadLocalEnv` and `validateWorkerEnv`
  - CLI entry block now calls `loadLocalEnv()` before env checks
  - Replaced manual env var checks with `validateWorkerEnv()` (Zod)
  - Updated doc comment: removed `--env-file .env` from example invocation

- `src/server/workers/watch-document-worker.ts` (major update):
  - Added `loadLocalEnv` and `validateWorkerEnv` imports
  - Added `WORKER_HEARTBEAT_INTERVAL_MS = 30_000` and `WORKER_TYPE = "document_processing"` exports
  - CLI entry block: `loadLocalEnv()` + `validateWorkerEnv()` before any env reads
  - Safe startup diagnostics: logs batch size / intervals / "Supabase configuration: present" / bucket name — never URL or key values
  - Worker liveness heartbeat: `admin.from("worker_liveness").upsert(...)` every 30s via `setInterval`
  - Initial heartbeat sent immediately on startup; timer cleared on clean exit or fatal error
  - Removed duplicate `createSupabaseAdminClient()` call — single client shared for batch running and heartbeat

- `src/app/api/projects/[projectId]/processing-status/route.ts`:
  - Added `WORKER_ACTIVE_THRESHOLD_MS` (2 min) and `WORKER_STALE_THRESHOLD_MS` (10 min) constants
  - Parallel queries now include `worker_liveness` table (`.eq("worker_type", "document_processing").maybeSingle()`)
  - Computes `workerLiveness: "active" | "stale" | "unknown"` from heartbeat age
  - Returns `workerLiveness` in response alongside existing fields

- `src/components/projects/project-progress-client.tsx`:
  - Added `WorkerLiveness = "active" | "stale" | "unknown"` type
  - Added `IS_PRODUCTION = process.env.NODE_ENV === "production"` constant (inlined at build time)
  - Extended `ProcessingStatusResponse` type with optional `workerLiveness` field
  - Added `workerLiveness` state (`useState<WorkerLiveness>("unknown")`)
  - `pollDocuments()` reads `workerLiveness` from response and calls `setWorkerLiveness`
  - `handleRetry()` resets `workerLiveness` to "unknown"
  - `docPhaseHeading()` / `docPhaseDetail()`: in `IS_PRODUCTION` mode, returns liveness-based user-friendly messages; in dev mode, returns informative messages with worker state details
  - Worker hint box (queued state): dev shows `pnpm worker:documents:watch`; production shows "Documents are queued for processing and will begin shortly."
  - Stalled warning: dev shows "Processing stalled" + restart command; production shows "Service temporarily unavailable" + "The document-processing service is temporarily unavailable. Please try again shortly or contact support."

**Architecture invariants preserved:**
- No worker runs inside the Next.js web process
- No live AI enabled
- No compliance-report export
- No secrets exposed in logs, API responses, or UI
- Original uploaded documents not overwritten
- All RLS and server-side auth checks intact

**Constraints honored:**
- "Do not move the web application away from Vercel" — Vercel config unchanged
- "Do not enable live AI" — no AI code paths added
- "Do not expose or print secret values" — all startup logs reference field names and presence flags only
- "The worker must be able to start in Railway without a checked-in `.env` file" — `--env-file .env` removed; `loadLocalEnv()` is silent when `.env` absent
- "Do not overwrite already-defined environment variables" — `loadLocalEnv` skips keys already in `process.env`
- "Do not add shell-specific syntax" — scripts use plain `tsx` invocation, no shell syntax
- "Normal clients must never see infrastructure commands" — terminal commands guarded by `IS_PRODUCTION`

**Verification:**
- `pnpm lint` — warnings only (all pre-existing)
- `pnpm typecheck` — clean
- `pnpm test` — 911/911 (33 test files; 35 new tests from 17L)
- `pnpm build` — succeeded

**Next implementation unit:** Railway + Vercel deployment — apply `20260703000000_worker_liveness.sql` migration in Supabase, deploy to Railway with start command `pnpm worker:documents:watch`, verify the full one-click flow end-to-end in the live environment.

### Unit 17B — Document Processing Pipeline Bugs Fixed (in progress)

Completed:
- All three pending migrations confirmed applied (`20260628000001`, `20260629000000`, `20260630000000`)
- Diagnosed and fixed 3 critical bugs in the document processing pipeline:

**Bug 1 — `JSON.stringify` double-encoding in `persistExtraction` (root cause of all failures)**
- `supabase-processing-gateway.ts`: `p_pages` and `p_chunks` were passed as `JSON.stringify(input.pages)` — a JSON string — instead of a raw JS array. The Supabase client then encoded the string as a JSON string scalar. The PostgreSQL RPC called `jsonb_array_length(p_pages)` which threw "cannot get array length of a scalar" because a JSON string is not a JSON array.
- Fix: removed `JSON.stringify()` calls; arrays are now passed directly so PostgREST encodes them as proper JSON arrays.

**Bug 2 — `persistExtraction` lacked try-catch in `job-runner.ts`**
- Before: `persistExtraction()` had no try-catch, so RPC failures escaped to the outer catch in `processBatch()` and became `unexpected_worker_error` (swallowing the actual error message).
- Fix: wrapped `persistExtraction()` in try-catch that classifies the error and calls `failJob()` + `updateDocumentStatus()`, returning `{ outcome: "failed" }` normally.
- Also wrapped the subsequent `writeAudit()` (step 11) in best-effort try-catch so a failed audit write cannot un-do a successful persist.

**Bug 3 — Outer catch in `processBatch` didn't update document status**
- Before: when an unexpected exception escaped `executeJob()`, the outer catch called `failJob()` but never called `updateDocumentStatus(documentId, "failed")`. Documents stayed permanently stuck at `queued` status.
- Fix: outer catch now also calls `updateDocumentStatus(job.document_id, "failed")`.
- Additionally, the outer catch now captures `unexpectedError.message` safely (without document content) and stores it as the `safeMessage`.

Added 5 regression tests (total test count: 544):
- Test 31: persistExtraction failure returns `outcome:failed` without throwing (2 tests)
- Test 32: Worker outer catch updates document status and stores safe message (2 tests)
- Test 33: `SupabaseProcessingGateway.persistExtraction` passes arrays (not strings) to RPC (1 test)

Created CLI utility scripts:
- `src/server/workers/reenqueue-documents.ts` — re-enqueues failed/queued documents with no active job
- `src/server/workers/diagnose-extraction.ts` — downloads + extracts files and optionally calls the RPC directly to diagnose errors
- `src/server/workers/run-db-diagnostics.ts` — queries document/job/page/chunk counts and project_id alignment

Documents in project `ebd8aa84` now fully processed:
- `Doc.-1-Specifications-Highlighted-References-.docx` (af58c08b) — role=main_specification — 15 pages, 146 chunks
- `Doc.-4-Proposed-Speaker-with-referencing.pdf` (0398baba) — role=product_datasheet — 4 pages, 33 chunks

Document role assignment is correct: `main_specification` + `product_datasheet` → `canRunReview = true`.

Verification passed:
- `pnpm typecheck` — clean
- `pnpm test` — 544/544
- `pnpm build` — succeeded

### Unit 17C — Deterministic Review Execution (in progress)

Completed:

**Bug fixes (4 additional bugs found and fixed):**

1. **`JSON.stringify` double-encoding for `p_evidence_links`** (`supabase-compliance-gateway.ts`): Same root-cause bug as the page/chunk arrays in Unit 17B. `p_evidence_links` was JSON-stringified before being passed to `persist_condition_evaluation_and_refresh_parent`, causing `jsonb_array_elements()` to fail. Fix: pass the raw array directly.

2. **`ProvisionalRequirementGateway` not wired** (`app/api/reviews/controlled/route.ts`): The controlled review route created `ReviewOrchestrator(reviewGateway, complianceGateway, aiExecutor)` with no 4th argument. Result: provisional requirements from chunk discovery got synthetic IDs (`provisional-{page}-{ts}`) and were skipped. Fix: instantiate `SupabaseProvisionalRequirementGateway` and pass it as the 4th arg.

3. **No conditions created for provisional requirements in deterministic mode** (`review-orchestrator.ts`): When `conditions.length === 0` and `executionMode === "deterministic"`, the orchestrator skipped the requirement entirely, producing zero findings. Fix: inline auto-creation of one `boolean` evidence-presence condition per requirement with no pre-existing conditions. Human reviewers can refine these.

4. **Migration `20260628000000` not applied to live Supabase**: The `review_status` enum is missing values `ready`, `awaiting_human_review`, `cancelled`, `superseded`. The `complete_controlled_review_to_human_review` RPC fails when called. This migration must be applied manually via the Supabase dashboard SQL editor.

**Files modified:**
- `src/app/api/reviews/controlled/route.ts` — wire ProvisionalRequirementGateway
- `src/server/services/reviews/review-orchestrator.ts` — auto-create conditions in deterministic mode
- `src/server/services/compliance/supabase-compliance-gateway.ts` — fix JSON.stringify for evidence_links

**Files created:**
- `src/tests/deterministic-review.test.ts` — 35 regression tests (18 required by spec, 17 additional)
- `src/server/workers/run-deterministic-review.ts` — CLI review runner for live testing
- `src/server/workers/check-and-apply-enum.ts` — enum validation diagnostic
- `src/server/workers/test-enum.ts` — enum existence test

**Tests modified:**
- `src/tests/document-processing-worker.test.ts` — added test 34 (evidence_links array regression)
- `src/tests/review-orchestrator.test.ts` — updated "skips requirements without conditions" to reflect new deterministic auto-condition behavior

**Verification:**
- `pnpm typecheck` — clean
- `pnpm test` — 580/580 passed (25 test files)
- `pnpm build` — succeeded

**Remaining blocker — migration `20260628000000` not applied:**

The live Supabase database is missing enum values from migration `20260628000000`. Run this SQL in the Supabase dashboard SQL editor:

```sql
alter type public.review_status add value if not exists 'ready';
alter type public.review_status add value if not exists 'awaiting_human_review';
alter type public.review_status add value if not exists 'cancelled';
alter type public.review_status add value if not exists 'superseded';
alter type public.document_role add value if not exists 'specification';
alter type public.document_role add value if not exists 'contractor_submission';
alter type public.document_role add value if not exists 'calculation';
alter type public.document_role add value if not exists 'method_statement';
alter type public.document_role add value if not exists 'test_report';
alter type public.document_role add value if not exists 'correspondence';
```

After applying, run `pnpm worker:documents` to verify the queue, then navigate to the project and start a deterministic review.

## Next Up

### Unit 17D — Document Status Sync, Dev Nav, and Project UX (completed)

**Root cause of stale status**: `documents.processing_status` was used as the sole status source. The process route sets it to "queued" on every enqueue, even when a prior job completed. If a new job's completion updates the documents table via RPC, the column is correct; but if the last successful run updated only the jobs table and the document row was never re-read, or a subsequent re-enqueue clobbered the correct value, the page shows the stale "queued" value while `page_count = 4` remains from the previous successful extraction.

**Why page_count=4 appeared alongside queued**: The `replace_document_extraction_transactionally` RPC atomically writes `page_count` AND sets `processing_status = "completed"`. After the reenqueue script set status back to "queued" for re-processing, the worker re-ran and set both fields correctly. The page was loading cached or stale data before the final worker run. Going forward, the resolved status comes from the latest job, not the document column.

**Fixes:**
- `src/lib/documents/document-status.ts` (NEW) — canonical resolver using latest job row (created_at DESC, updated_at DESC, id DESC). If no job exists, falls back to document row with active-status normalization to "uploaded".
- `src/server/services/projects.ts` — `listProjectDocuments()` now runs two queries in parallel (documents + latest extraction jobs per project) and merges them.
- `src/app/(dashboard)/projects/[projectId]/page.tsx` — full rewrite using `resolveDocumentStatus()` for all status decisions. Role-based readiness (spec vs submission role families). Demo wording removed. Project header with doc count + primary action. Document register with resolved status badges, action label from resolver, per-row error messages.
- `src/components/documents/document-process-button.tsx` — replaced `useTransition`-based loading (which marked ALL buttons pending during `router.refresh()`) with document-scoped `isSubmitting: boolean` state. Only the clicked button shows "Submitting…".
- `src/components/layout/app-sidebar.tsx` — DEV nav now requires both `NODE_ENV !== "production"` AND `NEXT_PUBLIC_SHOW_DEV_TOOLS === "true"`. Hidden by default.
- `.env.example` — added `NEXT_PUBLIC_SHOW_DEV_TOOLS=false` with comment.
- `supabase/migrations/20260701000000_processing_job_dedup_index.sql` (NEW) — partial unique index preventing duplicate active jobs per (document_id, job_type).
- `src/tests/document-status.test.ts` (NEW) — 43 regression tests.
- Architecture invariants 27–29 added.

**Verification:**
- `pnpm typecheck` — clean
- `pnpm lint` — warnings only (pre-existing)
- `pnpm test` — 623/623 (26 test files)
- `pnpm build` — succeeded
- Browser: NOT YET TESTED — requires migration `20260628000000` applied first (missing `awaiting_human_review` enum)

### Unit 17E — Professional SaaS UI/UX Upgrade (completed)

**Data inconsistency root cause**: `listProjects()` was filtering out archived projects with `.neq("status", "archived")`. Both working projects (`ebd8aa84 pro3` and `85b5a526 pro3`) are archived. The active project (`220e0ef4 pro3 draft`) has 0 documents. The dashboard showed the blank active project because the archived ones were invisible. Fix: removed the archived filter — all projects are shown, archived ones visually indicated.

**Files created:**
- `src/components/projects/workflow-stepper.tsx` — 5-step stepper (Documents→Processing→Review→Approval→Annotation)
- `src/components/ui/empty-state.tsx` — reusable empty-state component
- `src/tests/ui-project-status.test.ts` — 49 regression tests
- `src/server/workers/diagnose-project.ts` — project+job diagnostic CLI

**Files modified:**
- `src/server/services/projects.ts` — removed `.neq("status","archived")` from `listProjects`
- `src/components/layout/app-sidebar.tsx` — client component, `usePathname` active state, grouped nav, user profile at bottom, dev flag
- `src/app/(dashboard)/layout.tsx` — profile+isAdmin passed to sidebar, footer disclaimer, cleaner shell
- `src/app/(dashboard)/dashboard/page.tsx` — metric cards, project activity rows, archived notice, empty state
- `src/app/(dashboard)/projects/page.tsx` — active + archived sections, hover-reveal actions
- `src/app/(dashboard)/projects/[projectId]/page.tsx` — breadcrumb, workflow stepper, adaptive sections, dual-layout document register, ReadinessCard, review summary
- `context/ui-context.md` — documented new shell and component patterns
- `context/progress-tracker.md`

**Verification:**
- `pnpm typecheck` — clean
- `pnpm lint` — warnings only (pre-existing)
- `pnpm test` — 672/672 (27 test files)
- `pnpm build` — succeeded
- Browser: NOT YET TESTED — still requires migration `20260628000000` to be applied for review functionality

### Unit 17F — Project-First Navigation and Upload Drawer (completed)

**Files created:**
- `src/app/(dashboard)/overview/page.tsx` — renamed Overview (admin-only guard)
- `src/components/ui/drawer.tsx` — right-side drawer (Escape, scroll-lock, focus)
- `src/components/documents/upload-drawer.tsx` — drag-drop drop zone, role selector with descriptions, validation, aria regions
- `src/components/documents/project-upload-button.tsx` — client button that opens UploadDrawer
- `src/tests/project-first-navigation.test.ts` — 47 regression tests

**Files modified:**
- `src/lib/permissions/roles.ts` — `canSeeOverview()`, `defaultLandingPath()`
- `src/app/(dashboard)/dashboard/page.tsx` — redirect to /overview
- `src/components/layout/app-sidebar.tsx` — role-based items, no Dashboard link, NavSection returns null for empty
- `src/server/actions/auth.ts` — role-based post-login destination
- `src/app/(auth)/login/page.tsx` — default next=/projects
- `src/app/(dashboard)/layout.tsx` — passes profile+isAdmin to sidebar
- `src/app/(dashboard)/projects/page.tsx` — "Needs your attention" section, improved archived section
- `src/app/(dashboard)/projects/[projectId]/page.tsx` — tabs (overview/documents/review/findings/activity), drawer trigger, removed inline upload form
- `context/ui-context.md`, `context/progress-tracker.md`

**Verification:**
- `pnpm typecheck` — clean
- `pnpm lint` — warnings only (pre-existing)
- `pnpm test` — 719/719 (28 test files)
- `pnpm build` — succeeded
- Browser: NOT YET TESTED — migration `20260628000000` still needed for review RPCs

### Unit 17G — Live Browser Verification (after migration `20260628000000` applied)

Prerequisite: Apply migration `20260628000000` via Supabase SQL editor (SQL above).

1. Navigate to `/projects/ebd8aa84-ac1f-4108-acf2-3f6fa1beb48e/reviews/start`
2. Verify: both documents visible (main_specification + product_datasheet), deterministic mode available
3. Start deterministic review — should redirect to workspace
4. Verify workspace: requirements panel, evidence panel, finding panel
5. Confirm one provisional requirement (click confirm)
6. Approve/edit one finding
7. Verify annotation-readiness blockers shown (unconfirmed requirements, unresolved findings)
8. After resolving, confirm gate can pass
9. Document any defects found; add regression tests

### Unit 17B (continued) — Start Review and Workspace Verification (SUPERSEDED by 17C)

Prerequisite: both target documents are now `completed` with correct roles.

1. Navigate to `/projects/ebd8aa84-ac1f-4108-acf2-3f6fa1beb48e` in the browser
2. Confirm both `Doc.-1` (spec, main_specification) and `Doc.-4` (proposal, product_datasheet) show as `completed`
3. Click "Start Review" → select deterministic mode (no Anthropic key) → confirm review creates
4. Open the review workspace → confirm requirements discovered from spec chunks, evidence retrieved from proposal chunks
5. Approve/edit findings → confirm status transitions work
6. Trigger annotation readiness check → confirm gate passes
7. Generate annotated PDF → confirm signed-URL download returns valid PDF
8. Confirm `exports` bucket stays private; confirm no secrets in browser network tab
9. Document any defects found; add regression tests for each
10. Do NOT set ANTHROPIC_API_KEY; do NOT implement report exports

### Unit 14 — Migration Application and Production Verification
1. Apply `20260628000001_controlled_review_pipeline_schema.sql` to Supabase
2. Apply `20260629000000_provisional_requirement_persistence.sql` to Supabase
3. Verify workspace page renders correctly in browser
4. Perform browser verification of finding approval, requirement confirmation, and ready-for-annotation gate
5. Set `ANTHROPIC_API_KEY` and configure org AI settings for live mode

### Unit 13 — Controlled Review Status UI and Live Provider Activation
1. Apply `20260628000001_controlled_review_pipeline_schema.sql` to Supabase
2. Set `ANTHROPIC_API_KEY` in server environment to enable live mode
3. Configure org AI settings (admin UI or direct DB insert) with consent + Anthropic enabled
4. Add controlled review status page to project detail UI
5. Wire provisional requirement persistence to `extracted_requirements`
6. Add pgvector semantic reranking when embeddings are available
7. Implement OpenAI adapter (second real provider)

### Unit 12 — Migration Review and Live AI Wiring (candidate)
1. Review and apply `20260628000000_controlled_review_pipeline.sql` to the live Supabase project
2. Wire `ConditionComparisonService` to the live AI provider for `text_match`, `conditional_requirement`, and similar types (requires organization consent)
3. Wire `FindingVerifierService` to the `findingVerificationPrompt` contract for live AI verification
4. Implement provisional requirement persistence (write discovered-from-chunks requirements to `extracted_requirements` before the condition evaluation loop)
5. Implement pgvector semantic evidence search in `EvidenceRetrievalService`
6. Add a controlled review status page to the reviewer UI

### Unit 1 — Browser Functional Verification
Verify:
1. Signup/login
2. Profile bootstrap
3. Default organization
4. Project creation/list/detail
5. Document upload
6. Storage object
7. Metadata row
8. Permission and error handling

### Unit 2 — Annotation Architecture Migration
Completed. `20260620120000_visual_evidence_annotation_foundation.sql` was reviewed and applied successfully.

### Unit 3 — Document Processing Foundation
Completed:
- PDF extraction
- DOCX extraction
- XLSX extraction
- page-aware chunking
- clause metadata
- processing status
- source mapping
- tests

### Unit 4 — Condition Migration Review and Application
Completed. `20260620233000_requirement_condition_evaluation_foundation.sql` was reviewed and applied successfully.

### Unit 5 — Controlled AI Migration Review and Application
Completed. `20260620235900_controlled_ai_architecture_foundation.sql` was reviewed and applied successfully.

### Unit 6 — AI Run Persistence Service
Completed with server-only settings, consent enforcement, run lifecycle persistence, audit events, input hashing, strict predefined test payloads, and four deterministic mock capability tiers. No live provider or external transmission is enabled.

### Unit 7 — Condition Persistence Services
Completed:
- New migration `20260625000000_condition_persistence_transactional_foundation.sql` adds `is_active`, `revision_number`, `superseded_at`, `superseded_reason` to `requirement_conditions` and `condition_evaluations`; drops legacy unique constraints; creates partial unique indexes for active-only uniqueness; adds `ai_derived_status` and `deterministic_derived_status` columns to `compliance_findings`; creates `persist_condition_evaluation_and_refresh_parent` PL/pgSQL RPC function (SECURITY INVOKER) for atomic multi-table evaluation persistence.
- `database.ts` updated with new columns for all three affected tables.
- `condition-schemas.ts` `parentFindingDerivationResultSchema` strengthened with `appliedRule`, `confidenceSummary`, `compliedConditionIds`, `exceedsConditionIds`.
- `parent-finding.ts` deterministic derivation updated to return all new schema fields; eight named rules implemented.
- `ServiceResult<T>` discriminated union with typed error codes and `ok()` / `fail()` helpers in `src/server/services/compliance/types.ts`.
- `CompliancePersistenceGateway` interface defined in `src/server/services/compliance/gateway.ts`; row types re-exported from `database.ts`.
- `SupabaseComplianceGateway` implements the interface; `HumanApprovalProtectedError` and `FindingNotFoundError` exported for downstream discrimination.
- `RequirementConditionsService`: create, replace AI conditions (human-confirmed protected), list, get, mark superseded.
- `ConditionEvaluationsService`: create draft, update AI draft, apply human review, list, get with condition, mark superseded.
- `ConditionEvidenceService`: link region (supports/contradicts/partially_supports/contextual/missing_expected_region), remove unapproved draft link, list for evaluation, list evaluations by region.
- `ParentFindingService`: deterministic parent computation, transactional persist-and-refresh, human override preservation.
- 33 tests in `src/tests/condition-persistence.test.ts` via in-memory `MemoryComplianceGateway`; covers all services, validation rules, derivation rules, human override, supersession, audit events, confidential-text exclusion, and the driver-requirement partial-compliance example.
- No live AI provider, no OCR, no exports enabled.

### Unit 8 — Durable Document Processing Worker and Persistence Hardening
Completed:
- New additive migration `20260626000000_durable_document_processing_queue.sql` adds `claimed` and `retry_wait` to the processing status enum; adds durable worker columns to `processing_jobs` (priority, attempts, maximum_attempts, available_at, locked_at, locked_by, worker_id, heartbeat_at, started_at, completed_at, failed_at, last_error_code, safe_error_message, extraction_version, created_by); creates three indexes for claiming, heartbeat monitoring, and abandoned-job detection; creates three SECURITY INVOKER RPC functions: `claim_processing_job` (FOR UPDATE SKIP LOCKED), `replace_document_extraction_transactionally` (atomic DELETE + INSERT in PL/pgSQL), and `recover_abandoned_processing_jobs`.
- `database.ts` extended with new `processing_jobs` columns.
- `domain.ts` `processingStatuses` updated with `"claimed"` and `"retry_wait"`.
- `ProcessingJobGateway` interface and typed input/output types defined in `src/server/services/processing/`.
- `DocumentExtractor` interface + `NativeDocumentExtractor` wraps existing extraction pipeline.
- `RetryPolicy`: bounded exponential backoff (60/300/900/3600s), error classification (DocumentExtractionError vs. transient), shouldRetry guard.
- `DocumentExtractionJobRunner.executeJob` performs the full 11-step execution: validate claim, audit start, load document, check support, download file, heartbeat, extract, handle OCR required, persist atomically, audit completion.
- `DocumentProcessingWorker` (platform-agnostic, stoppable): recovery before each batch, per-job heartbeat interval, batch-size limit, clean stop.
- `SupabaseProcessingGateway` implements the gateway using admin client; `claimJob` delegates to RPC; `persistExtraction` delegates to transactional RPC with JSON-serialized pages and chunks.
- Process route (`POST /api/documents/[documentId]/process`) rewritten to enqueue-only; no synchronous extraction.
- Dev-only endpoint `POST /api/dev/processing/run-worker` added (production-disabled unless `ENABLE_PRODUCTION_DEV_WORKER=true`).
- 35 tests in `src/tests/document-processing-worker.test.ts` via in-memory `MemoryProcessingGateway` and `MockDocumentExtractor`: covers all 30 spec scenarios plus 4 error-classification tests.
- No live AI provider, no OCR execution, no exports enabled.
- Migration must be applied to Supabase before the `SupabaseProcessingGateway` can be used in production.

### Unit 9 — Native Document Intelligence and Golden-Test Foundation
Completed. See completed section above.

### Unit 10 — OCR Provider Abstraction
Implement:
- OCR provider interface
- quality check
- OCR fallback trigger
- first provider (e.g. Tesseract or cloud OCR)
- confidence persistence

### Unit 10 — Live Controlled AI Review Pipeline
Implement:
- specialized requirement extraction/decomposition stages
- source-backed hybrid retrieval
- deterministic comparison plus conservative AI comparison
- independent verifier execution
- deterministic parent derivation and finding persistence
- mandatory human-review handoff

### Unit 11 — Evidence Region Mapping
Implement:
- page rendering
- bounding boxes
- finding-region links
- evidence preview

### Unit 12 — Human Review and Annotation UI
Implement:
- reviewer editing
- finding inspector
- annotation editor
- approval flow
- revision history

### Unit 13 — Exports
Implement:
- Excel
- Word
- PDF
- annotated PDF
- export history

## Open Questions

1. Default OCR provider after benchmark?
2. Maximum file size?
3. Maximum pages per project?
4. Convert Word/PPT to PDF first or annotate natively?
5. Excel comments, highlights, PDF, or all?
6. Editable or flattened annotated PDF?
7. Official annotation colors/labels?
8. Arabic in first release?
9. Is cloud processing acceptable for all documents?
10. Required reviewer approval metadata?

## Architecture Decisions

- Generic platform; speaker/PAVA is only a demo.
- Final approval is human-controlled.
- Native extraction before OCR.
- AI and OCR are provider-agnostic.
- Full source traceability is mandatory.
- Original documents are immutable.
- Long work runs as jobs.
- Annotation is a core capability.
- Evidence and annotation coordinates declare their coordinate system; normalized boxes must remain within page bounds.
- Annotation content snapshots the traceable review explanation needed by future rendered output.
- Revision records are append-only and final approval records require a human reviewer and timestamp.
- The original combined `ambiguous_not_proven` database value remains for backward compatibility; new records can distinguish `ambiguous` and `not_proven`.
- Clauses are decomposed into independently checkable conditions before comparison.
- Parent finding status is deterministic when condition evaluations exist.
- Condition evidence must point to exact stored evidence regions and remain organization scoped.
- AI provider access is organization-configured, consent-gated, server-only, and provider-agnostic.
- Comparison and verification are separate structured stages; unverified findings cannot reach final output.
- AI run records store operational metadata and hashes, not full confidential documents.
- Persistence services use the gateway pattern: a typed interface + Supabase implementation + in-memory test implementation; services never call Supabase directly.
- Multi-table compliance writes are atomic via a PostgreSQL PL/pgSQL RPC function (SECURITY INVOKER); the Supabase JS client handles no-rollback two-phase writes only through single-table operations.
- Supersession replaces unique constraints for revision history: old records set `is_active=false`; uniqueness is enforced by partial unique indexes `WHERE is_active = true`.
- Human override protection operates at both TypeScript (service layer guard) and database (RPC raises exception) levels.
- Audit records must never contain full confidential document or evidence text; only IDs, counts, statuses, and rule names are allowed in metadata.
- Parent finding derivation is pre-computed in TypeScript before calling the RPC; the RPC receives the pre-computed status rather than re-deriving it in SQL.

## Session Notes

- Current code passes all checks.
- Supabase migration is applied.
- Supabase connection is verified.
- AI review is not yet implemented.
- Full annotation rendering is not yet implemented.
- Annotation persistence services and API routes are not yet implemented.
- The annotation foundation migration has been applied to Supabase.
- Native extraction uses the existing database schema; no new migration is required for this unit.
- DOCX physical pagination is only trustworthy when explicit or rendered page breaks exist.
- OCR-required pages are detected and recorded, but OCR execution is intentionally deferred.
- Extraction currently runs through the existing process route/job abstraction; a durable external worker remains required before high-volume production processing.
- The condition-level migration has been manually reviewed and applied.
- Annotation condition support remains architecture-only; final PDF rendering is still pending.
- The controlled AI architecture migration has been manually reviewed and applied.
- Live provider adapters, background AI execution, and provider credential configuration are intentionally deferred.
- Document extraction is complete at native-text foundation level; OCR remains a separate pending unit.
- Independent verification is defined and validated as a contract but is not yet executed against live findings.
- Controlled AI persistence and consent enforcement are implemented with mock providers only.
- No confidential document content is transmitted externally; mock execution makes no network requests.
- OCR, live review orchestration, evidence retrieval, verifier execution, annotation rendering, and exports remain pending.
- Condition persistence services are fully implemented with gateway pattern, in-memory tests, and atomic PostgreSQL RPC.
- The new migration `20260625000000_condition_persistence_transactional_foundation.sql` must be applied to Supabase before the live AI review pipeline or any API routes that use the condition persistence services.
- The RPC function `persist_condition_evaluation_and_refresh_parent` handles atomicity; it must be created in the database before the SupabaseComplianceGateway can call it.
- Unit 8 durable worker is fully implemented; the migration `20260626000000_durable_document_processing_queue.sql` must be applied before `SupabaseProcessingGateway` can function in production.
- Document processing is now enqueue-only via the process route; the worker must be triggered separately (e.g., via the dev endpoint or a future cron/queue).
- No daemon process runs automatically; the dev endpoint `POST /api/dev/processing/run-worker` is available for manual batch execution in development.
- Unit 9 adds PPTX extraction, sourceHash on all extraction results, and golden test fixtures. No new database migration is required.
- PPTX extraction uses the existing ZIP reader from extraction.ts and reads `<a:t>` elements from DrawingML slide XML.
- The golden test suite uses synthetic in-memory DOCX buffers (not real files) to verify clause detection, heading detection, and evidence text preservation.
- The simple PDF builder (single Tj operator) is only suitable for single-line text; the DOCX multi-paragraph builder is used for multiline golden fixtures.
- sourceHash is SHA-256 of the raw file buffer, computed before extraction, and is available on `ExtractedDocumentText`, `ProcessingResult`, and `ExtractionOutput`.
