# AGENTS.md

# CompliAgent — Agentic AI Technical Compliance Review System

CompliAgent is a production-ready Agentic AI platform for technical document review, compliance comparison, clause extraction, evidence-backed reasoning, and report generation.

The system helps engineers, consultants, reviewers, contractors, and technical teams review complex documents such as specifications, standards, datasheets, drawings, certificates, manuals, product submittals, and contractor submissions.

The uploaded speaker/PAVA documents are only demo documents. The system must not be hardcoded for that use case. CompliAgent must be built as a reusable technical compliance review platform for many disciplines.

---

## 1. Product Name

Product name: **CompliAgent**

Full title: **CompliAgent — AI Technical Compliance Review System**

Folder name: `compliagent`

App title: `CompliAgent`

Database project name: `compliagent`

---

## 2. Core Product Goal

Build a web application where users can:

1. Create a technical review project.
2. Upload multiple documents in mixed formats.
3. Assign each document a role.
4. Extract clauses, sub-clauses, technical requirements, tables, drawings, values, standards, and evidence.
5. Compare requirement documents against submission documents.
6. Compare proposed products against specifications and reference standards.
7. Mark every item as:
   - Complied
   - Partially Complied
   - Not Complied
   - Ambiguous / Not Proven
   - Not Applicable
8. Provide exact source references:
   - Document name
   - Page number
   - Clause number
   - Sub-clause number
   - Evidence quote
9. Generate contractor clarification points.
10. Assign weightage from 1–10 for partially complied or ambiguous items.
11. Assign confidence score from 0–100.
12. Generate final recommendation:
   - Technically Accepted
   - Accepted with Conditions
   - Rejected / Not Technically Accepted
13. Export reports as:
   - Excel compliance matrix
   - Word report
   - PDF report
   - Chat summary
14. Allow human reviewer approval before final issue.
15. Allow users to chat with project documents after processing.

---

## 3. Important Product Principle

This system must assist technical reviewers. It must not replace engineers.

Always position the product like this:

> CompliAgent assists technical reviewers by extracting clauses, comparing evidence, preparing compliance matrices, identifying missing information, and generating draft reports. Final approval remains with the responsible engineer or reviewer.

Because the documents may be related to engineering, government, construction, tender, fire safety, life safety, or contractual approvals, the AI must be conservative.

The AI must not invent anything.

When evidence is missing, unclear, indirect, or not directly comparable, the system must return:

- Not Found
- Ambiguous
- Not Proven
- Requires Contractor Clarification
- Requires Human Review

---

## 4. Supported Review Types

CompliAgent must be generic and reusable.

Supported review examples:

- PAVA / PAS systems
- Voice alarm systems
- Fire alarm systems
- ELV systems
- CCTV systems
- Access control systems
- ICT / network equipment
- Electrical systems
- Mechanical systems
- Civil material submittals
- Architectural material reviews
- Product datasheet reviews
- Method statement reviews
- Authority compliance reviews
- Contractor technical submission reviews
- Tender specification compliance reviews
- Standards compliance reviews

Do not hardcode the system only for active speakers, PAVA, or one demo document.

---

## 5. Recommended Technology Stack

Use this stack unless the project owner changes it.

### Frontend

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide React icons
- React Hook Form
- Zod validation

### Backend

- Next.js API routes
- Next.js server actions where suitable
- Node.js
- Background jobs for long-running processing

### Database

- Supabase Postgres
- Supabase Auth
- Supabase Storage
- Supabase pgvector

### AI Layer

- Provider-agnostic AI abstraction
- Support multiple AI providers:
  - OpenAI
  - Anthropic
  - Gemini
  - Mistral
  - OpenRouter
- Do not hardcode one AI provider into business logic.
- All AI outputs must use structured JSON.
- All AI outputs must be validated with Zod.

### Document Processing

Support:

- PDF
- Scanned PDF
- DOCX
- PPTX
- XLSX
- Images
- Drawings
- Tables
- Technical diagrams
- Certificates
- Product datasheets

Suggested libraries/services:

- PDF parsing: `pdf-parse`, `unpdf`, or equivalent
- DOCX parsing: `mammoth`
- XLSX parsing: `xlsx` or `exceljs`
- PPTX parsing: suitable PPTX extraction pipeline
- OCR: pluggable adapter for Azure Document Intelligence, Google Document AI, Mistral OCR, or Tesseract fallback
- Word export: `docx`
- Excel export: `exceljs`
- PDF export: suitable server-side PDF generation library

### Deployment

