# Code Standards

## General

- Keep modules small and single-purpose.
- Fix root causes instead of adding workarounds.
- Do not mix unrelated concerns.
- Prefer readable, explicit code.
- Preserve working behavior unless explicitly changing it.
- Never hardcode demo-document logic.
- Add tests for critical changes.
- Keep docs synchronized.

## TypeScript

- Strict mode is required.
- Avoid `any`; use explicit types or `unknown`.
- Validate untrusted input.
- Use Zod at API, AI, env, and provider boundaries.
- Prefer named exports.
- Use discriminated unions for state.
- Do not suppress errors without a documented reason.

## Next.js

- Default to Server Components.
- Use `"use client"` only when required.
- Keep route handlers focused.
- Authenticate and authorize before data access.
- Never expose server-only env values.
- Do not run long OCR/AI tasks inside request handlers.
- Keep fetching patterns consistent.

## React and UI

- Keep business logic out of presentational components.
- Handle loading, empty, error, and success states.
- Use shadcn/ui where suitable.
- Do not directly modify generated UI internals unless required.
- Maintain keyboard accessibility and contrast.

## Styling

- Use tokens from `ui-context.md`.
- No hardcoded hex values in components.
- Follow shared spacing and radius rules.
- Do not communicate status by color alone.

## API Routes

- Authenticate first.
- Enforce organization and project ownership.
- Validate input before logic.
- Return consistent typed responses.
- Use correct HTTP status codes.
- Do not expose stack traces or secrets.
- Log safe technical context only.

## Data and Storage

- Metadata belongs in PostgreSQL.
- Files and generated artifacts belong in private storage.
- Do not store large binaries in the database.
- Preserve organization_id and project_id.
- Every chunk keeps document/page traceability.
- Every evidence region keeps coordinates and confidence.
- Every requirement condition stays linked to its source requirement and project.
- Every condition evaluation stays linked to its condition, parent finding, review, project, and organization.
- Condition evidence links must preserve tenant scope and exact evidence-region identity.
- Every annotation links to a finding and evidence region in the same organization/project/document scope.
- Validate normalized coordinates so boxes stay within the unit page boundary.
- Keep annotation revision history append-only.
- Require reviewer identity and timestamp for approved or rejected annotations.
- Render only approved annotations into a new private artifact; never overwrite the source document.
- Use transactions for multi-record changes.
- Add indexes for common queries.

## Supabase

- Separate browser, server, and admin clients.
- Service-role client is server-only.
- RLS is mandatory.
- Use signed URLs.
- Sanitize filenames.
- Validate extension and MIME type.
- Review migration SQL before applying.
- Server services for condition persistence use the gateway pattern: define a typed interface, implement it against Supabase, and provide an in-memory implementation for tests; services accept only the interface, not a concrete client.
- Server services for document processing use the same gateway pattern via `ProcessingJobGateway` (`src/server/services/processing/gateway.ts`); workers and job runners accept only the interface.
- Multi-table transactional writes go through PostgreSQL RPC functions called via `.rpc()`; sequential JS awaits with no rollback mechanism are not acceptable for multi-record atomicity.
- Never rewrite applied migrations; always create a new additive migration.
- Partial unique indexes (`WHERE is_active = true`) are the revision-history alternative to unique constraints when rows must be superseded rather than deleted.
- The Supabase admin client type in service files is `NonNullable<ReturnType<typeof createSupabaseAdminClient>>`, not `SupabaseClient<Database>` directly, to avoid type narrowing conflicts.
- Dev-only API endpoints must check `NODE_ENV` and must require authentication and an appropriate role; they are disabled in production unless explicitly opted in via an environment flag.

## AI

- AI output must be structured JSON.
- Validate with Zod.
- Retry invalid output once.
- Fail visibly after repeated failure.
- Never invent clauses, pages, standards, certifications, values, or citations.
- Use conservative statuses.
- Separate extraction, applicability, comparison, validation, and reporting.
- Separate clause extraction, condition decomposition, evidence retrieval, condition evaluation, and parent derivation.
- Never ask an AI provider to assign a parent finding status when child condition evaluations exist.
- Persist prompt version, provider, model, and run metadata.
- Route every provider call through the provider-agnostic server interface.
- Require organization AI enablement and recorded consent before sending document content externally.
- Select models by task and configured capability tier; do not hardcode one provider or model in compliance logic.
- Keep comparison and verification logically separate and persist their validation/verification state.
- Store an input hash and only necessary excerpts; do not log full confidential document text.
- Normalize provider errors into safe stable codes and retry only retryable failures.
- A repaired structured response must be marked as repaired and remains subject to verification.
- Confidence, weightage, and technical risk are separate values.
- Keep AI settings, consent guards, run persistence, and provider execution in server-only modules.
- Treat missing or malformed organization AI settings as disabled.
- AI settings schemas must reject arbitrary provider configuration keys and must never accept credential fields.
- Persist only input hashes, source identifiers, and safe operational metadata in `ai_runs`; never persist full provider input there.
- Development AI test endpoints accept predefined payload identifiers only and are production-disabled by default.
- Mock providers must not call `fetch`, provider SDKs, or any external transport.

