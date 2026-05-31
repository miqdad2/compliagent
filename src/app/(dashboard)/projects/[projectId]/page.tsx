import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileText, MessageSquareText } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ComplianceMatrix, type ComplianceMatrixRow } from "@/components/compliance/compliance-matrix";
import { DocumentProcessButton } from "@/components/documents/document-process-button";
import { ProjectDocumentChat } from "@/components/documents/project-document-chat";
import { DocumentUploadForm } from "@/components/documents/document-upload-form";
import { documentRoleLabels } from "@/lib/documents/roles";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { ReviewRunButton } from "@/components/compliance/review-run-button";
import {
  getProject,
  listProjectDocuments,
  listProjectReviews,
  listReviewClarifications,
  listReviewFindings
} from "@/server/services/projects";

type ProjectDetailPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectDetailPage({ params }: ProjectDetailPageProps) {
  const { projectId } = await params;
  const project = await getProject(projectId);

  if (!project) {
    notFound();
  }

  const documents = await listProjectDocuments(projectId);
  const reviews = await listProjectReviews(projectId);
  const latestReview = reviews[0] ?? null;
  const findings = latestReview ? await listReviewFindings(latestReview.id) : [];
  const clarifications = latestReview ? await listReviewClarifications(latestReview.id) : [];
  const completedDocuments = documents.filter((document) => document.processing_status === "completed");
  const hasRequirementDocument = completedDocuments.some((document) =>
    ["main_specification", "reference_standard", "compliance_statement"].includes(document.document_role) || isClientRequirementDoc(document.file_name)
  );
  const hasEvidenceDocument = completedDocuments.some((document) =>
    ["proposed_product", "product_datasheet", "certificate", "drawing", "manual", "supporting_evidence", "other"].includes(
      document.document_role
    ) || isClientEvidenceDoc(document.file_name)
  );
  const clientMinimumDocs = {
    doc1: completedDocuments.some((document) => inferClientDocumentNumber(document.file_name) === 1),
    doc2: completedDocuments.some((document) => inferClientDocumentNumber(document.file_name) === 2),
    doc3: completedDocuments.some((document) => inferClientDocumentNumber(document.file_name) === 3),
    doc4: completedDocuments.some((document) => inferClientDocumentNumber(document.file_name) === 4)
  };
  const hasClientMinimumPackage =
    clientMinimumDocs.doc1 && clientMinimumDocs.doc2 && clientMinimumDocs.doc3 && clientMinimumDocs.doc4;
  const canRunReview = hasRequirementDocument && hasEvidenceDocument;
  const defaultReviewBrief = hasClientMinimumPackage
    ? [
        "Compare Doc. 4, the proposed speaker, with Doc. 1 Specifications and provide clause/sub-clause compliance status for all technical and functional aspects.",
        "List Doc. 1 items that are partly met or ambiguous and assign weightage from 1-10.",
        "Identify applicable Doc. 2 technical, functional, and standards clauses for active speakers and compare them with Doc. 4.",
        "Compare Doc. 4 speaker power supply technicality with relevant Doc. 3 sections.",
        "Provide a clear final recommendation: technically accepted, accepted with conditions, or rejected. If Doc. 4 significantly exceeds the tender requirements, note whether a more cost-effective compliant model could be considered without sacrificing quality."
      ].join("\n")
    : "";
  const matrixRows: ComplianceMatrixRow[] = findings.map((finding) => ({
    id: finding.id,
    clauseNumber: finding.clause_number,
    requirementText: finding.requirement_text,
    evidenceText: finding.evidence_text,
    status: finding.status,
    weightageScore: finding.weightage_score,
    confidenceScore: finding.confidence_score,
    riskLevel: finding.risk_level,
    reasoning: finding.reasoning,
    missingInformation: finding.missing_information,
    contractorAction: finding.contractor_action,
    humanComment: finding.human_comment,
    humanOverrideStatus: finding.human_override_status
  }));
  const recommendation = extractRecommendation(latestReview?.review_scope ?? null);
  const compliedCount = findings.filter((finding) => finding.status === "complied").length;
  const partialCount = findings.filter((finding) => finding.status === "partially_complied").length;
  const notCompliedCount = findings.filter((finding) => finding.status === "not_complied").length;
  const ambiguousCount = findings.filter((finding) =>
    ["ambiguous_not_proven", "not_verified"].includes(finding.status)
  ).length;
  const humanReviewCount = findings.filter(
    (finding) => finding.confidence_score < 70 || finding.status !== "complied"
  ).length;
  const totalPages = completedDocuments.reduce((total, document) => total + (document.page_count ?? 0), 0);
  const openFindings = findings.filter((finding) => !["complied", "not_applicable"].includes(finding.status));
  const criticalOpenCount = openFindings.filter((finding) => finding.risk_level === "critical").length;
  const lowConfidenceCount = findings.filter((finding) => finding.confidence_score < 70).length;
  const topClarifications = [...clarifications]
    .sort((left, right) => priorityRank(left.priority) - priorityRank(right.priority))
    .slice(0, 3);
  const hasDocuments = documents.length > 0;
  const shouldPrioritizeUpload = !hasClientMinimumPackage;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div className="mb-2">
            <ProjectStatusBadge status={project.status} />
          </div>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.client_name} - {project.discipline} - {project.review_type}
          </p>
        </div>
      </div>

      {shouldPrioritizeUpload ? (
        <Card>
          <CardHeader>
            <CardTitle>{hasDocuments ? "Continue uploading required documents" : "Start with document upload"}</CardTitle>
            <CardDescription>
              Upload the specification, standards, proposed product, and supporting evidence before running any review.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 lg:grid-cols-[420px_minmax(0,1fr)]">
            <DocumentUploadForm projectId={projectId} />
            <div className="rounded-md border border-dashed bg-slate-50/70 p-5">
              <p className="font-medium">Recommended first upload sequence</p>
              <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <MinimumItem complete={false}>Doc. 1 specification</MinimumItem>
                <MinimumItem complete={false}>Doc. 2 reference standard</MinimumItem>
                <MinimumItem complete={false}>Doc. 3 power supply reference</MinimumItem>
                <MinimumItem complete={false}>Doc. 4 proposed product evidence</MinimumItem>
              </div>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">
                After upload, each file appears in the document register with a Process action. The review and verified chat unlock only
                after the required documents are processed.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <main className="space-y-6">
          {hasDocuments ? (
            <Card>
              <CardHeader>
                <CardTitle>Document register</CardTitle>
                <CardDescription>Process each uploaded file before trusting the review or chat answers.</CardDescription>
              </CardHeader>
              <CardContent>
                <DocumentRegister documents={documents} />
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Review summary</CardTitle>
              <CardDescription>
                Start here. The detailed evidence is still available, but the decision, open risks, and contractor actions come first.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {latestReview ? (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
                  <div className="rounded-md border bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Draft AI recommendation</p>
                    <p className="mt-2 text-xl font-semibold">{recommendation ?? "Pending recommendation"}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      This is a draft technical recommendation. Final approval remains with the responsible engineer or reviewer.
                    </p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <ReviewStep icon={<FileText className="h-4 w-4" />} title="1. Verify evidence" detail="Check cited pages and clauses." />
                      <ReviewStep icon={<MessageSquareText className="h-4 w-4" />} title="2. Ask contractor" detail="Send clarification items." />
                      <ReviewStep icon={<CheckCircle2 className="h-4 w-4" />} title="3. Approve final" detail="Engineer signs off after closure." />
                    </div>
                  </div>
                  <div className="rounded-md border p-4">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">Client risk snapshot</p>
                    <div className="mt-3 space-y-3 text-sm">
                      <RiskLine label="Open findings" value={openFindings.length} tone={openFindings.length > 0 ? "amber" : "green"} />
                      <RiskLine label="Critical open items" value={criticalOpenCount} tone={criticalOpenCount > 0 ? "red" : "green"} />
                      <RiskLine label="Below 70% confidence" value={lowConfidenceCount} tone={lowConfidenceCount > 0 ? "gray" : "green"} />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-5">
                  <p className="font-medium">Upload and process the four demo documents, then run the review.</p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    After processing, CompliAgent will show a short decision summary, open clarification items, and source-backed
                    finding cards. The full matrix stays available for audit.
                  </p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                <SummaryMetric label="Complied" value={compliedCount} tone="green" />
                <SummaryMetric label="Partial" value={partialCount} tone="amber" />
                <SummaryMetric label="Not complied" value={notCompliedCount} tone="red" />
                <SummaryMetric label="Ambiguous" value={ambiguousCount} tone="purple" />
                <SummaryMetric label="Human review" value={humanReviewCount} tone="gray" />
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Extraction coverage</p>
                  <p className="mt-2 text-sm">{completedDocuments.length} processed document(s), {totalPages} page(s)</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Generated findings</p>
                  <p className="mt-2 text-sm">{findings.length} source-backed draft finding(s)</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Clarifications</p>
                  <p className="mt-2 text-sm">{clarifications.length} contractor action item(s)</p>
                </div>
              </div>

              {topClarifications.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50/60 p-4">
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                    <div>
                      <p className="font-medium">Next contractor response should close these first</p>
                      <div className="mt-3 grid gap-2 lg:grid-cols-3">
                        {topClarifications.map((clarification, index) => (
                          <div key={clarification.id} className="rounded-md bg-white p-3 text-sm">
                            <Badge tone={clarification.priority === "Critical" ? "red" : "amber"}>
                              {clarification.priority}
                            </Badge>
                            <p className="mt-2 font-medium">Item {index + 1}</p>
                            <p className="mt-1 leading-5 text-muted-foreground">{clarification.issue}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>

          {clarifications.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Contractor clarification list</CardTitle>
                <CardDescription>Give this list to the contractor before resubmission.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {clarifications.map((clarification, index) => (
                    <div key={clarification.id} className="rounded-md border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="gray">Item {index + 1}</Badge>
                        <Badge tone="gray">Clause {clarification.clause_number ?? "not identified"}</Badge>
                        <Badge
                          tone={
                            clarification.priority === "Critical"
                              ? "red"
                              : clarification.priority === "High"
                                ? "amber"
                                : "gray"
                          }
                        >
                          {clarification.priority}
                        </Badge>
                      </div>
                      <p className="mt-3 font-medium">{clarification.issue}</p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{clarification.why_it_matters}</p>
                      <p className="mt-3 text-sm leading-6">
                        <span className="font-medium">Required action: </span>
                        {clarification.required_action}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        <span className="font-medium">Evidence: </span>
                        {clarification.required_document}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Findings with evidence</CardTitle>
              <CardDescription>
                Each card shows the requirement source, matching evidence source, status, score, confidence, and contractor action.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {matrixRows.length === 0 ? (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  No compliance findings yet. Process documents and run a review to generate the draft matrix.
                </div>
              ) : (
                <ComplianceMatrix rows={matrixRows} />
              )}
            </CardContent>
          </Card>

        </main>

        <aside className="space-y-6 xl:sticky xl:top-4">
          {hasClientMinimumPackage ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Verified document assistant</CardTitle>
                  <CardDescription>Ask about the decision, missing evidence, contractor actions, or exact cited sources.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ProjectDocumentChat projectId={projectId} disabled={completedDocuments.length === 0} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Run assessment</CardTitle>
                  <CardDescription>
                    Keep the scope as-is unless the reviewer wants to change what should be compared.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <ReviewRunButton projectId={projectId} disabled={!canRunReview} defaultReviewBrief={defaultReviewBrief} />
                  {!canRunReview ? (
                    <p className="text-sm text-muted-foreground">
                      Process Doc. 1, Doc. 2, Doc. 3, and Doc. 4, or assign at least one requirement document and one evidence document.
                    </p>
                  ) : null}
                  {latestReview ? (
                    <div className="rounded-md border bg-muted/30 p-3 text-sm">
                      <p className="font-medium">{latestReview.title}</p>
                      <p className="mt-1 text-muted-foreground">{latestReview.status.replaceAll("_", " ")}</p>
                      {recommendation ? <p className="mt-2 font-medium">{recommendation}</p> : null}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Readiness checklist</CardTitle>
              <CardDescription>These checks must be complete before trusting the review output.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <MinimumItem complete={clientMinimumDocs.doc1}>Doc. 1 specification processed.</MinimumItem>
              <MinimumItem complete={clientMinimumDocs.doc2}>Doc. 2 standard processed.</MinimumItem>
              <MinimumItem complete={clientMinimumDocs.doc3}>Doc. 3 power supply reference processed.</MinimumItem>
              <MinimumItem complete={clientMinimumDocs.doc4}>Doc. 4 proposed speaker processed.</MinimumItem>
              <MinimumItem complete={hasClientMinimumPackage}>All demo documents are ready for review.</MinimumItem>
            </CardContent>
          </Card>
          {!shouldPrioritizeUpload ? <DocumentUploadForm projectId={projectId} /> : null}
          <Card>
            <CardHeader>
              <CardTitle>Processing pipeline</CardTitle>
              <CardDescription>Phase 1 queues extraction jobs and preserves source references.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>1. File type detection and validation</p>
              <p>2. Text/OCR/table extraction adapters</p>
              <p>3. Page-aware chunking and metadata storage</p>
              <p>4. Requirement, evidence, standards and comparison agents</p>
              <p>5. Reviewer validation before human approval</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function MinimumItem({ complete, children }: { complete: boolean; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <Badge tone={complete ? "green" : "gray"}>{complete ? "Ready" : "Missing"}</Badge>
      <span className="text-muted-foreground">{children}</span>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: "green" | "amber" | "red" | "purple" | "gray";
}) {
  return (
    <div className="rounded-md border p-3">
      <Badge tone={tone}>{label}</Badge>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function DocumentRegister({ documents }: { documents: Awaited<ReturnType<typeof listProjectDocuments>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b text-xs uppercase text-muted-foreground">
          <tr>
            <th className="py-3 pr-4">File</th>
            <th className="py-3 pr-4">Role</th>
            <th className="py-3 pr-4">Pages</th>
            <th className="py-3 pr-4">Processing</th>
            <th className="py-3 pr-4">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {documents.map((document) => (
            <tr key={document.id}>
              <td className="py-3 pr-4 font-medium">{document.file_name}</td>
              <td className="py-3 pr-4">
                <div>{documentRoleLabels[document.document_role]}</div>
                {describeClientDocumentRole(document.file_name) ? (
                  <div className="mt-1 text-xs text-muted-foreground">{describeClientDocumentRole(document.file_name)}</div>
                ) : null}
              </td>
              <td className="py-3 pr-4">{document.page_count ?? "-"}</td>
              <td className="py-3 pr-4">
                <Badge
                  tone={
                    document.processing_status === "completed"
                      ? "green"
                      : document.processing_status === "failed"
                        ? "red"
                        : "gray"
                  }
                >
                  {document.processing_status.replaceAll("_", " ")}
                </Badge>
              </td>
              <td className="py-3 pr-4">
                {document.processing_status === "running" ? null : (
                  <DocumentProcessButton
                    documentId={document.id}
                    label={document.processing_status === "completed" ? "Reprocess" : "Process"}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewStep({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="rounded-md border bg-white p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="text-primary">{icon}</span>
        <span>{title}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function RiskLine({ label, value, tone }: { label: string; value: number; tone: "green" | "amber" | "red" | "gray" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </div>
  );
}

function priorityRank(priority: "Critical" | "High" | "Medium" | "Low") {
  switch (priority) {
    case "Critical":
      return 0;
    case "High":
      return 1;
    case "Medium":
      return 2;
    case "Low":
      return 3;
  }
}

function inferClientDocumentNumber(fileName: string) {
  const normalized = fileName.toLowerCase();
  const match = normalized.match(/\bdoc(?:ument)?\.?\s*-?\s*(\d+)\b/) ?? normalized.match(/\bdoc\.-?(\d+)\b/);
  return match?.[1] ? Number(match[1]) : null;
}

function isClientRequirementDoc(fileName: string) {
  return [1, 2, 3].includes(inferClientDocumentNumber(fileName) ?? 0);
}

function isClientEvidenceDoc(fileName: string) {
  const normalized = fileName.toLowerCase();
  return inferClientDocumentNumber(fileName) === 4 || normalized.includes("proposed");
}

function describeClientDocumentRole(fileName: string) {
  switch (inferClientDocumentNumber(fileName)) {
    case 1:
      return "Detected client Doc. 1 - Specifications";
    case 2:
      return "Detected client Doc. 2 - Applicable standard";
    case 3:
      return "Detected client Doc. 3 - Power supply standard";
    case 4:
      return "Detected client Doc. 4 - Proposed speaker evidence";
    default:
      return null;
  }
}

function extractRecommendation(scope: string | null) {
  return scope?.match(/Recommendation:\s*([^\n]+)/)?.[1] ?? null;
}
