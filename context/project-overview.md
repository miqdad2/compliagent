# CompliAgent

## Overview

CompliAgent is an automated technical compliance review system that reads specifications, standards, proposed products, calculations, test reports, and supporting documents; discovers each requirement; retrieves exact evidence; evaluates compliance; highlights missing or ambiguous information; and produces a traceable compliance assessment for human approval.

The system performs the clause-by-clause technical compliance review automatically so that engineers and reviewers do not need to manually read and cross-check every clause across multiple documents. Human attention is focused on uncertain, contradictory, missing, or low-confidence findings only.

AI findings are drafts until approved by a qualified human reviewer. Final approval remains with the responsible engineer or reviewer.

## Client Requirement

The client's primary requirement is:

> CompliAgent should perform the clause-by-clause technical compliance review automatically, so the client does not need to manually read and cross-check every clause across multiple documents.

The example annotated PDF document shared earlier was only a reference showing how the client currently performs reviews manually and what type of reasoning, evidence linking, clause mapping, missing-information analysis, and contractor-action output they expect. The annotated PDF itself is not the primary deliverable.

## Product Positioning

> CompliAgent is an automated technical compliance review system. The primary output is a clause-by-clause compliance assessment with traceable evidence. Human reviewers focus on flagged findings. Final approval remains with the responsible engineer or reviewer.

## Primary User Flow

```
Upload review documents
→ Run automated technical review
→ Inspect only flagged findings
→ Approve or correct decisions
→ Export compliance review report
```

Not:

```
Upload documents
→ manually inspect annotations
→ generate annotated PDF
```

## Core User Flow (Detailed)

1. User signs in.
2. User creates a review project.
3. User uploads:
   - Main specification
   - Proposed product or contractor submission
   - Applicable standards
   - Power-supply references
   - Calculations
   - Method statements
   - Test reports
   - Supporting correspondence
4. User assigns or confirms document roles (system may suggest).
5. The system extracts text, tables, images, page numbers, clauses, and coordinates.
6. The system discovers each requirement and decomposes each clause into independently checkable conditions.
7. Applicable standard clauses are identified.
8. Exact evidence regions are retrieved for each condition from submission-role documents.
9. Each condition is evaluated separately using deterministic checks where possible and conservative AI reasoning where needed.
10. A logically separate verifier checks citations, quotes, clauses, units, condition completeness, applicability, and unsupported claims.
11. The parent clause status is derived deterministically from verified child results.
12. The compliance matrix is generated with all findings, evidence, reasoning, and missing-information notes.
13. **The human reviewer inspects only flagged findings** (ambiguous, not proven, not complied, contradictory, low confidence, missing documentation, verifier disagreement).
14. Automatically verified findings (complied, sufficient evidence, no contradiction) are available for spot-check but do not require reviewer action.
15. The reviewer approves, edits, overrides, assigns contractor actions, and adds comments.
16. The system generates a structured compliance review report for export.

## Client Project Stages

```
1. Documents required      → Upload documents
2. Documents processing    → View processing status
3. Ready for review        → Run automated review
4. Automated review running→ View review progress
5. Human verification      → Review flagged findings
6. Ready for approval      → Approve assessment
7. Ready for report        → Generate compliance report
8. Report ready            → Download compliance report
9. Attention required      → Review flagged findings
```

## Exception-Based Review Model

### Automatically verified

Findings that require no reviewer action:
- Complied — sufficient evidence, no contradiction
- Exceeds requirement — evidence exceeds the stated condition
- Not applicable — requirement does not apply to this project

### Requires reviewer attention

Findings that must be resolved before approval:
- Not complied — direct contradiction in evidence
- Partially complied — some conditions proven, others not
- Not proven — no evidence located
- Ambiguous — evidence exists but is unclear or insufficient
- Not verified — extraction or citation failure
- Low confidence — flagged by the verifier
- Verifier disagreement — comparison and verifier differ

## Features