## OCR and Extraction

- Attempt native extraction first.
- Use OCR only when needed.
- Preserve original page numbering.
- Preserve coordinates for annotation.
- Store extraction method and confidence.
- Flag uncertain extraction for human review.
- All coordinate operations must go through `src/lib/documents/coordinates.ts` (`normalizeBox`, `validateNormalizedBox`, `clampToPageBoundary`); never perform raw division without declaring the source coordinate system.
- PPTX slides must be ordered by the relationship file (`ppt/_rels/presentation.xml.rels` + `<p:sldId r:id>` order in `ppt/presentation.xml`), not by sequential filename.
- PPTX EMU coordinates from `<a:xfrm>/<a:off>/<a:ext>` must be normalized to [0,1] using slide dimensions from `<p:sldSz cx cy/>` before storing; never store raw EMU values in evidence regions.
- Do not invent coordinates for formats that do not expose them (PDF via pdf-parse is coordinates-unavailable; mark `coordinatesAvailable: false`).
- OCR decisions must go through `makeOcrDecision` in `src/lib/ocr/decision.ts`; callers must check org enablement, provider availability, external transmission consent, and page-image presence before starting OCR.
- The `OcrProvider` interface is server-only; no implementation may call a remote endpoint without explicit organization consent.
- Page quality assessment uses `assessPageQuality` / `assessExtractionQuality` from `src/lib/documents/text-quality.ts`; do not replicate the scoring heuristics inline.
- `DocumentChunk.blockIds` must trace back to `ExtractedTextBlockInfo.id` values on the source page for evidence-region placement.

## Compliance Logic

- Weightage and confidence are separate.
- Normalize compatible units safely.
- Do not compare different measurement conditions as equivalent.
- Record conditional compliance.
- `NOT_PROVEN` differs from `NOT_COMPLIED`.
- `EXCEEDS_REQUIREMENT` does not prove total compliance.
- Evaluate every independently checkable mandatory condition separately.
- Direct evidence for one condition cannot satisfy another condition.
- Derive parent finding status deterministically from effective child statuses.
- A mandatory contradiction makes the parent `NOT_COMPLIED` unless a scoped human override changes that child result.
- Mixed proven and unresolved mandatory conditions produce `PARTIALLY_COMPLIED`.
- No proven condition and no contradiction produces `NOT_PROVEN`; untrusted extraction or source location produces `NOT_VERIFIED`.
- Final acceptance remains human-controlled.

## Error Handling

- Use user-friendly messages.
- Log technical details server-side.
- Never expose stack traces.
- Provide retry paths.
- Do not hide partial failures.

## Testing

Unit:
- status rules
- scoring
- confidence
- file validation
- chunking
- unit conversion
- permissions
- Zod schemas
- annotation coordinate helpers
- condition decomposition schemas
- condition evaluation schemas
- deterministic parent finding derivation
- condition evidence ownership and link validation
- AI provider selection and consent gate
- task-to-model routing
- AI run, retrieval, comparison, and verification schemas
- unsupported citation rejection and low-confidence review flags
- provider error normalization and invalid JSON repair
- condition persistence service CRUD operations
- evaluation validation rules (status-specific required fields)
- cross-organization and cross-project link rejection
- human override protection in condition evaluations and conditions
- supersession correctness (superseded rows excluded from derivation)
- transactional persistence rollback on failure
- audit event emission with confidential-text exclusion
- ServiceResult discriminated union and typed error codes
- document processing job enqueue, claim atomicity, heartbeat, and completion
- retry backoff schedule and error classification (retryable vs. non-retryable)
- abandoned-job recovery trigger
- page/chunk atomic replacement (failure preserves previous extraction)
- extraction version lineage and idempotency
- worker batch-size limit and clean stop
- OCR-required and unsupported-file worker outcomes

Integration:
- auth bootstrap
- project CRUD
- upload
- extraction
- finding persistence
- annotation persistence (optional subsystem — not primary flow)
- report generation

E2E:
- sign in
- create project
- upload specification + proposed product documents
- process documents
- run automated review
- inspect flagged findings (exception-based — not every finding)
- approve findings
- generate compliance report export

## File Organization

- `src/app/` — routes and pages
- `src/components/` — UI
- `src/lib/ai/` — AI adapters
- `src/lib/agents/` — agent workflow
- `src/lib/documents/` — extraction and source mapping
- `src/lib/compliance/` — rules and scoring
- `src/lib/annotations/` — region and annotation logic
- `src/lib/exports/` — exports
- `src/lib/security/` — authorization and sanitization
- `src/server/jobs/` — background work
- `src/server/services/` — server-only operations
- `supabase/migrations/` — schema and RLS
- `context/` — project context
