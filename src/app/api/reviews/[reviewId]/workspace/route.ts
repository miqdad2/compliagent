import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/reviews/[reviewId]/workspace
 *
 * Returns full review workspace data including requirements, conditions,
 * findings, and condition evaluations for the human review UI.
 *
 * Authenticated + org-scoped. Never exposes API keys, prompts, or raw JSON.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: supabaseMissingEnvMessage() ?? "Supabase is not configured." }, { status: 500 });
  }

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load user profile." }, { status: 500 });
  }
  if (!profile) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });

  const { reviewId } = await params;
  if (!reviewId) return NextResponse.json({ error: "reviewId is required." }, { status: 400 });

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: supabaseMissingEnvMessage({ requireServiceRole: true }) ?? "Service unavailable." }, { status: 500 });
  }

  // Load review with org scope check.
  const { data: review, error: reviewError } = await admin
    .from("compliance_reviews")
    .select("*")
    .eq("id", reviewId)
    .maybeSingle();

  if (reviewError || !review) {
    return NextResponse.json({ error: "Review not found." }, { status: 404 });
  }

  if (review.organization_id !== null && review.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "You do not have access to this review." }, { status: 403 });
  }

  // Load findings.
  const { data: findings } = await admin
    .from("compliance_findings")
    .select("*")
    .eq("review_id", reviewId)
    .order("clause_number", { ascending: true, nullsFirst: false });

  // Load active requirements for this project.
  const { data: requirements } = await admin
    .from("extracted_requirements")
    .select("*")
    .eq("project_id", review.project_id)
    .eq("is_active", true)
    .neq("requirement_state", "rejected")
    .order("clause_number", { ascending: true, nullsFirst: false });

  // Load conditions for all requirements that have findings.
  const requirementIds = (requirements ?? []).map((r) => r.id);
  const { data: conditions } = requirementIds.length > 0
    ? await admin
        .from("requirement_conditions")
        .select("*")
        .in("requirement_id", requirementIds)
        .eq("is_active", true)
        .order("condition_order", { ascending: true })
    : { data: [] };

  // Load condition evaluations for all findings.
  const findingIds = (findings ?? []).map((f) => f.id);
  const { data: evaluations } = findingIds.length > 0
    ? await admin
        .from("condition_evaluations")
        .select("*")
        .eq("review_id", reviewId)
        .eq("is_active", true)
        .order("created_at", { ascending: true })
    : { data: [] };

  // Load condition evidence links.
  const evalIds = (evaluations ?? []).map((e) => e.id);
  const { data: evidenceLinks } = evalIds.length > 0
    ? await admin
        .from("condition_evidence_regions")
        .select("*")
        .in("condition_evaluation_id", evalIds)
    : { data: [] };

  // Load evidence regions for the project.
  const regionIds = [
    ...new Set(
      (evidenceLinks ?? [])
        .map((l) => l.evidence_region_id)
        .filter((id): id is string => id !== null)
    )
  ];
  const { data: evidenceRegions } = regionIds.length > 0
    ? await admin
        .from("evidence_regions")
        .select("*")
        .in("id", regionIds)
    : { data: [] };

  // Load source documents.
  const { data: documents } = await admin
    .from("documents")
    .select("id, file_name, document_role, processing_status, page_count")
    .eq("project_id", review.project_id);

  // Count AI runs for this review.
  const { count: aiRunCount } = await admin
    .from("ai_runs")
    .select("id", { count: "exact", head: true })
    .eq("review_id", reviewId);

  // Build status summary.
  const findingList = findings ?? [];
  const statusCounts: Record<string, number> = {};
  let humanReviewRequiredCount = 0;
  for (const f of findingList) {
    statusCounts[f.status] = (statusCounts[f.status] ?? 0) + 1;
    if (!f.human_override_status && !f.reviewed_at) humanReviewRequiredCount++;
  }

  const requirementList = requirements ?? [];
  const provisionalCount = requirementList.filter((r) => r.requirement_state === "provisional").length;
  const confirmedCount   = requirementList.filter((r) => r.requirement_state === "confirmed").length;

  return NextResponse.json({
    data: {
      review: {
        id:               review.id,
        projectId:        review.project_id,
        title:            review.title,
        status:           review.status,
        executionMode:    review.prompt_version ? "controlled_live" : "deterministic",
        reviewVersion:    review.review_version,
        startedAt:        review.started_at,
        completedAt:      review.completed_at,
        annotationReady:  (review as Record<string, unknown>)["annotation_ready"] ?? false
      },
      documents:        documents ?? [],
      requirements:     requirementList,
      conditions:       conditions ?? [],
      findings:         findingList,
      evaluations:      evaluations ?? [],
      evidenceLinks:    evidenceLinks ?? [],
      evidenceRegions:  evidenceRegions ?? [],
      summary: {
        aiRunCount:              aiRunCount ?? 0,
        findingCount:            findingList.length,
        requirementCount:        requirementList.length,
        provisionalCount,
        confirmedCount,
        humanReviewRequiredCount,
        statusCounts
      }
    }
  });
}
