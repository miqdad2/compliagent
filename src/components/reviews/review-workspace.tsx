"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, AlertTriangle, ChevronRight, FileText, Search, Filter, Eye } from "lucide-react";
import { normalizeDisplayText } from "@/lib/documents/text-display";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ComplianceStatusBadge } from "@/components/compliance/compliance-status-badge";
import { RequirementStateBadge } from "./requirement-state-badge";
import type { ComplianceStatus } from "@/types/domain";

// ── Types ─────────────────────────────────────────────────────────────────────

type Requirement = {
  id: string;
  clause_number: string | null;
  sub_clause_number: string | null;
  section_heading: string | null;
  requirement_text: string;
  requirement_state: string;
  mandatory_level: string | null;
  human_review_required: boolean;
};

type Condition = {
  id: string;
  requirement_id: string;
  condition_order: number;
  condition_key: string;
  attribute: string;
  expected_text: string | null;
  expected_numeric_value: number | null;
  expected_unit: string | null;
  is_mandatory: boolean;
};

type Evaluation = {
  id: string;
  requirement_condition_id: string;
  finding_id: string;
  status: string;
  evidence_summary: string | null;
  reasoning: string;
  missing_information: string | null;
  contradiction_reasoning: string | null;
  contractor_action: string | null;
  confidence_score: number;
  human_status: string | null;
  human_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  is_human_review_required: boolean;
};

type Finding = {
  id: string;
  requirement_id: string | null;
  clause_number: string | null;
  requirement_text: string;
  status: string;
  deterministic_derived_status: string | null;
  confidence_score: number;
  reasoning: string;
  missing_information: string | null;
  contractor_action: string | null;
  risk_level: string;
  human_override_status: string | null;
  human_comment: string | null;
  reviewer_comment: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
};

type EvidenceRegion = {
  id: string;
  document_id: string;
  page_number: number | null;
  slide_number: number | null;
  sheet_name: string | null;
  cell_range: string | null;
  coordinate_system: string;
  extracted_text: string | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
};

type EvidenceLink = {
  condition_evaluation_id: string;
  evidence_region_id: string | null;
};

type Document = {
  id: string;
  file_name: string;
  document_role: string;
  processing_status: string;
};

type ReviewSummary = {
  findingCount: number;
  requirementCount: number;
  provisionalCount: number;
  confirmedCount: number;
  humanReviewRequiredCount: number;
  statusCounts: Record<string, number>;
  aiRunCount: number;
};

