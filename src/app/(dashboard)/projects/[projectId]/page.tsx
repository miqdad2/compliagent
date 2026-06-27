import { notFound } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink,
  FileText, RefreshCw
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ComplianceMatrix, type ComplianceMatrixRow } from "@/components/compliance/compliance-matrix";
import { DocumentProcessButton } from "@/components/documents/document-process-button";
import { documentRoleLabels } from "@/lib/documents/roles";
import { WorkflowStepper, type WorkflowStep } from "@/components/projects/workflow-stepper";
import { ProjectUploadButton } from "@/components/documents/project-upload-button";
import { RunReviewButton } from "@/components/projects/run-review-button";
import {
  resolveDocumentStatus,
  isSpecificationRole,
  isSubmissionRole,
  RESOLVED_STATUS_LABEL,
  RESOLVED_STATUS_TONE,
  getActionLabel,
  type DocumentWithLatestJob,
  type ResolvedDocumentProcessingState
} from "@/lib/documents/document-status";
import {
  resolveAutomatedReviewAction,
  type AutomatedReviewActionResult
} from "@/lib/projects/automated-review-state";
import {
  countAutoVerified,
  countRequiresAttention
} from "@/lib/compliance/client-stages";
import {
  getProject,
  listProjectDocuments,
  listProjectReviews,
  listReviewClarifications,
  listReviewFindings
} from "@/server/services/projects";

type Props = {
  params:       Promise<{ projectId: string }>;
  searchParams: Promise<{ tab?: string }>;
};

type ResolvedDoc = DocumentWithLatestJob & { resolved: ResolvedDocumentProcessingState };

// ── Workflow steps ────────────────────────────────────────────────────────────

function deriveSteps(
  hasDocuments: boolean,
  specOk: boolean, subOk: boolean,
  reviewStatus: string | null
): WorkflowStep[] {
  const docsOk = specOk && subOk;
  const reviewComplete = reviewStatus === "awaiting_human_review" || reviewStatus === "approved";
  return [
    { id: "docs",     label: "Documents",         status: docsOk ? "complete" : "current"                                          },
    { id: "review",   label: "Automated review",  status: reviewStatus ? (reviewComplete ? "complete" : "current") : docsOk ? "current" : "pending" },
    { id: "verify",   label: "Human verification",status: reviewStatus === "approved" ? "complete" : reviewStatus === "awaiting_human_review" ? "current" : "pending" },
    { id: "approval", label: "Approval",          status: reviewStatus === "approved" ? "complete" : "pending"                      },
    { id: "report",   label: "Compliance report", status: "pending"                                                                  }
  ];
}

// ── Tab definitions ───────────────────────────────────────────────────────────

const TABS = ["overview", "documents", "review", "findings", "report"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  overview:  "Overview",
  documents: "Documents",
  review:    "Automated review",
  findings:  "Compliance matrix",
  report:    "Report"
};

// ── Review status helpers ─────────────────────────────────────────────────────

