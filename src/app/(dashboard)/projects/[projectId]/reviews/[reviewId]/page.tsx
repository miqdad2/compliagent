import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/permissions/server";
import { canRunReview } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ReviewWorkspace } from "@/components/reviews/review-workspace";
import { ReviewProgressPage } from "@/components/reviews/review-progress-page";

type ReviewWorkspacePageProps = {
  params: Promise<{ projectId: string; reviewId: string }>;
};

/**
 * /projects/[projectId]/reviews/[reviewId]
 *
 * Shows a progress page when the review is in "draft" or "running" status,
 * or the three-panel human review workspace when ready for human verification.
 */
export default async function ReviewWorkspacePage({ params }: ReviewWorkspacePageProps) {
  const { projectId, reviewId } = await params;

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch {
    redirect("/login");
  }

  if (!profile) redirect("/login");
  if (!canRunReview(profile.role)) redirect(`/projects/${projectId}`);

  const admin = createSupabaseAdminClient();
  if (!admin) notFound();

  const { data: review } = await admin
    .from("compliance_reviews")
    .select("*")
    .eq("id", reviewId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!review) notFound();
  if (review.organization_id !== null && review.organization_id !== profile.organization_id) notFound();

  // Read execution_mode from the DB (added in migration 20260702000000).
  // Fallback: if the column doesn't exist yet (migration not applied), default to deterministic.
  const executionMode =
    (review as Record<string, unknown>)["execution_mode"] as string | null ?? "deterministic";

  // For draft or running reviews, show the progress/execution page.
  if (review.status === "draft" || review.status === "running") {
    return (
      <ReviewProgressPage
        reviewId={reviewId}
        projectId={projectId}
        reviewTitle={review.title}
        reviewStatus={review.status}
        executionMode={executionMode}
      />
    );
  }

  // ── Human verification workspace ──────────────────────────────────────────

  const [
    { data: requirements },
    { data: findings },
    { data: documents },
    { data: aiRunData }
  ] = await Promise.all([
    admin
      .from("extracted_requirements")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .neq("requirement_state", "rejected")
      .order("clause_number", { ascending: true, nullsFirst: false }),
    admin
      .from("compliance_findings")
      .select("*")
      .eq("review_id", reviewId)
      .order("clause_number", { ascending: true, nullsFirst: false }),
    admin
      .from("documents")
      .select("id, file_name, document_role, processing_status, page_count")
      .eq("project_id", projectId),
    admin
      .from("ai_runs")
      .select("id", { count: "exact", head: true })
      .eq("review_id", reviewId)
  ]);

  const requirementIds = (requirements ?? []).map((r: { id: string }) => r.id);
  const findingIds     = (findings ?? []).map((f: { id: string }) => f.id);

  const [{ data: conditions }, { data: evaluations }] = await Promise.all([
    requirementIds.length > 0
      ? admin
          .from("requirement_conditions")
          .select("*")
          .in("requirement_id", requirementIds)
          .eq("is_active", true)
          .order("condition_order", { ascending: true })
      : { data: [] },
    findingIds.length > 0
      ? admin
          .from("condition_evaluations")
          .select("*")
          .eq("review_id", reviewId)
          .eq("is_active", true)
          .order("created_at", { ascending: true })
      : { data: [] }
  ]);

  const evalIds = (evaluations ?? []).map((e: { id: string }) => e.id);
  const { data: evidenceLinks } = evalIds.length > 0
    ? await admin
        .from("condition_evidence_regions")
        .select("condition_evaluation_id, evidence_region_id")
        .in("condition_evaluation_id", evalIds)
        .not("evidence_region_id", "is", null)
    : { data: [] };

  const regionIds = [
    ...new Set(
      (evidenceLinks ?? [])
        .map((l: { evidence_region_id: string | null }) => l.evidence_region_id)
        .filter((id): id is string => id !== null)
    )
  ];
  const { data: evidenceRegions } = regionIds.length > 0
    ? await admin
        .from("evidence_regions")
        .select("id, document_id, page_number, slide_number, sheet_name, cell_range, coordinate_system, extracted_text, x, y, width, height")
        .in("id", regionIds)
    : { data: [] };

  const requirementList = requirements ?? [];
  const findingList     = findings ?? [];

  const statusCounts: Record<string, number> = {};
  let humanReviewRequired = 0;
  for (const f of findingList) {
    const s = (f as Record<string, unknown>)["status"] as string;
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    if (!(f as Record<string, unknown>)["reviewed_by"]) humanReviewRequired++;
  }

  const provisionalCount = requirementList.filter(
    (r: Record<string, unknown>) => r["requirement_state"] === "provisional"
  ).length;
  const confirmedCount = requirementList.filter(
    (r: Record<string, unknown>) => r["requirement_state"] === "confirmed"
  ).length;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <ReviewWorkspace
        reviewId={reviewId}
        projectId={projectId}
        reviewTitle={review.title}
        reviewStatus={review.status}
        executionMode={executionMode}
        requirements={requirementList as Parameters<typeof ReviewWorkspace>[0]["requirements"]}
        conditions={(conditions ?? []) as Parameters<typeof ReviewWorkspace>[0]["conditions"]}
        findings={findingList as Parameters<typeof ReviewWorkspace>[0]["findings"]}
        evaluations={(evaluations ?? []) as Parameters<typeof ReviewWorkspace>[0]["evaluations"]}
        evidenceLinks={(evidenceLinks ?? []) as Parameters<typeof ReviewWorkspace>[0]["evidenceLinks"]}
        evidenceRegions={(evidenceRegions ?? []) as Parameters<typeof ReviewWorkspace>[0]["evidenceRegions"]}
        documents={(documents ?? []) as Parameters<typeof ReviewWorkspace>[0]["documents"]}
        summary={{
          aiRunCount:               (aiRunData as unknown as { count: number } | null)?.count ?? 0,
          findingCount:             findingList.length,
          requirementCount:         requirementList.length,
          provisionalCount,
          confirmedCount,
          humanReviewRequiredCount: humanReviewRequired,
          statusCounts
        }}
      />
    </div>
  );
}