type WorkspaceProps = {
  reviewId:        string;
  projectId:       string;
  reviewTitle:     string;
  reviewStatus:    string;
  executionMode:   string;
  requirements:    Requirement[];
  conditions:      Condition[];
  findings:        Finding[];
  evaluations:     Evaluation[];
  evidenceLinks:   EvidenceLink[];
  evidenceRegions: EvidenceRegion[];
  documents:       Document[];
  summary:         ReviewSummary;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

type StatusFilterValue = "all" | "requires_attention" | "provisional" | "confirmed" | "complied"
  | "partially_complied" | "not_complied" | "ambiguous" | "not_proven" | "not_verified";

const MODE_LABEL: Record<string, string> = {
  deterministic:   "Deterministic review",
  mock:            "Test review",
  controlled_live: "AI-assisted review"
};

const STATUS_LABEL: Record<string, string> = {
  awaiting_human_review: "Needs your review",
  approved:              "Approved",
  running:               "Running",
  draft:                 "Draft",
  failed:                "Failed",
  cancelled:             "Cancelled"
};

const REQUIRES_ATTENTION_STATUSES = new Set([
  "not_complied", "partially_complied", "not_proven", "ambiguous", "not_verified", "ambiguous_not_proven"
]);

function effectiveStatus(finding: Finding): string {
  return finding.human_override_status ?? finding.deterministic_derived_status ?? finding.status;
}

function requirementMatchesFilter(
  req: Requirement,
  finding: Finding | undefined,
  filter: StatusFilterValue
): boolean {
  if (filter === "all") return true;
  if (filter === "provisional")        return req.requirement_state === "provisional";
  if (filter === "confirmed")          return req.requirement_state === "confirmed";
  if (filter === "requires_attention") {
    // Provisional requirements always need attention.
    if (req.requirement_state === "provisional") return true;
    if (!finding) return true;  // No finding at all = needs attention.
    const status = effectiveStatus(finding);
    return REQUIRES_ATTENTION_STATUSES.has(status) || (!finding.reviewed_by && status !== "complied" && status !== "exceeds_requirement" && status !== "not_applicable");
  }
  const status = finding ? effectiveStatus(finding) : null;
  return status === filter;
}

// ── Evidence text display ─────────────────────────────────────────────────────

function EvidenceViewer({ region, documents }: { region: EvidenceRegion | null; documents: Document[] }) {
  if (!region) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground p-8 text-center">
        <div>
          <Eye className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p>Select a requirement to see its evidence.</p>
        </div>
      </div>
    );
  }

  const doc = documents.find((d) => d.id === region.document_id);
  const coordsAvailable = region.x !== null && region.y !== null;

  return (
    <div className="p-4 space-y-3">
      <div className="text-xs text-muted-foreground space-y-1">
        <div><span className="font-medium">Document:</span> {doc?.file_name ?? region.document_id}</div>
        {region.page_number   && <div><span className="font-medium">Page:</span> {region.page_number}</div>}
        {region.slide_number  && <div><span className="font-medium">Slide:</span> {region.slide_number}</div>}
        {region.sheet_name    && <div><span className="font-medium">Sheet:</span> {region.sheet_name}</div>}
        {region.cell_range    && <div><span className="font-medium">Cell range:</span> {region.cell_range}</div>}
        {!coordsAvailable && (
          <div className="flex items-center gap-1 text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span>Visual location unavailable — coordinates not extracted for this document format.</span>
          </div>
        )}
      </div>

      {region.extracted_text ? (
        <div className="rounded-lg border bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-500 mb-1">Extracted text</p>
          <p className="text-sm font-mono whitespace-pre-wrap">{normalizeDisplayText(region.extracted_text)}</p>
        </div>
      ) : (
        <div className="text-sm text-muted-foreground italic">No extracted text available for this region.</div>
      )}
    </div>
  );
}

// ── Finding inspector panel ───────────────────────────────────────────────────