### Authentication and Access
- Supabase authentication
- Organization-aware profiles
- Role-based access control
- Server-side permission enforcement
- Private project isolation

### Project and Document Management
- Project CRUD and status tracking
- Mixed-file uploads
- Document role assignment
- Version history
- Private storage
- Processing status

### Document Intelligence
- Native extraction before OCR
- OCR fallback
- Clause extraction
- Table and image detection
- Page and coordinate preservation
- Source-preserving chunking
- Embeddings

### Automated Compliance Review
- Document role classifier
- Clause extractor and requirement decomposer
- Atomic condition decomposition
- Standards mapping and applicability agent
- Multi-document evidence retrieval
- Numeric and deterministic comparison
- Controlled AI interpretation where allowed
- Contradiction detection
- Missing-information analysis
- Parent-clause status derivation from child conditions
- Evidence linking and region mapping
- Draft compliance matrix generation

### Human Verification
- Exception-based review: reviewer sees only flagged findings by default
- Automatically verified findings available for spot-check
- Reviewer can approve, edit, override with reason, assign contractor action, add comments
- Provisional requirement confirmation or rejection
- Audit trail of all reviewer decisions

### Compliance Statuses
- COMPLIED
- PARTIALLY_COMPLIED
- NOT_COMPLIED
- AMBIGUOUS
- NOT_PROVEN
- EXCEEDS_REQUIREMENT
- NOT_APPLICABLE
- NOT_VERIFIED

`NOT_PROVEN` is distinct from `NOT_COMPLIED`. Missing evidence without direct contradiction produces `NOT_PROVEN`. Direct contradiction produces `NOT_COMPLIED`.

### Primary Output — Compliance Report
The primary export is a structured compliance review report containing:
- Executive summary
- Project information
- Documents reviewed
- Review methodology
- Overall compliance summary
- Clause-by-clause compliance matrix
- Items not complied
- Items not proven
- Ambiguous items
- Missing-information schedule
- Contractor-action schedule
- Standards mapping
- Reviewer decisions
- Audit trail
- Limitations and disclaimer

Supported output formats (deferred): PDF, DOCX, XLSX compliance matrix.

### Optional — Annotated Reference Copy
The annotation subsystem produces an annotated copy of source PDFs with evidence highlights, callouts, and connector lines. This is an optional export enhancement for clients who need a visual reference alongside the compliance matrix. It is:
- Not required for first client release
- Not part of the primary reviewer workflow
- Not shown as a main project stage
- Not the primary deliverable

Original source documents remain immutable. Annotations are rendered to a new private artifact.

### Reports
- Compliance report (primary — PDF, DOCX, XLSX)
- Contractor clarification schedule
- Annotated reference copy (optional, deferred)

## Scope

### In Scope
- Auth and RBAC
- Project/document management
- Mixed-file ingestion
- Source-preserving extraction
- Automated clause-by-clause compliance review
- Exception-based human verification
- Compliance matrix output
- Compliance report export
- Audit logs
- Organization security

### Out of Scope for Initial Release
- Fully autonomous engineering approval without human sign-off
- Automatic legal acceptance
- Automatic procurement decisions
- Full contractor portal
- Native annotation for every proprietary file format
- Unsourced cheaper-product recommendations
- Annotated PDF as the primary deliverable

## Success Criteria

1. Users can sign in, create projects, and upload documents.
2. Documents are stored privately and processed.
3. Extracted content preserves page, clause, and coordinate references.
4. The system discovers requirements, decomposes them into conditions, retrieves evidence, and evaluates each condition automatically.
5. Missing evidence is handled conservatively (NOT_PROVEN, never assumed compliance).
6. Human reviewers see flagged findings and can approve, edit, and override.
7. Contractor clarification output is generated.
8. A structured compliance matrix is produced with traceable evidence, reasoning, and missing-information notes.
9. A compliance report can be generated and exported after human approval.
10. RLS and server-side permissions are enforced.
11. Lint, typecheck, tests, and build pass.