- Vercel for main web app
- Supabase for database and storage
- Separate worker service for heavy OCR/document processing if Vercel timeout becomes a limitation

---

## 6. Development Commands

Use `pnpm`.

```bash
pnpm install
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Before completing any task, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

For production readiness, also run:

```bash
pnpm build
```

If any command fails, fix the issue before marking the task complete.

---

## 7. Environment Variables

Create `.env.example` and keep it updated.

```env
NEXT_PUBLIC_APP_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

DATABASE_URL=

AI_PROVIDER=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
MISTRAL_API_KEY=
OPENROUTER_API_KEY=
OPENROUTER_MODEL=

OCR_PROVIDER=
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=
AZURE_DOCUMENT_INTELLIGENCE_KEY=
GOOGLE_DOCUMENT_AI_PROJECT_ID=
GOOGLE_DOCUMENT_AI_LOCATION=
GOOGLE_DOCUMENT_AI_PROCESSOR_ID=

SUPABASE_STORAGE_BUCKET_DOCUMENTS=
SUPABASE_STORAGE_BUCKET_EXPORTS=

CRON_SECRET=
ENCRYPTION_KEY=
IP_HASH_SALT=
```

Rules:

- Never commit `.env`.
- Never expose service role keys to the browser.
- Never log secrets.
- All secret access must stay server-side.
- Keep `.env.example` updated whenever a new variable is added.

---

## 8. Project Folder Structure

Use this structure:

```txt
src/
  app/
    (auth)/
    (dashboard)/
    api/
  components/
    ui/
    forms/
    documents/
    compliance/
    reports/
    projects/
    layout/
  lib/
    ai/
    agents/
    compliance/
    db/
    documents/
    embeddings/
    exports/
    ocr/
    permissions/
    prompts/
    queues/
    reports/
    security/
    supabase/
    utils/
  server/
    actions/
    jobs/
    services/
  types/
  tests/
supabase/
  migrations/
  seed.sql
docs/
  architecture.md
  compliance-methodology.md
  security.md
  prompt-library.md
  user-flow.md
