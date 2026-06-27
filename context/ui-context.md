# UI Context

## Theme

CompliAgent uses a professional light engineering workspace. It should feel precise, trustworthy, calm, and suitable for long technical-review sessions.

It must not look like a generic AI chatbot. It should resemble a modern document review and engineering approval workspace.

## Colors

Use CSS custom properties. No hardcoded hex values in components.

| Role | Variable | Value |
| --- | --- | --- |
| Page background | `--bg-base` | `#F6F8FB` |
| Surface | `--bg-surface` | `#FFFFFF` |
| Subtle surface | `--bg-subtle` | `#F1F5F9` |
| Primary text | `--text-primary` | `#172033` |
| Secondary text | `--text-secondary` | `#475569` |
| Muted text | `--text-muted` | `#64748B` |
| Primary accent | `--accent-primary` | `#2563EB` |
| Primary hover | `--accent-primary-hover` | `#1D4ED8` |
| Border | `--border-default` | `#D9E1EA` |
| Strong border | `--border-strong` | `#B8C4D1` |
| Focus ring | `--focus-ring` | `#60A5FA` |
| Success | `--state-success` | `#15803D` |
| Success bg | `--state-success-bg` | `#DCFCE7` |
| Warning | `--state-warning` | `#B45309` |
| Warning bg | `--state-warning-bg` | `#FEF3C7` |
| Error | `--state-error` | `#B91C1C` |
| Error bg | `--state-error-bg` | `#FEE2E2` |
| Ambiguous | `--state-ambiguous` | `#7E22CE` |
| Ambiguous bg | `--state-ambiguous-bg` | `#F3E8FF` |
| Exceeds | `--state-exceeds` | `#0369A1` |
| Exceeds bg | `--state-exceeds-bg` | `#E0F2FE` |
| Neutral | `--state-neutral` | `#475569` |
| Neutral bg | `--state-neutral-bg` | `#E2E8F0` |

## Status Presentation

- COMPLIED — green
- PARTIALLY_COMPLIED — amber
- NOT_COMPLIED — red
- AMBIGUOUS — purple
- NOT_PROVEN — purple/gray
- EXCEEDS_REQUIREMENT — blue
- NOT_APPLICABLE — gray
- NOT_VERIFIED — gray with warning icon

## Typography

| Role | Font | Variable |
| --- | --- | --- |
| UI | Geist Sans | `--font-sans` |
| Technical/mono | Geist Mono | `--font-mono` |

Rules:
- Page title: `text-2xl font-semibold`
- Section title: `text-lg font-semibold`
- Card title: `text-base font-semibold`
- Body: `text-sm`
- Metadata: `text-xs text-muted`

## Radius

- Small controls: `rounded-md`
- Inputs/buttons: `rounded-lg`
- Cards/panels: `rounded-xl`
- Modals: `rounded-2xl`

## Component Library

Use shadcn/ui with Tailwind CSS and Lucide React.

## Layout Patterns

### App Shell
- Left navigation sidebar
- Top project header
- Main content area
- Full-width workspace for tables and document review

### Project Tabs
- Overview
- Documents
- Processing
- Reviews
- Compliance Matrix
- Annotations
- Reports
- Activity

### Document Review Workspace
Three-panel layout:
- Left: page/document navigator
- Center: document canvas
- Right: finding and annotation inspector

### Compliance Matrix
- Sticky header
- Search and filters
- Status/risk/confidence/document filters
- Expandable details
- Preserve clause, requirement, evidence, reasoning, reviewer state

### Annotation Workspace
- Thumbnail rail
- Large document canvas
- Annotation overlays
- Evidence highlights
- Right properties panel
- Edit, approve, reject, move, resize, delete, add manual annotation

## Tables

- Compact readable rows
- Sticky important columns
- Horizontal scroll for large matrices
- Do not hide critical text without expansion

## Icons

Use Lucide React:
- `h-4 w-4` inline
- `h-5 w-5` buttons
- `h-6 w-6` section icons

## Application Shell (Units 17E + 17F)

### Sidebar
- Client component (`"use client"`) with `usePathname` for active state
- Grouped navigation: Workspace (Dashboard, Projects), Administration (Users, Settings when isAdmin=true), Dev (flag-gated)
- Active link: `bg-primary/10 text-primary font-medium` + ChevronRight indicator
- User profile at bottom with initials avatar, display name, role label, and scoped sign-out button
- Width: `w-60` on desktop; horizontal scroll nav on mobile
- DEV section: requires `NODE_ENV !== 'production' && NEXT_PUBLIC_SHOW_DEV_TOOLS === 'true'`

### Layout
- Full-width sidebar + flex-1 main area
- Footer: subtle disclaimer note at bottom of main area
- Content padding: `px-4 py-6 sm:px-6 lg:px-8`
- Max width: `max-w-screen-2xl` on content container