function FindingInspector({
  requirement,
  finding,
  conditions,
  evaluations,
  reviewId,
  onActionComplete
}: {
  requirement: Requirement | null;
  finding:     Finding | null;
  conditions:  Condition[];
  evaluations: Evaluation[];
  reviewId:    string;
  onActionComplete: () => void;
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reviewerComment, setReviewerComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAction = useCallback(async (action: "approve" | "reject") => {
    if (!finding) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${reviewId}/findings/${finding.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reviewerComment: reviewerComment.trim() || undefined
        })
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) { setError(json.error ?? "Action failed."); return; }
      setReviewerComment("");
      onActionComplete();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [finding, reviewId, reviewerComment, onActionComplete]);

  const handleConfirmRequirement = useCallback(async () => {
    if (!requirement) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reviews/${reviewId}/requirements/${requirement.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" })
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) { setError(json.error ?? "Could not confirm requirement."); return; }
      onActionComplete();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [requirement, reviewId, onActionComplete]);

  if (!requirement) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground p-8 text-center">
        <div>
          <FileText className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p>Select a requirement to inspect its finding.</p>
        </div>
      </div>
    );
  }

  const reqConditions = conditions.filter((c) => c.requirement_id === requirement.id);
  const findingEvals  = finding ? evaluations.filter((e) => e.finding_id === finding.id) : [];
  const status        = finding ? effectiveStatus(finding) : null;
  const isApproved    = !!finding?.reviewed_by;

  return (
    <div className="p-4 space-y-4 text-sm overflow-y-auto h-full">
      {/* Requirement header */}
      <div>
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="font-mono text-xs text-muted-foreground">{requirement.clause_number ?? "—"}</span>
          <RequirementStateBadge state={requirement.requirement_state} />
        </div>
        <p className="text-sm font-medium leading-snug">{requirement.requirement_text}</p>
        {requirement.human_review_required && (
          <div className="mt-1 flex items-center gap-1 text-amber-700 text-xs">
            <AlertTriangle className="h-3 w-3" /> Requires human review
          </div>
        )}
      </div>

      {/* Confirm provisional */}
      {requirement.requirement_state === "provisional" && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2">
          <p className="text-xs font-medium text-amber-800">This is a provisional requirement discovered from document text. Confirm or reject it before approving the finding.</p>
          <Button
            className="h-7 text-xs"
            onClick={handleConfirmRequirement}
            disabled={isSubmitting}
          >
            Confirm Requirement
          </Button>
        </div>
      )}

      {/* Conditions */}
      {reqConditions.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Conditions ({reqConditions.length})</p>
          <div className="space-y-2">
            {reqConditions.map((cond) => {
              const eval_ = findingEvals.find((e) => e.requirement_condition_id === cond.id);
              const condStatus = eval_?.human_status ?? eval_?.status;
              return (
                <div key={cond.id} className="rounded-md border p-2 space-y-1">
                  <div className="flex items-start justify-between gap-1">
                    <span className="text-xs font-medium">{cond.attribute}</span>
                    {condStatus && (
                      <ComplianceStatusBadge status={condStatus as ComplianceStatus} />
                    )}
                  </div>
                  {cond.expected_text && (
                    <p className="text-xs text-muted-foreground">Expected: {cond.expected_text} {cond.expected_unit ?? ""}</p>
                  )}
                  {eval_ && (
                    <div className="space-y-1 text-xs">
                      {eval_.evidence_summary && (
                        <p className="text-slate-600 italic">&ldquo;{eval_.evidence_summary.slice(0, 200)}&rdquo;</p>
                      )}
                      {eval_.reasoning && (
                        <div>
                          <span className="font-medium text-slate-500">Reasoning:</span>
                          <span className="ml-1 text-slate-600">{eval_.reasoning.slice(0, 300)}</span>
                        </div>
                      )}
                      {eval_.missing_information && (
                        <div className="text-amber-700">
                          <span className="font-medium">Missing:</span> {eval_.missing_information.slice(0, 200)}
                        </div>
                      )}
                      {eval_.human_status && (
                        <div className="text-green-700 text-xs">
                          <span className="font-medium">Reviewer override:</span> {eval_.human_status}
                          {eval_.reviewed_at && ` — ${new Date(eval_.reviewed_at).toLocaleDateString()}`}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Draft finding status */}
      {finding && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Draft Finding</p>
          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Deterministic:</span>
              {finding.deterministic_derived_status && (
                <ComplianceStatusBadge status={finding.deterministic_derived_status as ComplianceStatus} />
              )}
            </div>
            {finding.human_override_status && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-green-700">Reviewer final:</span>
                <ComplianceStatusBadge status={finding.human_override_status as ComplianceStatus} />
                {finding.reviewed_at && (
                  <span className="text-xs text-muted-foreground">{new Date(finding.reviewed_at).toLocaleDateString()}</span>
                )}
              </div>
            )}
            {status && !finding.human_override_status && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Current:</span>
                <ComplianceStatusBadge status={status as ComplianceStatus} />
              </div>
            )}
            {finding.reasoning && (
              <p className="text-xs text-slate-600">{finding.reasoning.slice(0, 300)}</p>
            )}
            {finding.missing_information && (
              <p className="text-xs text-amber-700"><span className="font-medium">Missing:</span> {finding.missing_information.slice(0, 200)}</p>
            )}
            {finding.contractor_action && (
              <p className="text-xs text-blue-700"><span className="font-medium">Action:</span> {finding.contractor_action.slice(0, 200)}</p>
            )}
            <div className="text-xs text-muted-foreground">
              Confidence: {Math.round(finding.confidence_score)}% · Risk: {finding.risk_level}
            </div>
          </div>
        </div>
      )}

      {/* Approval actions */}
      {finding && !isApproved && (
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reviewer action</p>
          <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-500 mb-2">
            AI findings are drafts. Your decision is final.
          </div>
          <textarea
            value={reviewerComment}
            onChange={(e) => setReviewerComment(e.target.value)}
            placeholder="Optional reviewer comment..."
            rows={2}
            className="w-full rounded-md border px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button
              className="h-8 flex-1 gap-1 text-xs"
              onClick={() => void handleAction("approve")}
              disabled={isSubmitting}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Approve
            </Button>
            <Button
              variant="outline"
              className="h-8 flex-1 gap-1 text-xs border-red-200 text-red-700 hover:bg-red-50"
              onClick={() => void handleAction("reject")}
              disabled={isSubmitting}
            >
              <XCircle className="h-3.5 w-3.5" /> Reject
            </Button>
          </div>
        </div>
      )}

      {finding && isApproved && (
        <div className="border-t pt-3">
          <div className="flex items-center gap-1 text-green-700 text-xs">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span>Reviewed {finding.reviewed_at ? `on ${new Date(finding.reviewed_at).toLocaleDateString()}` : ""}</span>
          </div>
          {finding.reviewer_comment && (
            <p className="text-xs text-slate-600 mt-1 italic">&ldquo;{finding.reviewer_comment}&rdquo;</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main workspace component ──────────────────────────────────────────────────

export function ReviewWorkspace({
  reviewId, projectId, reviewTitle, reviewStatus, executionMode,
  requirements, conditions, findings, evaluations,
  evidenceLinks, evidenceRegions, documents, summary
}: WorkspaceProps) {
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(
    requirements[0]?.id ?? null
  );
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("requires_attention");
  const [searchQuery, setSearchQuery] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  const selectedRequirement = requirements.find((r) => r.id === selectedRequirementId) ?? null;
  const selectedFinding     = findings.find((f) => f.requirement_id === selectedRequirementId) ?? null;

  // Get primary evidence region for the selected finding via evidenceLinks.
  const selectedEvaluation = selectedFinding
    ? evaluations.find((e) => e.finding_id === selectedFinding.id && e.evidence_summary)
    : null;
  const primaryRegion: EvidenceRegion | null = (() => {
    if (!selectedFinding) return null;
    const findingEvals = evaluations.filter((e) => e.finding_id === selectedFinding.id);
    for (const ev of findingEvals) {
      const link = evidenceLinks.find((l) => l.condition_evaluation_id === ev.id && l.evidence_region_id);
      if (link?.evidence_region_id) {
        return evidenceRegions.find((r) => r.id === link.evidence_region_id) ?? null;
      }
    }
    return null;
  })();

  const filtered = requirements.filter((req) => {
    const finding = findings.find((f) => f.requirement_id === req.id);
    if (!requirementMatchesFilter(req, finding ?? undefined, statusFilter)) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        req.requirement_text.toLowerCase().includes(q) ||
        (req.clause_number ?? "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  const handleActionComplete = useCallback(() => {
    setRefreshKey((k) => k + 1);
    // Trigger server revalidation via router.refresh() so the Server Component
    // re-fetches the latest finding/requirement state from the database.
    router.refresh();
  }, [router]);

  return (
    <div className="flex flex-col h-full" key={refreshKey}>
      {/* Review header */}
      <div className="border-b px-6 py-3 bg-white">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-base font-semibold truncate">{reviewTitle}</h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-0.5">
              <Badge tone={reviewStatus === "awaiting_human_review" ? "amber" : reviewStatus === "approved" ? "green" : "gray"}>
                {STATUS_LABEL[reviewStatus] ?? reviewStatus.replace(/_/g, " ")}
              </Badge>
              <Badge tone="blue">{MODE_LABEL[executionMode] ?? executionMode.replace(/_/g, " ")}</Badge>
              <span>{summary.findingCount} requirements checked</span>
              {summary.humanReviewRequiredCount > 0 && (
                <span className="text-amber-700">· {summary.humanReviewRequiredCount} requires attention</span>
              )}
              {summary.provisionalCount > 0 && (
                <span className="text-amber-600">· {summary.provisionalCount} need confirmation</span>
              )}
            </div>
          </div>
          <Link
            href={`/projects/${projectId}`}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Back to project
          </Link>
        </div>
      </div>

      {/* Three-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Requirement tree */}
        <div className="w-72 shrink-0 border-r bg-white flex flex-col overflow-hidden">
          <div className="border-b p-3 space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search clause or text…"
                className="pl-7 h-8 text-xs"
              />
            </div>
            <div className="flex items-center gap-1">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilterValue)}
                className="flex-1 text-xs border rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="requires_attention">Requires attention</option>
                <option value="all">All requirements</option>
                <option value="provisional">Needs confirmation</option>
                <option value="confirmed">Confirmed</option>
                <option value="complied">Complied</option>
                <option value="partially_complied">Partially complied</option>
                <option value="not_complied">Not complied</option>
                <option value="ambiguous">Ambiguous</option>
                <option value="not_proven">Not proven</option>
                <option value="not_verified">Not verified</option>
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground">No requirements match.</div>
            ) : (
              filtered.map((req) => {
                const finding = findings.find((f) => f.requirement_id === req.id);
                const status  = finding ? effectiveStatus(finding) : null;
                const condCount = conditions.filter((c) => c.requirement_id === req.id).length;
                const isSelected = req.id === selectedRequirementId;

                return (
                  <button
                    key={req.id}
                    onClick={() => setSelectedRequirementId(req.id)}
                    className={`w-full text-left p-3 border-b text-xs hover:bg-slate-50 transition-colors ${
                      isSelected ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-1 mb-0.5">
                      <span className="font-mono text-muted-foreground">{req.clause_number ?? "—"}</span>
                      {req.requirement_state !== "confirmed" && (
                        <RequirementStateBadge state={req.requirement_state} />
                      )}
                      {status && (
                        <ComplianceStatusBadge status={status as ComplianceStatus} />
                      )}
                    </div>
                    <p className="line-clamp-2 leading-snug text-slate-700">{req.requirement_text}</p>
                    <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                      {condCount > 0 && <span>{condCount} condition{condCount !== 1 ? "s" : ""}</span>}
                      {req.human_review_required && (
                        <span className="text-amber-600">⚠ review</span>
                      )}
                      {isSelected && <ChevronRight className="ml-auto h-3 w-3" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Centre: Evidence viewer */}
        <div className="flex-1 overflow-hidden border-r bg-slate-50 flex flex-col">
          <div className="border-b bg-white px-4 py-2 flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Evidence</span>
            {selectedEvaluation?.evidence_summary && (
              <span className="text-xs text-muted-foreground truncate">— {selectedEvaluation.evidence_summary.slice(0, 60)}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {selectedEvaluation?.evidence_summary ? (
              <div className="p-4 space-y-3">
                <div className="rounded-lg border bg-white p-3">
                  <p className="text-xs text-muted-foreground mb-1">Evidence excerpt</p>
                  <p className="text-sm italic">&ldquo;{selectedEvaluation.evidence_summary}&rdquo;</p>
                </div>
                {evidenceRegions.length === 0 && (
                  <div className="flex items-center gap-1.5 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Visual location unavailable — text-only evidence for this document format.
                  </div>
                )}
              </div>
            ) : (
              <EvidenceViewer region={primaryRegion} documents={documents} />
            )}
          </div>
        </div>

        {/* Right: Finding inspector */}
        <div className="w-96 shrink-0 bg-white flex flex-col overflow-hidden">
          <div className="border-b px-4 py-2 flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Finding Inspector</span>
          </div>
          <div className="flex-1 overflow-y-auto">
            <FindingInspector
              requirement={selectedRequirement}
              finding={selectedFinding ?? null}
              conditions={conditions}
              evaluations={evaluations}
              reviewId={reviewId}
              onActionComplete={handleActionComplete}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