```

Rules:

- Do not create random folders.
- Keep architecture clean.
- Keep reusable logic inside `src/lib`.
- Keep server-only logic away from client components.
- Keep UI components reusable and clean.

---

## 9. User Roles

Implement role-based access control.

### Super Admin

Can:

- Manage all organizations
- Manage all users
- Manage all projects
- Access system settings

### Admin

Can:

- Manage organization users
- Create projects
- Upload documents
- Run AI reviews
- Export reports
- Manage organization settings

### Engineer / Reviewer

Can:

- Create projects
- Upload documents
- Run AI reviews
- Review findings
- Edit AI findings
- Add human comments
- Approve or reject findings
- Export reports

### Viewer

Can:

- View projects
- View reports
- View compliance matrix
- Cannot modify anything

### Contractor / External User

Optional later phase.

Can:

- View clarification requests
- Upload revised submissions
- Respond to contractor actions

All permission checks must happen server-side.

Never rely only on frontend permission checks.

---

## 10. Main Application Modules

### 10.1 Authentication

Use Supabase Auth.

Initial features:

- Email login
- Password login
- Optional magic link later
- User profile creation
- Organization assignment
- Role assignment

### 10.2 Dashboard

Dashboard must show:

- Total projects
- Recent projects
- Pending reviews
- Completed reports
- Documents processing status
- AI review status
- Human review pending count
- Recent exports

### 10.3 Project Management

Each project must include:

- Project name
- Client name
- Discipline
- Review type
- Description
- Status
- Created by
- Organization
- Created date
- Updated date

Project statuses:

- Draft
- Documents Uploaded
- Processing
- Ready for Review
- AI Review Running
- AI Review Completed
- Human Review Pending
- Approved
- Rejected
- Archived

### 10.4 Document Upload

Support:

- Drag-and-drop upload
- Multiple files
- Large file support
- File type validation
- File size validation
- Upload progress
- Upload error handling
- Processing status

Supported document roles:

- Main Specification
- Reference Standard
- Proposed Product / Contractor Submission
- Product Datasheet
- Certificate
- Drawing
- Manual
- Compliance Statement
- Supporting Evidence
- Other

Each document must store:

- File name
- File type
- File size
- MIME type
- Storage path
- Document role
- Version
- Page count
- Processing status
- OCR required
- Uploaded by
- Uploaded date

### 10.5 Document Processing

For every uploaded document:

1. Detect file type.
2. Extract text.
3. Detect if OCR is needed.
4. Extract tables where possible.
5. Extract images/diagrams where possible.
6. Preserve page numbers.
7. Preserve clause numbers.
8. Preserve section headings.
9. Chunk text safely.
10. Generate embeddings.
11. Store extracted chunks and metadata.
12. Mark document processing status.

Every extracted chunk must include:

- `document_id`
- `project_id`
- `page_number`
- `section_heading`
- `clause_number`
- `raw_text`
- `normalized_text`
- `chunk_index`
- `token_count`
- `extraction_method`
- `confidence`

Never lose source traceability.

---

## 11. Database Model

Use Supabase migrations.

### organizations

- id
- name
- created_at
- updated_at

### profiles

- id
- user_id
- organization_id
- full_name
- role
- created_at
- updated_at

### projects

- id
- organization_id
- name
- client_name
- discipline
- review_type
- description
- status
- created_by
- created_at
- updated_at

### documents

- id
- project_id
- organization_id
- file_name
- storage_path
- mime_type
- file_size
- document_role
- version
- page_count
- processing_status
- ocr_required
- created_by
- created_at
- updated_at

### document_pages

- id
- document_id
- project_id
- page_number
- extracted_text
- extraction_method
- confidence
- image_path
- created_at

### document_chunks

- id
- document_id
- project_id
- page_number
- clause_number
- section_heading
- chunk_text
- normalized_text
- embedding
- metadata
- created_at

### extracted_requirements

- id
- project_id
- source_document_id
- page_number
- clause_number
- sub_clause_number
- requirement_text
- requirement_type
- discipline
- mandatory_level
- numeric_value
- unit
- standard_reference
- acceptance_criteria
- extraction_confidence
- created_at

### extracted_evidence

- id
- project_id
- source_document_id
- page_number
- clause_number
- evidence_text
- evidence_type
- product_model
- manufacturer
- numeric_value
- unit
- standard_reference
- extraction_confidence
- created_at

### compliance_reviews

- id
- project_id
- title
- review_scope
- status
- ai_model
- created_by
- created_at
- updated_at

### compliance_findings

- id
- review_id
- project_id
- requirement_id
- evidence_id
- clause_number
- sub_clause_number
- requirement_text
- evidence_text
- status
- weightage_score
- confidence_score
- reasoning
- missing_information
- contractor_action
- risk_level
- human_override_status
- human_comment
- reviewed_by
- reviewed_at
- created_at
- updated_at

### contractor_clarifications

- id
- review_id
- project_id
- finding_id
- clause_number
- issue
- why_it_matters
- required_action
- required_document
- priority
- status
- created_at
- updated_at

### report_exports

- id
- project_id
- review_id
- export_type
- storage_path
- generated_by
- created_at

### audit_logs

- id
- organization_id
- project_id
- user_id
- action
- entity_type
- entity_id
- metadata
- created_at

---

## 12. Row Level Security

All tables must enforce organization-based isolation.

Rules:

- Users can access only their organization data.
- Viewers cannot modify data.
- Engineers can create projects, upload documents, and run reviews.
- Reviewers can edit and approve findings.
- Admins can manage organization users and projects.
- Super Admins can manage all data.

Never rely only on frontend checks.

All mutations must validate:

- User is authenticated.
- User belongs to the organization.
- User has required role.
- User has access to the project.

---

## 13. Supabase Storage Structure

Use private buckets only.

Storage path pattern:

```txt
organizations/{organizationId}/projects/{projectId}/documents/{documentId}/original/{filename}
organizations/{organizationId}/projects/{projectId}/documents/{documentId}/pages/page-{pageNumber}.png
organizations/{organizationId}/projects/{projectId}/reports/{reviewId}/{filename}
```

Rules:

- Never use public buckets for confidential documents.
- Use signed URLs.
- Sanitize file names.
- Validate file extensions and MIME types.
- Do not expose internal storage paths to unauthorized users.

---

## 14. Compliance Status Rules

Use these statuses.

### Complied

Use only when the submitted evidence directly satisfies the requirement.

### Partially Complied

Use when:

- Evidence exists but is incomplete.
- Values partially meet the requirement.
- Configuration is possible but not confirmed.
- Certificate is missing.
- Calculation is missing.
- Installation condition affects compliance.
- Requirement depends on contractor confirmation.

### Not Complied

Use when:

- Evidence directly contradicts the requirement.
- Proposed value is below required threshold.
- Mandatory feature is absent.
- Required certification is not present and cannot be inferred.
- Product does not meet stated requirement.

### Ambiguous / Not Proven

Use when:

- Evidence is missing.
- Document wording is unclear.
- Measurement conditions differ.
- Units differ and cannot be safely converted.
- AI cannot compare safely.
- Human engineering calculation is required.

### Not Applicable

Use only when the clause genuinely does not apply to the review scope.

---

## 15. Weightage Scoring Rules

Weightage applies mainly to partially complied or ambiguous items.

Use 1–10:

- 10 = fully proven compliance
- 8–9 = mostly compliant, minor missing confirmation
- 6–7 = partially compliant, important detail missing
- 4–5 = uncertain or weak evidence
- 2–3 = major missing evidence or likely non-compliance
- 1 = least complied
- 0 = clearly not complied

Rules:

- Do not assign high scores without evidence.
- Every score must include reasoning.
- Critical life-safety missing evidence should not receive high scores.
- If confidence is low, keep score conservative.

---

## 16. Confidence Score Rules

Confidence is separate from weightage.

Use 0–100:

- 90–100 = direct clause and direct matching evidence
- 70–89 = strong evidence but some interpretation needed
- 50–69 = partial evidence or indirect evidence
- 30–49 = weak evidence
- 0–29 = insufficient evidence

If confidence is below 70, mark for human review.

---

## 17. Mandatory Evidence Rules

Every compliance finding must include:

- Requirement document name
- Requirement page number
- Requirement clause number
- Requirement text
- Evidence document name
- Evidence page number
- Evidence text
- Compliance status
- Reasoning
- Missing information if any
- Contractor action if any
- Weightage score
- Confidence score
- Human review flag

If any required source reference is missing, the finding must be marked:

```txt
Not Verified
```

Never invent:

- Page numbers
- Clause numbers
- Standards
- Certifications
- Values
- Product features
- Compliance status

---

## 18. Source Citation Format

Every finding must use this structure:

```txt
Requirement Source:
Document: [document name]
Page: [page number]
Clause: [clause/sub-clause]
Quote: "[short quote]"

