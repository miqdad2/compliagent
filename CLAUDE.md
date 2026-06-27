# CLAUDE.md

## CompliAgent — Application Building Context

Before implementing code or making any architectural decision, read these files in order:

1. `AGENTS.md` — primary project instructions and product constraints
2. `context/project-overview.md` — product definition, goals, features, scope, and success criteria
3. `context/architecture.md` — stack, system boundaries, storage model, data entities, processing pipeline, and invariants
4. `context/ui-context.md` — theme, color tokens, typography, layouts, status presentation, and component conventions
5. `context/code-standards.md` — implementation, TypeScript, Next.js, Supabase, AI, OCR, security, and testing rules
6. `context/ai-workflow-rules.md` — development workflow, scoping rules, protected files, migration rules, and verification requirements
7. `context/progress-tracker.md` — current phase, completed work, open questions, architecture decisions, and next implementation unit

## Source of Truth

When instructions conflict, follow this order:

1. `AGENTS.md`
2. `context/project-overview.md`
3. `context/architecture.md`
4. `context/code-standards.md`
5. `context/ui-context.md`
6. `context/ai-workflow-rules.md`
7. `context/progress-tracker.md`
8. The current explicit user instruction

If the user explicitly changes a requirement, update the relevant context file before or together with implementation.

## Development Rules

- Work on one small, verifiable feature unit at a time.
- Inspect the existing implementation before changing it.
- Preserve working authentication, Supabase integration, project CRUD, document upload, and storage behavior.
- Do not hardcode the active-speaker/PAVA demo into reusable product logic.
- Keep AI and OCR providers behind adapters.
- Use native extraction before OCR.
- Preserve document, page, clause, quote, table, image, and bounding-box traceability.
- Never invent clauses, pages, standards, certifications, values, evidence, or citations.
- AI findings remain drafts until approved by a qualified human reviewer.
- Original uploaded documents must never be overwritten.
- Every annotation must remain linked to a compliance finding and evidence region.
- Never rewrite an already-applied migration; create a new migration.
- Do not expose Supabase service-role credentials or other secrets to the browser.
- Enforce both RLS and server-side authorization.

## Documentation Sync

Update `context/progress-tracker.md` after every meaningful implementation change.

Update the relevant context file when implementation changes:

- product scope or user flow
- architecture or system boundaries
- database entities or storage model
- authentication or permission behavior
- document-processing workflow
- compliance decision logic
- annotation behavior
- UI conventions
- code standards
- implementation roadmap

## Before Implementing a Unit

1. Read the relevant context files.
2. Confirm the current unit from `context/progress-tracker.md`.
3. Inspect existing code and migrations.
4. Identify affected system boundaries.
5. Identify security, RLS, migration, and backward-compatibility impact.
6. Split the unit if it combines unrelated concerns.

## Before Completing a Unit

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The unit is complete only when:

1. It works end to end within its defined scope.
2. No invariant in `context/architecture.md` is violated.
3. Security and authorization checks are present.
4. Critical behavior is tested.
5. `context/progress-tracker.md` is updated.
6. All verification commands pass.
7. Limitations and unfinished items are reported clearly.
8. The next implementation unit is identified.

## Current Product Principle

CompliAgent assists technical reviewers by extracting clauses, comparing evidence, preparing compliance matrices, identifying missing information, annotating submitted documents, and generating draft reports.

Final approval remains with the responsible engineer or reviewer.