### Dashboard
- Metric cards: rounded-xl border bg-white shadow-sm p-5, click-through to /projects
- Project activity: clickable rows with FolderKanban icon, status badge, time-ago string
- Archived notice: shown when archived projects exist
- Empty state: centred, dashed border icon, create-project CTA

### Project Page (Unit 17E / 17H)
- Breadcrumb: ArrowLeft + "All projects" link
- Project header: name, description, document count + pages, time-ago, contextual actions
- Workflow stepper: 5 steps (Documents → Automated review → Human verification → Approval → Compliance report), CSS-based, responsive
- Adaptive content: document register when docs exist; review summary when review exists; empty state otherwise
- ReadinessCard: spec source + "Proposed product / contractor submission", shows filename + pages + resolved status
- Document register: dual-layout (mobile stacked cards, desktop table), resolved status badges, safe error messages
- Review summary: exception-based — shows "Automatically verified" count + "Requires attention" count; "Review flagged findings" CTA when exceptions exist
- Tab "Automated review" replaces "Review"; tab "Compliance matrix" replaces "Findings"; tab "Report" replaces "Activity"

## Project-First Navigation (Unit 17F)

- **Default landing**: reviewers → `/projects`; admins → `/overview`
- **Overview** (`/overview`): organization-level metrics, visible only to `admin` / `super_admin`. Server-side guard redirects non-admins to `/projects`.
- **Dashboard** (`/dashboard`): server redirect to `/overview` for backward compatibility.
- **Reviewer sidebar**: Workspace (Projects), Account (Settings). No Overview or Users items.
- **Admin sidebar**: Workspace (Overview, Projects), Administration (Users, Settings).
- **Empty nav sections**: `NavSection` returns null when items array is empty — no orphan headings.

## Automated Review and Exception-Based UI (Unit 17H)

- **Primary action**: "Run automated review" when documents are ready; "Review flagged findings" when review exists with unresolved exceptions.
- **Workflow stepper**: Documents → Automated review → Human verification → Approval → Compliance report. "Annotation" is NOT a step.
- **Review summary**: Shows "Automatically verified" (complied/exceeds/not_applicable) count and "Requires attention" count. Reviewer sees flagged-findings CTA, not a list of all findings.
- **Status labels**: `awaiting_human_review` → "Needs your review" (not "Awaiting reviewer").
- **"Open workspace"** replaced with **"Review flagged findings"** everywhere in the client-facing UI.
- **"Annotated PDF"** replaced with **"Compliance report"** as the final output label.
- **"Annotation readiness"** is hidden from the normal client workflow; annotation routes remain available via direct URL.
- **Document assistant** is not shown on the project overview page.
- **"Submission evidence"** label → **"Proposed product / contractor submission"** in readiness cards.
- **"Controlled review"** → **"Automated review"** in user-facing labels.

## Terminology Map (client-facing)

| Old | New |
|---|---|
| Annotated PDF | Compliance report (primary); Optional annotated reference copy |
| Annotation readiness | Hidden from normal workflow |
| Final report | Compliance report |
| Open workspace | Review flagged findings |
| Controlled review | Automated review |
| Awaiting reviewer | Needs your review |
| Submission evidence | Proposed product / contractor submission |
| Start review | Run automated review |

## Upload Drawer (Unit 17F)

- `ProjectUploadButton` — client button that sets `open=true` to show the drawer.
- `UploadDrawer` — right-side drawer (420–512 px on desktop, full width on mobile) containing:
  - Drop zone: drag-and-drop + click-to-browse, keyboard accessible via role="button"
  - Hidden `<input type="file">` behind the styled drop zone
  - File preview with name, size, and clear button
  - Role selector with per-role descriptions
  - Validation: file extension + size (50 MB cap)
  - Error via `role="alert" aria-live="assertive"`
  - Success via `role="status" aria-live="polite"`
  - Calls existing `/api/documents/upload` endpoint — no backend duplication
- `Drawer` component: fixed overlay, Escape key, body-scroll lock, focus management.

## Project Workspace Tabs (Unit 17F)

Tabs live in the project page URL as `?tab=<name>`:
- `overview` — readiness cards + latest review summary
- `documents` — document register + upload button
- `review` — start review + review summary + legacy run button
- `findings` — compliance matrix or empty state
- `activity` — placeholder for future audit log

## Interaction Rules

- Show loading for processing and AI actions.
- Show meaningful empty states.
- Confirm destructive actions.
- Long jobs show stage and progress.
- Reviewer overrides are visually distinct.
- Draft AI output is clearly labelled.
- Approved output shows reviewer and timestamp.

## Accessibility

- Keyboard-accessible controls
- Visible focus states
- Semantic labels
- Sufficient contrast
- Status uses text and icon, not color alone