Evidence Source:
Document: [document name]
Page: [page number]
Clause/Table/Figure: [if available]
Quote: "[short quote]"
```

Do not say “the document says” without source evidence.

---

## 19. Agentic AI Workflow

Implement the system as a controlled deterministic workflow with specialized agents.

Do not build uncontrolled autonomous agents.

### 19.1 Document Classifier Agent

Purpose:

- Identify document type.
- Suggest document role.
- Detect language.
- Detect whether OCR is needed.
- Detect whether document contains tables, diagrams, images, drawings, certificates, or product datasheets.

Output:

- document_role_suggestion
- document_type
- language
- ocr_required
- contains_tables
- contains_drawings
- contains_certificates
- confidence

### 19.2 Clause Extraction Agent

Purpose:

- Extract clauses and sub-clauses from specification and standard documents.

Extract:

- Clause number
- Sub-clause number
- Heading
- Requirement text
- Mandatory words
- Numeric values
- Units
- Certification requirements
- Standards references
- Acceptance criteria
- Page number

Mandatory words include:

- shall
- must
- should
- required
- to be provided
- comply
- in accordance with

### 19.3 Technical Data Extraction Agent

Purpose:

Extract technical evidence from proposed product documents.

Extract:

- Product name
- Model
- Manufacturer
- Technical specifications
- Electrical specifications
- Mechanical specifications
- Acoustic specifications
- Environmental ratings
- Certificates
- Standards
- Diagrams
- Tables
- Mounting requirements
- Software features
- Monitoring features
- Power supply details
- Warranty
- Accessories
- Limitations

### 19.4 Standards Applicability Agent

Purpose:

- Identify which clauses from reference standards apply to the product/system type.

Rules:

- Do not compare every standard clause blindly.
- First determine applicability.
- Explain why each clause is applicable or not applicable.
- Always cite standard clause and page.
- Mark irrelevant clauses as Not Applicable only with reasoning.

### 19.5 Compliance Comparison Agent

Purpose:

Compare each extracted requirement against submitted evidence.

For each requirement:

- Find matching evidence.
- Compare values.
- Compare units.
- Compare standards.
- Compare certifications.
- Compare functional requirements.
- Compare technical requirements.
- Compare power requirements.
- Compare monitoring requirements.
- Compare redundancy requirements.
- Compare environmental requirements.
- Assign status.
- Assign score.
- Assign confidence.
- Give reasoning.
- Give missing information.
- Give contractor action.

### 19.6 Missing Information Agent

Purpose:

Generate contractor clarification points.

Each missing information item must include:

- Related clause
- Missing detail
- Reason it is needed
- Required contractor action
- Required document or evidence
- Priority

Priority values:

- Critical
- High
- Medium
- Low

### 19.7 Reviewer Agent

Purpose:

Verify the AI output before showing final results.

Checks:

- Does every finding have source evidence?
- Is every page number present?
- Is every clause number present where available?
- Is reasoning supported by evidence?
- Are there unsupported assumptions?
- Are numerical comparisons valid?
- Are units compatible?
- Are standards invented?
- Are certifications invented?
- Is the conclusion conservative?

If reviewer agent fails, return finding for correction.

### 19.8 Report Agent

Purpose:

Generate final outputs:

- Chat summary
- Excel compliance matrix
- Word report
- PDF report

Reports must include:

- Executive summary
- Document list
- Review scope
- Methodology
- Summary dashboard
- Detailed compliance matrix
- Partially complied items
- Not complied items
- Ambiguous / not proven items
- Contractor clarification list
- Final AI recommendation
- Human reviewer approval section
- Disclaimer

---

## 20. Prompt Files

Create prompt templates in:

```txt
src/lib/prompts/
```

Required prompt files:

```txt
document-classifier.ts
clause-extractor.ts
technical-data-extractor.ts
standards-applicability.ts
compliance-comparison.ts
missing-info.ts
reviewer-check.ts
report-summary.ts
project-chat.ts
```

Each prompt must include:

- Task
- Context
- Input schema
- Output schema
- Citation rules
- No hallucination rules
- Conservative decision rules
- Human review rules

---

## 21. AI Output Validation

All AI outputs must be structured JSON.

Use Zod schemas for:

- Document classification
- Requirement extraction
- Evidence extraction
- Standards applicability
- Compliance finding
- Contractor clarification
- Report summary
- Chat answer

If validation fails:

1. Retry once with a repair prompt.
2. If it fails again, mark job as failed.
3. Show a user-friendly error.

Do not silently ignore AI failures.

---

## 22. No Hallucination Rules

The AI must not:

- Invent clauses
- Invent page numbers
- Invent standards
- Invent certifications
- Invent product features
- Guess missing values
- Convert values without clear basis
- Claim compliance without evidence
- Ignore contradictory evidence
- Hide uncertainty
- Produce unsupported final conclusions

When unsure, return:

- Ambiguous
- Not Found
- Not Proven
- Requires Human Review

---

## 23. Numerical Comparison Rules

When comparing numbers:

1. Normalize units only when safe.
2. Confirm measurement conditions.
3. Compare like-for-like only.
4. If measurement distance differs, mark ambiguous unless a reliable calculation method is implemented.
5. If frequency range, SPL, voltage, current, wattage, battery time, IP rating, temperature, dimensions, or other values differ, explain clearly.
6. Do not perform complex engineering conversions without reliable evidence.
7. Flag calculations for human review.

Examples:

- Required SPL at 1 m vs proposed SPL at 25 m = Ambiguous unless calculation evidence is provided.
- Required frequency range 60 Hz–17 kHz vs proposed 70 Hz–18 kHz = Partially Complied because low frequency does not meet 60 Hz.
- Required IP54 and proposed datasheet says IP54 only with accessory/closure cap = Partially Complied until installation condition is confirmed.

---

## 24. Final Decision Logic

The AI may suggest a final decision but must not issue final approval without human review.

### Technically Accepted

Use only if:

- All critical mandatory requirements are complied.
- Required standards and certificates are proven.
- No unresolved life-safety or major technical issue remains.
- Human reviewer approves.

### Accepted with Conditions

Use when:

- Product appears technically suitable.
- Some non-critical evidence is missing.
- Clarifications, calculations, certificates, or drawings are required.
- Missing items can reasonably be resolved before final approval.

### Rejected / Not Technically Accepted

Use when:

- Mandatory requirement is clearly not met.
- Critical certification is missing for life-safety use.
- Product contradicts the specification.
- Power, safety, monitoring, redundancy, or performance requirements are not satisfied.
- Major unresolved ambiguity remains.

For life-safety systems, be conservative.

---

## 25. Contractor Clarification Output

Generate a contractor clarification list.

Each item must include:

- Item number
- Related clause
- Issue
- Why it matters
- Required contractor response
- Required document/evidence
- Priority

Example:

```txt
1. Clause 2.2.1 B.3(a) — SPL Performance
Issue: Proposed datasheet provides SPL at a different measurement distance.
Why It Matters: Compliance cannot be confirmed unless the value is proven under the required condition.
Required Action: Provide manufacturer SPL data at the specified distance or acoustic calculation signed by competent party.
Required Evidence: Manufacturer datasheet, acoustic calculation, or consultant report.
Priority: High
```

---

## 26. Human Review Workflow

AI findings are drafts.

Each finding must have:

- AI status
- AI reasoning
- AI confidence
- Human status
- Human comment
- Reviewer name
- Reviewed date

Human status values:

- Accepted
- Modified
- Rejected
- Needs More Information

Final report cannot be marked approved until human review is complete.

---

## 27. Chat With Documents

After a review, user can ask:

- Why is this clause partially complied?
- Show only non-complied items.
- Show only ambiguous items.
- Show missing certificates.
- Prepare contractor clarification letter.
- Compare revised submission with previous version.
- Generate final review report.
- Export compliance matrix.
- What is the highest risk issue?
- Which clauses require human review?
- Summarize the document.
- Find all clauses related to power supply.
- Find all clauses related to certification.

Chat answers must use retrieved evidence from uploaded documents.

Never answer technical document questions from general knowledge when uploaded documents are required.

Every answer must include source references.

---

## 28. Report Export Requirements

### Excel Matrix

Generate columns:

- Item No.
- Source Document
- Page
- Clause
- Sub-Clause
- Requirement
- Proposed Evidence
- Evidence Source
- Compliance Status
- Weightage /10
- Confidence %
- Risk Level
- Reasoning
- Missing Information
- Contractor Action
- Human Reviewer Comment
- Final Human Status

### Word Report

Include:

1. Cover page
2. Executive summary
3. Scope of review
4. Uploaded documents
5. Methodology
6. Summary dashboard
7. Detailed compliance matrix
8. Partially complied items
9. Not complied items
10. Ambiguous / not proven items
11. Contractor clarification list
12. Final AI recommendation
13. Human reviewer approval section
14. Disclaimer

### PDF Report

PDF should match the Word report content.

### Chat Summary

Keep it concise:

- Overall recommendation
- Key complied areas
- Key partially complied areas
- Key not complied areas
- Missing information
- Next action

---

## 29. UI Requirements

Design must be clean, professional, and engineering-focused.

Use:

- Light neutral background
- Clear tables
- Status badges
- Filters
- Search
- Export buttons
- Review workflow indicators
- Professional typography
- Minimal but polished layout

Main pages:

1. Login
2. Dashboard
3. Projects list
4. Project details
5. Upload documents
6. Document processing status
7. AI review setup
8. Compliance matrix
9. Finding details
10. Chat with project documents
11. Report exports
12. Settings
13. User management

### Compliance Matrix UI

Must support:

- Filter by status
- Filter by document
- Filter by risk
- Filter by confidence
- Search by clause
- Search by requirement
- Edit human comments
- Override AI status
- Approve finding
- Export selected rows

Status badge colors:

- Complied: green
- Partially Complied: amber
- Not Complied: red
- Ambiguous / Not Proven: purple or gray
- Not Applicable: gray

---

## 30. Background Job Pipeline

Document processing and review generation must run as background jobs.

Job statuses:

- queued
- running
- completed
- failed
- cancelled

Job types:

- document_extraction
- ocr
- table_extraction
- embedding_generation
- requirement_extraction
- evidence_extraction
- standards_applicability
- compliance_review
- reviewer_check
- report_generation

Show progress in UI.

Do not block the frontend while long jobs run.

---

## 31. Security Requirements

Documents may be confidential.

Implement:

- Supabase Row Level Security
- Organization-based data isolation
- Private storage buckets
- Signed URLs
- Server-side permission checks
- Audit logs
- File validation
- File name sanitization
- Project archive
- Project deletion
- Document deletion
- No full document text in production logs
- No secrets in logs
- No public file links
- No training on client documents
- AI provider transparency in settings

Do not send files to AI providers unless the user/organization has configured and accepted that AI provider usage.

---

## 32. Audit Logging

Log:

- User login
- Project created
- Project updated
- Project archived
- Document uploaded
- Document deleted
- Document processed
- AI review started
- AI review completed
- Finding edited
- Status overridden
- Human review completed
- Report exported
- Final decision approved

Audit logs must include:

- user_id
- organization_id
- project_id
- action
- entity_type
- entity_id
- timestamp
- metadata

---

## 33. Error Handling

Use clear user-friendly errors.

Examples:

```txt
Document uploaded successfully, but OCR failed. Please retry processing.
AI review could not be completed because no requirement document was selected.
The report could not be exported because some findings are not verified.
This file type is not supported yet.
```

Rules:

- Log technical errors server-side.
- Do not expose stack traces.
- Do not hide failures.
- Show retry options where possible.

---

## 34. Testing Requirements

Write tests for important logic.

### Unit Tests

Test:

- Clause extraction helpers
- Unit conversion helpers
- Compliance status rules
- Weightage scoring
- Confidence scoring
- Permission checks
- File validation
- Zod schema validation

### Integration Tests

Test:

- Upload document
- Process document
- Extract requirements
- Extract evidence
- Generate compliance review
- Export report

### E2E Tests

Test:

- User creates project
- User uploads documents
- User runs AI review
- User filters compliance matrix
- User edits human comment
- User exports report

Use small sample fixtures.

---

## 35. Code Style

Use:

- TypeScript everywhere
- Explicit types
- Zod validation
- Small functions
- Clear naming
- Server/client boundaries properly
- Named exports
- Async/await
- Modular services

Avoid:

- `any` unless justified
- Hardcoded secrets
- Hardcoded demo data
- Duplicated logic
- Console logs in production
- Unvalidated AI responses
- Unprotected API routes
- Overly complex abstractions

Readable code is more important than clever code.

---

## 36. API Design

Use REST-style API routes or server actions consistently.

Suggested API routes:

```txt
/api/projects
/api/projects/[projectId]
/api/documents/upload
/api/documents/[documentId]
/api/documents/[documentId]/process
/api/reviews
/api/reviews/[reviewId]
/api/reviews/[reviewId]/run
/api/reviews/[reviewId]/findings
/api/reports/[reviewId]/export
/api/chat/project
```

All APIs must:

- Authenticate user
- Check organization access
- Validate input
- Return typed responses
- Handle errors safely

---

## 37. Phase 1 Scope

Build Phase 1 first.

Phase 1 must include:

- Authentication
- Dashboard
- Project creation
- Document upload
- Document role assignment
- Basic PDF extraction
- Basic DOCX extraction
- Basic XLSX extraction
- OCR-ready architecture
- Chunking with page references
- Requirement extraction
- Evidence extraction
- Compliance matrix generation
- Source references
- Human review fields
- Contractor clarification list
- Excel export
- Word or PDF export
- Basic project chat

---

## 38. Phase 2 Scope

Phase 2 includes:

- Advanced OCR
- Table extraction
- Diagram/image extraction
- PPTX support
- Version comparison
- Contractor clarification letter
- Reviewer approval workflow
- Multi-user collaboration
- Report templates
- Better document viewer
- Side-by-side evidence viewer

---

## 39. Phase 3 Scope

Phase 3 includes:

- Domain templates
- Reusable review checklists
- Standard library
- Contractor portal
- Organization knowledge base
- Advanced analytics
- Cost-effective alternative suggestions
- Project comparison across previous reviews

---

## 40. Domain Template System

The platform must support domain-specific templates later.

Examples:

- PAVA / PAS review
- Fire alarm review
- CCTV review
- Access control review
- Network equipment review
- Electrical equipment review
- Mechanical equipment review
- Civil material review

Each template can define:

- Required document roles
- Common standards
- Required output format
- Mandatory clauses
- Scoring logic
- Report sections
- Checklist fields

Do not hardcode only one review type.

---

## 41. Cost-Effective Alternative Logic

The system may suggest that a more cost-effective product could be considered only when:

- Proposed product significantly exceeds requirements
- All mandatory safety and compliance requirements can still be met
- Required performance targets are known
- Required certification is known
- Human reviewer confirms alternative search is allowed

The system must not recommend a cheaper model without evidence.

Use wording:

```txt
A more cost-effective model may be considered only after confirming required performance, certification, acoustic coverage, redundancy, and compliance obligations.
```

---

## 42. Product Disclaimer

Include this disclaimer in reports:

```txt
This report was generated with AI assistance based on the uploaded documents and extracted evidence. The AI output is intended to support technical review and does not replace professional engineering judgment. All findings, interpretations, compliance statuses, and recommendations must be reviewed and approved by a qualified human reviewer before formal submission or acceptance.
```

---

## 43. Acceptance Criteria for Codex Tasks

A task is complete only when:

- Code compiles
- TypeScript passes
- Lint passes
- Tests pass
- UI is usable
- Error states are handled
- Loading states are handled
- Empty states are handled
- Permissions are checked server-side
- No secrets are exposed
- AI outputs are schema-validated
- Source references are preserved
- Documentation is updated if architecture changes

---

## 44. Implementation Order

Build in this order:

1. Project setup
2. Supabase setup
3. Auth
4. Dashboard layout
5. Project CRUD
6. Document upload
7. Document role assignment
8. Storage integration
9. Document processing pipeline
10. Text extraction
11. Chunking and source references
12. Embeddings
13. Requirement extraction agent
14. Evidence extraction agent
15. Standards applicability agent
16. Compliance comparison agent
17. Reviewer validation agent
18. Compliance matrix UI
19. Human review editing
20. Contractor clarification list
21. Excel export
22. Word/PDF export
23. Project chat
24. Audit logs
25. Security hardening
26. Production deployment

Do not start with advanced UI before the data model and processing pipeline are stable.

---

## 45. Definition of Done

The application is production-ready when:

- A user can create a project.
- A user can upload multiple documents.
- Documents are processed and indexed.
- Requirements are extracted with clauses and page numbers.
- Evidence is extracted from submitted documents.
- AI generates a compliance matrix.
- Every finding has source-backed evidence.
- Weak items receive weightage scores.
- Ambiguous items are flagged.
- Contractor clarification list is generated.
- Human reviewer can edit and approve findings.
- Final recommendation is generated.
- Excel export works.
- Word/PDF export works.
- Access control is enforced.
- Audit logs are created.
- Tests pass.
- Build succeeds.
- No secrets are leaked.
- The system is not hardcoded for one demo document.

---

## 46. Codex Behavior Instructions

When working on this repository:

1. Read this file before making changes.
2. Preserve the product goal.
3. Do not remove source traceability.
4. Do not simplify away human review.
5. Do not hardcode the demo speaker documents.
6. Build reusable generic compliance-review logic.
7. Prefer safe, conservative AI behavior.
8. Use schema validation for AI outputs.
9. Keep UI professional and clean.
10. Keep code modular and maintainable.
11. Add tests for critical logic.
12. Run lint, typecheck, tests, and build before final response.
13. Explain what changed and what commands were run.
14. Mention limitations or unfinished items clearly.

---

## 47. First Codex Task Prompt

Use this prompt after adding this file:

```txt
Read AGENTS.md fully. Then initialize the project architecture for CompliAgent using Next.js, TypeScript, Tailwind CSS, shadcn/ui, Supabase, and a modular AI agent pipeline.

