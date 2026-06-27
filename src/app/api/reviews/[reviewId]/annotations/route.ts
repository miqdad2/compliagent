import { NextResponse } from "next/server";
import { canModifyHumanReview } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AnnotationPreparationService } from "@/server/services/annotations/annotation-preparation";
import { PdfLibAnnotationRenderer } from "@/server/services/annotations/pdf-lib-renderer";
import type { AnnotationInput } from "@/server/services/annotations/annotation-preparation";
import type { ComplianceStatus } from "@/types/domain";
import type { BoundingBox } from "@/lib/documents/coordinates";

export const runtime = "nodejs";

/**
 * GET /api/reviews/[reviewId]/annotations
 * Returns existing annotation output drafts for this review.
 *
 * POST /api/reviews/[reviewId]/annotations
 * Generates an annotation draft for all approved findings in this review.
 * Validates all prerequisites; partial failure excluded (not blocked).
 * Original PDF is never modified.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });

  let profile;
  try { profile = await getCurrentProfile(); } catch { return NextResponse.json({ error: "Auth required." }, { status: 401 }); }
  if (!profile) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { reviewId } = await params;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service unavailable." }, { status: 500 });

  const { data: review } = await admin
    .from("compliance_reviews")
    .select("id, organization_id, project_id")
    .eq("id", reviewId)
    .maybeSingle();

  if (!review) return NextResponse.json({ error: "Review not found." }, { status: 404 });
  if (review.organization_id !== null && review.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  const { data: outputs } = await admin
    .from("annotation_outputs")
    .select("*")
    .eq("review_id", reviewId)
    .neq("draft_status", "superseded")
    .order("created_at", { ascending: false });

  return NextResponse.json({ data: { outputs: outputs ?? [] } });
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: supabaseMissingEnvMessage() ?? "Supabase not configured." }, { status: 500 });

  let profile;
  try { profile = await getCurrentProfile(); } catch { return NextResponse.json({ error: "Auth required." }, { status: 401 }); }
  if (!profile) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!canModifyHumanReview(profile.role)) return NextResponse.json({ error: "Reviewer permission required." }, { status: 403 });

  const { reviewId } = await params;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service unavailable." }, { status: 500 });

  // Load review.
  const { data: review } = await admin
    .from("compliance_reviews")
    .select("*")
    .eq("id", reviewId)
    .maybeSingle();

  if (!review) return NextResponse.json({ error: "Review not found." }, { status: 404 });
  if (review.organization_id !== null && review.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  // Check annotation-ready gate.
  if (!(review as Record<string, unknown>)["annotation_ready"]) {
    return NextResponse.json(
      { error: "Review is not marked ready for annotation. Resolve all blockers first via POST /api/reviews/[reviewId]/ready-for-annotation." },
      { status: 422 }
    );
  }

  // Load approved findings.
  const { data: findings } = await admin
    .from("compliance_findings")
    .select("*")
    .eq("review_id", reviewId)
    .not("reviewed_by", "is", null);

  if (!findings || findings.length === 0) {
    return NextResponse.json({ error: "No approved findings found for this review." }, { status: 422 });
  }

  // Load condition evaluations with evidence for these findings.
  const findingIds = findings.map((f) => f.id);
  const { data: evaluations } = await admin
    .from("condition_evaluations")
    .select("id, finding_id, evidence_summary, requirement_condition_id")
    .in("finding_id", findingIds)
    .eq("is_active", true);

  // Load condition evidence links.
  const evalIds = (evaluations ?? []).map((e) => e.id);
  const { data: evidenceLinks } = evalIds.length > 0
    ? await admin
        .from("condition_evidence_regions")
        .select("condition_evaluation_id, evidence_region_id")
        .in("condition_evaluation_id", evalIds)
        .not("evidence_region_id", "is", null)
    : { data: [] };

  const regionIds = [...new Set((evidenceLinks ?? []).map((l) => l.evidence_region_id).filter(Boolean) as string[])];
  const { data: regions } = regionIds.length > 0
    ? await admin
        .from("evidence_regions")
        .select("*")
        .in("id", regionIds)
    : { data: [] };

  // Build region lookup.
  const regionMap = new Map((regions ?? []).map((r) => [r.id, r]));

  // Load source PDF documents for this project.
  const { data: documents } = await admin
    .from("documents")
    .select("id, storage_path, file_name, mime_type")
    .eq("project_id", review.project_id)
    .eq("mime_type", "application/pdf");

  // For each approved finding, find its primary evidence region.
  const annotations: AnnotationInput[] = [];
  for (const finding of findings) {
    const findingEvals  = (evaluations ?? []).filter((e) => e.finding_id === finding.id);
    const primaryEvalId = findingEvals[0]?.id;
    const primaryLink   = (evidenceLinks ?? []).find((l) => l.condition_evaluation_id === primaryEvalId);
    const region        = primaryLink?.evidence_region_id ? regionMap.get(primaryLink.evidence_region_id) : null;

    const normalizedBox: BoundingBox | null = region && region.normalized_x !== null
      ? { x: region.normalized_x, y: region.normalized_y!, width: region.normalized_width!, height: region.normalized_height! }
      : null;

    annotations.push({
      organizationId:           profile.organization_id,
      projectId:                review.project_id,
      reviewId,
      findingId:                finding.id,
      requirementId:            finding.requirement_id,
      conditionId:              null,
      clauseNumber:             finding.clause_number,
      subClauseNumber:          finding.sub_clause_number,
      finalStatus:              (finding.human_override_status ?? finding.deterministic_derived_status ?? finding.status) as ComplianceStatus,
      approvedReasoning:        finding.reasoning,
      approvedMissingInfo:      finding.missing_information,
      approvedContractorAction: finding.contractor_action,
      evidenceDocumentId:       region?.document_id ?? "",
      evidenceDocumentHash:     region?.source_hash ?? "",
      pageNumber:               region?.page_number ?? 1,
      exactQuote:               region?.extracted_text ?? null,
      evidenceRegionId:         region?.id ?? "",
      normalizedBox,
      coordinateSystem:         region?.coordinate_system ?? "normalized",
      reviewerId:               finding.reviewed_by ?? "",
      approvedAt:               finding.reviewed_at ?? "",
      isSuperseded:             false,
      sourceHashAtApproval:     region?.source_hash ?? ""
    });
  }

  // Group by source document.
  const pdfDocs = (documents ?? []).filter((d) => d.mime_type === "application/pdf");

  if (pdfDocs.length === 0) {
    return NextResponse.json({
      error: "No processed PDF documents found. Only PDF annotation is currently supported.",
      supportedFormats: ["application/pdf"]
    }, { status: 422 });
  }

  const svc = new AnnotationPreparationService();
  const docHashes: Record<string, string> = {};
  const results: Array<Record<string, unknown>> = [];

  // Prepare annotations grouped by document.
  for (const doc of pdfDocs) {
    const docAnnotations = annotations.filter((a) => a.evidenceDocumentId === doc.id);
    if (docAnnotations.length === 0) continue;

    const prepResult = svc.prepare(docAnnotations, reviewId, docHashes);

    if (prepResult.prepared.length === 0) {
      results.push({ documentId: doc.id, status: "skipped", rejectionCount: prepResult.rejected.length, rejected: prepResult.rejected });
      continue;
    }

    try {
      // Supersede any existing draft outputs for this review + document before generating a new one.
      await admin
        .from("annotation_outputs")
        .update({ draft_status: "superseded", updated_at: new Date().toISOString() })
        .eq("review_id", reviewId)
        .eq("source_document_id", doc.id)
        .eq("draft_status", "draft");

      const renderer = new PdfLibAnnotationRenderer(admin);
      const renderResult = await renderer.render({
        organizationId:  profile.organization_id,
        projectId:       review.project_id,
        reviewId,
        sourceStoragePath: doc.storage_path,
        sourceHash:      prepResult.prepared[0]?.input.evidenceDocumentHash ?? "",
        annotations:     prepResult.prepared,
        rendererVersion: "pdf-lib:1.0"
      });

      // Record the output.
      await admin.from("annotation_outputs").insert({
        organization_id:    profile.organization_id,
        project_id:         review.project_id,
        review_id:          reviewId,
        source_document_id: doc.id,
        source_hash:        prepResult.prepared[0]?.input.evidenceDocumentHash ?? "",
        output_storage_path: renderResult.outputStoragePath,
        output_hash:        renderResult.outputHash,
        page_count:         renderResult.pageCount,
        annotation_count:   renderResult.annotationCount,
        renderer_version:   renderResult.rendererVersion,
        contract_version:   prepResult.contractVersion,
        draft_status:       "draft",
        finding_ids:        prepResult.prepared.map((p) => p.input.findingId),
        warnings:           renderResult.warnings,
        created_by:         profile.id
      });

      await admin.from("audit_logs").insert({
        organization_id: profile.organization_id,
        project_id:      review.project_id,
        user_id:         profile.id,
        action:          "annotation.draft_generated",
        entity_type:     "annotation_outputs",
        entity_id:       null,
        metadata: {
          reviewId,
          documentId:      doc.id,
          annotationCount: renderResult.annotationCount,
          warningCount:    renderResult.warnings.length,
          outputHash:      renderResult.outputHash
        }
      });

      results.push({
        documentId: doc.id,
        status:     "generated",
        outputPath: renderResult.outputStoragePath,
        annotationCount: renderResult.annotationCount,
        warningCount:    renderResult.warnings.length,
        rejectionCount:  prepResult.rejected.length,
        rejected:        prepResult.rejected
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Render failed.";
      results.push({ documentId: doc.id, status: "failed", error: msg });
    }
  }

  return NextResponse.json({ data: { reviewId, results } });
}