const R_LABEL: Record<string, string> = {
  draft: "Draft", ready: "Ready", running: "Running",
  awaiting_human_review: "Needs your review", approved: "Approved",
  failed: "Failed", cancelled: "Cancelled"
};
const R_TONE: Record<string, "green"|"amber"|"blue"|"red"|"gray"> = {
  draft: "gray", ready: "gray", running: "blue",
  awaiting_human_review: "amber", approved: "green",
  failed: "red", cancelled: "gray"
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function ProjectDetailPage({ params, searchParams }: Props) {
  const { projectId } = await params;
  const { tab: rawTab } = await searchParams;
  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : "overview";

  const project = await getProject(projectId);
  if (!project) notFound();

  const [documents, reviews] = await Promise.all([
    listProjectDocuments(projectId),
    listProjectReviews(projectId)
  ]);

  const latestReview    = reviews[0] ?? null;
  const findings        = latestReview ? await listReviewFindings(latestReview.id)       : [];
  const clarifications  = latestReview ? await listReviewClarifications(latestReview.id) : [];

  // ── Canonical status resolution ──────────────────────────────────────────────
  const resolvedDocs: ResolvedDoc[] = documents.map((d) => ({
    ...d,
    resolved: resolveDocumentStatus(d)
  }));

  const completedDocs   = resolvedDocs.filter((d) => d.resolved.status === "completed");
  const processingDocs  = resolvedDocs.filter((d) => d.resolved.isActivelyProcessing);
  const specDoc         = completedDocs.find((d) => isSpecificationRole(d.document_role));
  const submissionDoc   = completedDocs.find((d) => isSubmissionRole(d.document_role));
  const hasSpec         = !!specDoc;
  const hasSubmission   = !!submissionDoc;
  const canRunReview    = hasSpec && hasSubmission;
  const totalPages      = completedDocs.reduce((s, d) => s + (d.page_count ?? 0), 0);
  const hasDocuments    = documents.length > 0;

  // Resolver inputs also consider docs that are uploaded but not yet completed.
  const anySpecDoc       = resolvedDocs.some((d) => isSpecificationRole(d.document_role));
  const anySubmissionDoc = resolvedDocs.some((d) => isSubmissionRole(d.document_role));
  const hasAnyFailed     = resolvedDocs.some((d) => d.resolved.status === "failed");

  const actionResult = resolveAutomatedReviewAction({
    hasSpec:                  anySpecDoc,
    hasSubmission:            anySubmissionDoc,
    isAnyDocumentProcessing:  processingDocs.length > 0,
    hasAnyFailedDocuments:    hasAnyFailed,
    canRunReview,
    latestReview:             latestReview ? { id: latestReview.id, status: latestReview.status } : null
  });

  const steps = deriveSteps(
    hasDocuments, hasSpec, hasSubmission, latestReview?.status ?? null
  );

  // ── Findings ─────────────────────────────────────────────────────────────────
  const compliedCount    = findings.filter((f) => f.status === "complied").length;
  const partialCount     = findings.filter((f) => f.status === "partially_complied").length;
  const notCompliedCount = findings.filter((f) => f.status === "not_complied").length;
  const ambiguousCount   = findings.filter((f) => ["ambiguous","not_proven","ambiguous_not_proven","not_verified"].includes(f.status)).length;
  const openFindings     = findings.filter((f) => !["complied","exceeds_requirement","not_applicable"].includes(f.status));
  const topClarifications = [...clarifications].sort((a,b)=>priorityRank(a.priority)-priorityRank(b.priority)).slice(0,3);

  const matrixRows: ComplianceMatrixRow[] = findings.map((f) => ({
    id: f.id, clauseNumber: f.clause_number, requirementText: f.requirement_text,
    evidenceText: f.evidence_text, status: f.status, weightageScore: f.weightage_score,
    confidenceScore: f.confidence_score, riskLevel: f.risk_level, reasoning: f.reasoning,
    missingInformation: f.missing_information, contractorAction: f.contractor_action,
    humanComment: f.human_comment, humanOverrideStatus: f.human_override_status
  }));

  const recommendation = extractRecommendation(latestReview?.review_scope ?? null);

  const autoVerifiedCount      = countAutoVerified(findings);
  const requiresAttentionCount = countRequiresAttention(findings);

  // ── Primary action for header ─────────────────────────────────────────────────
  const primaryAction = deriveHeaderAction(actionResult, projectId);

  return (
    <div className="space-y-0">

      {/* ── Breadcrumb ────────────────────────────────────────────────────────── */}
      <nav aria-label="Breadcrumb" className="mb-4">
        <Link href="/projects" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          All projects
        </Link>
      </nav>

      {/* ── Project header ────────────────────────────────────────────────────── */}
      <div className="rounded-xl border bg-white px-5 py-4 shadow-sm mb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {project.status === "archived" && <Badge tone="gray">Archived</Badge>}
              {processingDocs.length > 0   && <Badge tone="blue">Processing</Badge>}
            </div>
            <h1 className="text-lg font-semibold truncate">{project.name}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {[project.client_name, project.discipline, project.review_type].filter(Boolean).join(" · ")}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {completedDocs.length} document{completedDocs.length !== 1 ? "s" : ""} ready
              {totalPages > 0 ? ` · ${totalPages} pages` : ""}
              {" · "}Updated {timeAgo(project.updated_at)}
            </p>
          </div>
          {primaryAction}
        </div>

        {/* Workflow stepper */}
        <div className="mt-4 pt-3 border-t">
          <WorkflowStepper steps={steps} />
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="mb-5 border-b bg-white rounded-t-xl">
        <nav
          aria-label="Project workspace tabs"
          className="flex overflow-x-auto px-2 gap-0"
          role="tablist"
        >
          {TABS.map((t) => (
            <Link
              key={t}
              href={`/projects/${projectId}?tab=${t}`}
              role="tab"
              aria-selected={tab === t}
              className={`shrink-0 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAB_LABELS[t]}
            </Link>
          ))}
        </nav>
      </div>

      {/* ── Tab content ──────────────────────────────────────────────────────── */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start">
        <main>

          {tab === "overview" && (
            <OverviewTab
              projectId={projectId} hasDocuments={hasDocuments} hasSpec={hasSpec} hasSubmission={hasSubmission}
              specDoc={specDoc} submissionDoc={submissionDoc} actionResult={actionResult}
              latestReview={latestReview} totalFindings={findings.length}
              autoVerifiedCount={autoVerifiedCount} requiresAttentionCount={requiresAttentionCount}
              topClarifications={topClarifications} recommendation={recommendation}
            />
          )}

          {tab === "documents" && (
            <DocumentsTab documents={resolvedDocs} projectId={projectId} />
          )}

          {tab === "review" && (
            <ReviewTab
              projectId={projectId} actionResult={actionResult} latestReview={latestReview}
              reviews={reviews} compliedCount={compliedCount} partialCount={partialCount}
              notCompliedCount={notCompliedCount} ambiguousCount={ambiguousCount}
              recommendation={recommendation}
            />
          )}

          {tab === "findings" && (
            <FindingsTab projectId={projectId} matrixRows={matrixRows} hasReview={!!latestReview} />
          )}

          {tab === "report" && (
            <ReportTab latestReview={latestReview} projectId={projectId} />
          )}

        </main>

        {/* ── Side panel ─────────────────────────────────────────────────────── */}
        <aside className="space-y-4 xl:sticky xl:top-4">
          <CompactProjectPanel
            projectId={projectId}
            hasSpec={hasSpec} hasSubmission={hasSubmission}
            specDoc={specDoc}         submissionDoc={submissionDoc}
            docCount={documents.length} totalPages={totalPages}
            actionResult={actionResult}
          />

          {/* Document assistant is available via the chat API but not shown on the
              project overview — reviewers are directed to the compliance matrix
              and flagged findings instead. */}
        </aside>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function OverviewTab({
  projectId, hasDocuments, hasSpec, hasSubmission, specDoc, submissionDoc,
  actionResult, latestReview, totalFindings, autoVerifiedCount, requiresAttentionCount,
  topClarifications, recommendation
}: {
  projectId: string; hasDocuments: boolean; hasSpec: boolean; hasSubmission: boolean;
  specDoc?: { file_name: string; page_count?: number|null } | null;
  submissionDoc?: { file_name: string; page_count?: number|null } | null;
  actionResult: AutomatedReviewActionResult;
  latestReview: { id: string; status: string; title: string } | null;
  totalFindings: number; autoVerifiedCount: number; requiresAttentionCount: number;
  topClarifications: { id: string; issue: string; clause_number?: string|null }[];
  recommendation: string | null;
}) {
  return (
    <div className="space-y-5">
      {/* Readiness */}
      <section className="rounded-xl border bg-white shadow-sm p-5">
        <h2 className="text-sm font-semibold mb-3">Document readiness</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <ReadinessCard label="Specification source" complete={hasSpec}
            filename={specDoc?.file_name} pages={specDoc?.page_count} />
          <ReadinessCard label="Proposed product / contractor submission" complete={hasSubmission}
            filename={submissionDoc?.file_name} pages={submissionDoc?.page_count} />
        </div>
        {!hasDocuments && (
          <div className="mt-4 pt-4 border-t">
            <ProjectUploadButton projectId={projectId} label="Upload first document" variant="default" />
          </div>
        )}
        {actionResult.action.type === "run_review" && !latestReview && (
          <div className="mt-4 pt-4 border-t">
            <RunReviewButton projectId={projectId} label={actionResult.action.label} />
          </div>
        )}
      </section>

      {/* Review summary — exception-based */}
      {latestReview ? (
        <section className="rounded-xl border bg-white shadow-sm p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-semibold">
                {latestReview.status === "awaiting_human_review" || latestReview.status === "approved"
                  ? "Technical review completed"
                  : "Automated review"}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">{latestReview.title}</p>
            </div>
            <Badge tone={R_TONE[latestReview.status] ?? "gray"}>
              {R_LABEL[latestReview.status] ?? latestReview.status.replace(/_/g," ")}
            </Badge>
          </div>

          {/* Exception-based summary */}
          {totalFindings > 0 && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-slate-50 border px-3 py-2.5 text-center">
                  <p className="text-xl font-bold text-emerald-700">{autoVerifiedCount}</p>
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground mt-0.5">Automatically verified</p>
                </div>
                <div className={`rounded-lg border px-3 py-2.5 text-center ${requiresAttentionCount > 0 ? "bg-amber-50 border-amber-200" : "bg-slate-50"}`}>
                  <p className={`text-xl font-bold ${requiresAttentionCount > 0 ? "text-amber-700" : "text-slate-600"}`}>{requiresAttentionCount}</p>
                  <p className="text-[10px] uppercase font-semibold text-muted-foreground mt-0.5">Requires attention</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{totalFindings} requirement{totalFindings !== 1 ? "s" : ""} checked in total</p>
            </div>
          )}

          {requiresAttentionCount > 0 && (
            <div className="mt-4 pt-3 border-t">
              <Link
                href={`/projects/${projectId}/reviews/${latestReview.id}`}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors"
              >
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                Review flagged findings
              </Link>
            </div>
          )}

          {recommendation && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Recommendation</p>
              <p className="text-sm font-medium">{recommendation}</p>
            </div>
          )}
          {topClarifications.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600" aria-hidden="true" />
                <p className="text-xs font-medium text-amber-700">{topClarifications.length} contractor action{topClarifications.length!==1?"s":""} pending</p>
              </div>
              {topClarifications.map((c) => (
                <p key={c.id} className="text-xs text-muted-foreground mt-1 leading-5">
                  <span className="font-medium">{c.clause_number ?? "—"}</span>
                  {" · "}{c.issue.slice(0, 80)}{c.issue.length > 80 ? "…" : ""}
                </p>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="rounded-xl border bg-white shadow-sm">
          <EmptyState
            icon={<FileText className="h-5 w-5" aria-hidden="true" />}
            title={actionResult.action.type === "run_review" ? "Ready for automated review" : "Process documents first"}
            detail={
              actionResult.action.type === "run_review"
                ? "The system will check each clause automatically. You review only the flagged findings."
                : "Upload and process a specification and a proposed product document."
            }
            action={
              actionResult.action.type === "run_review" ? (
                <RunReviewButton projectId={projectId} label={actionResult.action.label} />
              ) : (
                <ProjectUploadButton projectId={projectId} />
              )
            }
          />
        </section>
      )}
    </div>
  );
}

function DocumentsTab({ documents, projectId }: { documents: ResolvedDoc[]; projectId: string }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Documents</h2>
        <ProjectUploadButton projectId={projectId} />
      </div>
      {documents.length === 0 ? (
        <section className="rounded-xl border bg-white shadow-sm">
          <EmptyState
            icon={<FileText className="h-5 w-5" aria-hidden="true" />}
            title="No documents uploaded"
            detail="Upload a specification and a submission document to get started."
            action={<ProjectUploadButton projectId={projectId} variant="default" />}
          />
        </section>
      ) : (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <DocumentRegister documents={documents} />
        </div>
      )}
    </div>
  );
}

function ReviewTab({
  projectId, actionResult, latestReview, reviews,
  compliedCount, partialCount, notCompliedCount, ambiguousCount, recommendation
}: {
  projectId: string; actionResult: AutomatedReviewActionResult;
  latestReview: { id: string; status: string; title: string; created_at: string } | null;
  reviews: { id: string; status: string; title: string; created_at: string }[];
  compliedCount: number; partialCount: number; notCompliedCount: number; ambiguousCount: number;
  recommendation: string | null;
}) {
  return (
    <div className="space-y-5">
      {/* Single primary action — only when no review exists */}
      {!latestReview && (
        <section className="rounded-xl border bg-white shadow-sm p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold">Automated compliance review</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                The system checks each clause automatically. You review only the flagged findings.
              </p>
            </div>
            {actionResult.action.type === "run_review" && (
              <RunReviewButton projectId={projectId} label={actionResult.action.label} variant="compact" />
            )}
          </div>
          {actionResult.action.type === "upload_documents" && (
            <p className="text-xs text-muted-foreground mt-2">
              Upload a specification document and a contractor submission before running a review.
            </p>
          )}
        </section>
      )}

      {/* Latest review summary */}
      {latestReview && (
        <section className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="border-b px-5 py-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{latestReview.title}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{new Date(latestReview.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Badge tone={R_TONE[latestReview.status] ?? "gray"}>
                {R_LABEL[latestReview.status] ?? latestReview.status.replace(/_/g," ")}
              </Badge>
              <Link href={`/projects/${projectId}/reviews/${latestReview.id}`}
                className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 transition-colors">
                <ExternalLink className="h-3 w-3" />
                {latestReview.status === "awaiting_human_review" ? "Review flagged findings" : "Open review"}
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x">
            {[
              { label: "Complied",     value: compliedCount,    tone: "green"  as const },
              { label: "Partial",      value: partialCount,     tone: "amber"  as const },
              { label: "Not complied", value: notCompliedCount, tone: "red"    as const },
              { label: "Ambiguous",    value: ambiguousCount,   tone: "purple" as const }
            ].map((s) => (
              <div key={s.label} className="px-4 py-3 text-center">
                <p className="text-2xl font-bold">{s.value}</p>
                <Badge tone={s.tone} className="mt-1 text-[10px]">{s.label}</Badge>
              </div>
            ))}
          </div>
          {recommendation && (
            <div className="border-t px-5 py-3 bg-slate-50/50">
              <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">Recommendation</p>
              <p className="text-sm font-medium">{recommendation}</p>
            </div>
          )}
        </section>
      )}

      {/* Previous reviews */}
      {reviews.length > 1 && (
        <section className="rounded-xl border bg-white shadow-sm divide-y">
          <div className="px-5 py-3"><h2 className="text-sm font-semibold">Previous reviews</h2></div>
          {reviews.slice(1).map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{r.title}</p>
                <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge tone={R_TONE[r.status] ?? "gray"}>{R_LABEL[r.status] ?? r.status.replace(/_/g," ")}</Badge>
                <Link href={`/projects/${projectId}/reviews/${r.id}`}
                  className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 transition-colors">
                  <ExternalLink className="h-3 w-3" />Open
                </Link>
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function FindingsTab({ projectId, matrixRows, hasReview }: {
  projectId: string; matrixRows: ComplianceMatrixRow[]; hasReview: boolean;
}) {
  if (!hasReview) {
    return (
      <section className="rounded-xl border bg-white shadow-sm">
        <EmptyState
          icon={<FileText className="h-5 w-5" aria-hidden="true" />}
          title="No findings yet"
          detail="Run a review to generate compliance findings."
          action={
            <Link href={`/projects/${projectId}?tab=review`}
              className="inline-flex items-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-slate-50 transition-colors">
              Run automated review
            </Link>
          }
        />
      </section>
    );
  }
  if (matrixRows.length === 0) {
    return (
      <section className="rounded-xl border bg-white shadow-sm">
        <EmptyState
          icon={<FileText className="h-5 w-5" aria-hidden="true" />}
          title="No findings in this review"
          detail="The review did not produce any findings. Check the review status."
        />
      </section>
    );
  }
  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <ComplianceMatrix rows={matrixRows} />
    </div>
  );
}

function ReportTab({
  latestReview, projectId
}: {
  latestReview: { id: string; status: string } | null;
  projectId: string;
}) {
  const isApproved = latestReview?.status === "approved";
  return (
    <section className="rounded-xl border bg-white shadow-sm p-5 space-y-4">
      <h2 className="text-sm font-semibold">Compliance report</h2>
      {isApproved ? (
        <>
          <p className="text-sm text-muted-foreground">
            The assessment has been approved. Report generation will be available in a future release.
          </p>
          <p className="text-xs text-muted-foreground">
            The compliance report will include: executive summary, clause-by-clause compliance matrix,
            items not complied, items not proven, ambiguous items, missing-information schedule,
            contractor-action schedule, reviewer decisions, and audit trail.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Complete the flagged findings and approval before generating the compliance report.
          </p>
          {latestReview && (
            <Link
              href={`/projects/${projectId}/reviews/${latestReview.id}`}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Review flagged findings
            </Link>
          )}
          {!latestReview && (
            <Link
              href={`/projects/${projectId}?tab=review`}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium hover:bg-slate-50 transition-colors"
            >
              Run automated review first
            </Link>
          )}
        </>
      )}
    </section>
  );
}

function CompactProjectPanel({
  projectId, hasSpec, hasSubmission, specDoc, submissionDoc, docCount, totalPages,
  actionResult
}: {
  projectId: string; hasSpec: boolean; hasSubmission: boolean;
  specDoc?: { file_name: string; page_count?: number|null } | null;
  submissionDoc?: { file_name: string; page_count?: number|null } | null;
  docCount: number; totalPages: number;
  actionResult: AutomatedReviewActionResult;
}) {
  return (
    <div className="rounded-xl border bg-white shadow-sm p-4 space-y-3">
      <h3 className="text-sm font-semibold">Project readiness</h3>

      <ReadinessCard label="Specification source" complete={hasSpec}
        filename={specDoc?.file_name} pages={specDoc?.page_count} compact />
      <ReadinessCard label="Proposed product" complete={hasSubmission}
        filename={submissionDoc?.file_name} pages={submissionDoc?.page_count} compact />

      <div className="flex items-center justify-between py-1.5 border-t text-xs text-muted-foreground">
        <span>Documents</span>
        <span>{docCount} uploaded{totalPages > 0 ? ` · ${totalPages} pages` : ""}</span>
      </div>

      <ProjectUploadButton projectId={projectId} fullWidth />

      {actionResult.action.type === "run_review" && (
        <RunReviewButton projectId={projectId} label={actionResult.action.label} variant="full-width" />
      )}
    </div>
  );
}

function ReadinessCard({
  complete, label, filename, pages, compact = false
}: {
  complete: boolean; label: string;
  filename?: string | null; pages?: number | null; compact?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-2.5 ${complete ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200"}`}>
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${complete ? "bg-emerald-100" : "bg-slate-100"}`}>
          {complete
            ? <CheckCircle2 className="h-3 w-3 text-emerald-600" aria-hidden="true" />
            : <div className="h-2 w-2 rounded-full bg-slate-300" />}
        </div>
        <div className="min-w-0">
          <p className={`text-xs font-medium ${complete ? "text-emerald-700" : "text-muted-foreground"}`}>{label}</p>
          {filename ? (
            <>
              <p className="text-xs text-muted-foreground truncate mt-0.5" title={filename}>{filename}</p>
              {!compact && pages != null && (
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">{pages} page{pages !== 1 ? "s" : ""}</p>
              )}
              {compact && pages != null && (
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">{pages}p</p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5">Required</p>
          )}
        </div>
      </div>
    </div>
  );
}

function DocumentRegister({ documents }: { documents: ResolvedDoc[] }) {
  return (
    <>
      {/* Mobile stacked cards */}
      <div className="divide-y md:hidden">
        {documents.map((doc) => {
          const { resolved } = doc;
          const action = getActionLabel(resolved);
          return (
            <div key={doc.id} className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-medium break-words">{doc.file_name}</p>
                <Badge tone={RESOLVED_STATUS_TONE[resolved.status]}>{RESOLVED_STATUS_LABEL[resolved.status]}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{documentRoleLabels[doc.document_role] ?? doc.document_role}</p>
              {doc.page_count != null && <p className="text-xs text-muted-foreground">{doc.page_count} pages</p>}
              {resolved.status === "failed" && resolved.safeErrorMessage && (
                <p className="text-xs text-red-600">{resolved.safeErrorMessage.slice(0, 80)}</p>
              )}
              {resolved.isActivelyProcessing && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />Waiting for worker…
                </p>
              )}
              {action && !resolved.isActivelyProcessing && (
                <details className="inline-block">
                  <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground select-none">
                    More options ▾
                  </summary>
                  <div className="mt-1.5">
                    <DocumentProcessButton documentId={doc.id} label={action} disabled={doc.ocr_required && resolved.status === "failed"} />
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm min-w-[580px]">
          <thead className="bg-slate-50/70 border-b">
            <tr>
              {["Document","Role","Pages","Status","Options"].map((h) => (
                <th key={h} className="py-2.5 px-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {documents.map((doc) => {
              const { resolved } = doc;
              const action = getActionLabel(resolved);
              return (
                <tr key={doc.id} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-3 px-4">
                    <p className="font-medium truncate max-w-[200px]" title={doc.file_name}>{doc.file_name}</p>
                  </td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{documentRoleLabels[doc.document_role] ?? doc.document_role}</td>
                  <td className="py-3 px-4 text-xs text-muted-foreground">{doc.page_count ?? "—"}</td>
                  <td className="py-3 px-4">
                    <div className="space-y-1">
                      <Badge tone={RESOLVED_STATUS_TONE[resolved.status]}>{RESOLVED_STATUS_LABEL[resolved.status]}</Badge>
                      {resolved.isActivelyProcessing && resolved.progress != null && resolved.progress > 0 && (
                        <p className="text-xs text-muted-foreground">{resolved.progress}%</p>
                      )}
                      {resolved.status === "failed" && resolved.safeErrorMessage && (
                        <p className="text-xs text-red-600 max-w-[160px]">{resolved.safeErrorMessage.slice(0, 60)}</p>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    {resolved.isActivelyProcessing ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />Waiting…
                      </span>
                    ) : action ? (
                      <details className="inline-block">
                        <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground select-none">
                          More ▾
                        </summary>
                        <div className="mt-1.5">
                          <DocumentProcessButton documentId={doc.id} label={action}
                            disabled={doc.ocr_required && resolved.status === "failed"}
                            hint={doc.ocr_required && resolved.status === "failed" ? "OCR required" : undefined} />
                        </div>
                      </details>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function deriveHeaderAction(
  actionResult: AutomatedReviewActionResult,
  projectId: string
) {
  const { action } = actionResult;
  if (action.type === "review_findings") {
    return (
      <Link href={`/projects/${projectId}/reviews/${action.reviewId}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100 transition-colors shrink-0">
        <AlertTriangle className="h-4 w-4" />{action.label}
      </Link>
    );
  }
  if (action.type === "view_progress") {
    return (
      <Link href={`/projects/${projectId}/reviews/${action.reviewId}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-medium text-blue-800 hover:bg-blue-100 transition-colors shrink-0">
        <RefreshCw className="h-4 w-4" />{action.label}
      </Link>
    );
  }
  if (action.type === "view_approved") {
    return (
      <Link href={`/projects/${projectId}/reviews/${action.reviewId}`}
        className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-100 transition-colors shrink-0">
        <CheckCircle2 className="h-4 w-4" />{action.label}
      </Link>
    );
  }
  if (action.type === "run_review") {
    return <RunReviewButton projectId={projectId} label={action.label} variant="compact" />;
  }
  return <ProjectUploadButton projectId={projectId} label="Upload documents" />;
}

function timeAgo(iso: string): string {
  const ms   = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function priorityRank(p: string): number {
  return ({ Critical: 0, High: 1, Medium: 2, Low: 3 } as Record<string, number>)[p] ?? 4;
}

function extractRecommendation(scope: string | null): string | null {
  return scope?.match(/Recommendation:\s*([^\n]+)/)?.[1] ?? null;
}