Start with:
1. Clean project structure
2. Supabase database schema and migrations
3. Auth-ready layout
4. Dashboard shell
5. Project CRUD
6. Document upload model
7. Document role assignment
8. Placeholder document processing pipeline
9. Placeholder AI agent interfaces
10. Compliance status and scoring logic

Do not hardcode the speaker demo. Build this as a reusable technical compliance review platform for many document review use cases.

Before finishing, run lint, typecheck, tests if available, and build if the project is ready.
```

---

## 48. Second Codex Task Prompt

After the first setup is complete, use this:

```txt
Continue building CompliAgent. Implement the document processing foundation.

Build:
1. File upload UI
2. Supabase Storage integration
3. Document metadata table usage
4. Basic PDF text extraction
5. Basic DOCX extraction
6. Basic XLSX extraction
7. Chunking system with page number and clause metadata
8. Processing status UI
9. Error handling
10. Tests for file validation and chunking

Keep source traceability as the main priority. Every chunk must preserve document ID, page number, section heading if available, clause number if available, and extraction method.
```

---

## 49. Third Codex Task Prompt

After document processing is working, use this:

```txt
Continue building CompliAgent. Implement the first version of the AI review pipeline.

Build:
1. Requirement extraction agent interface
2. Evidence extraction agent interface
3. Standards applicability agent interface
4. Compliance comparison agent interface
5. Reviewer validation agent interface
6. Zod schemas for all AI outputs
7. Compliance finding database integration
8. Compliance matrix UI
9. Filtering by status, risk, confidence, and document
10. Contractor clarification list generation

All AI outputs must be structured JSON and schema-validated. If evidence is missing, mark the finding as Ambiguous / Not Proven. Do not invent clauses, values, or certifications.
```

---

## 50. Fourth Codex Task Prompt

After the compliance matrix is working, use this:

```txt
Continue building CompliAgent. Implement human review and report exports.

Build:
1. Human reviewer fields for each finding
2. Ability to edit human comments
3. Ability to override AI status
4. Human review status workflow
5. Excel compliance matrix export
6. Word report export
7. PDF report export
8. Report export history
9. Final AI recommendation section
10. Disclaimer section

Final approval must remain human-controlled. The report must clearly state that AI output is for technical review support and must be approved by a qualified reviewer.
```
