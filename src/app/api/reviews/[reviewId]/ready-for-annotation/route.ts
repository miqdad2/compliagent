import { NextResponse } from "next/server";
import { canModifyHumanReview } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type AnnotationBlocker = {
  code:    string;
  message: string;
};

/**
 * GET /api/reviews/[reviewId]/ready-for-annotation
 * Returns the validation status and blockers for the ready-for-annotation gate.
 *
 * POST /api/reviews/[reviewId]/ready-for-annotation
 * Sets the review to ready_for_annotation if all blockers are cleared.
 * Never auto-approves — human reviewer must still approve each finding.
 */

async function buildGateResult(reviewId: string, organizationId: string, admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>) {
  const { data: review } = await admin
    .from("compliance_reviews")
    .select("*")
    .eq("id", reviewId)
    .maybeSingle();

  if (!review) return null;
  if (review.organization_id !== null && review.organization_id !== organizationId) return null;

  const blockers: AnnotationBlocker[] = [];

  // Check: no active processing jobs still running.
  const { count: activeJobs } = await admin
    .from("processing_jobs")
    .select("id", { count: "exact", head: true })
    .eq("review_id", reviewId)
    .in("status", ["queued", "claimed", "running"]);

  if ((activeJobs ?? 0) > 0) {
    blockers.push({ code: "JOBS_RUNNING", message: "Processing jobs are still running for this review." });
  }

  // Check: review is not failed, cancelled or superseded.
  if (["failed", "cancelled", "superseded"].includes(review.status)) {
    blockers.push({ code: "REVIEW_TERMINAL", message: `Review is in a terminal state: ${review.status}.` });
  }

  // Check: all mandatory findings have a reviewer decision.
  const { data: findings } = await admin
    .from("compliance_findings")
    .select("id, status, human_override_status, reviewed_by, risk_level")
    .eq("review_id", reviewId);

  const undecidedMandatory = (findings ?? []).filter(
    (f) => f.risk_level !== "low" && !f.reviewed_by && !f.human_override_status
  );
  if (undecidedMandatory.length > 0) {
    blockers.push({
      code:    "UNDECIDED_FINDINGS",
      message: `${undecidedMandatory.length} high-risk finding(s) have no reviewer decision.`
    });
  }

  // Check: no unresolved citation failures (not_verified without a human override).
  const unverifiedWithoutOverride = (findings ?? []).filter(
    (f) => f.status === "not_verified" && !f.human_override_status
  );
  if (unverifiedWithoutOverride.length > 0) {
    blockers.push({
      code:    "UNRESOLVED_CITATION_FAILURE",
      message: `${unverifiedWithoutOverride.length} finding(s) have unresolved citation failures.`
    });
  }

  // Check: no provisional requirements remain unreviewed.
  const { data: provisionalReqs } = await admin
    .from("extracted_requirements")
    .select("id")
    .eq("review_id", reviewId)
    .eq("requirement_state", "provisional")
    .eq("is_active", true);

  if ((provisionalReqs ?? []).length > 0) {
    blockers.push({
      code:    "PROVISIONAL_REQUIREMENTS",
      message: `${(provisionalReqs ?? []).length} provisional requirement(s) have not been confirmed or rejected.`
    });
  }

  const ready = blockers.length === 0;
  return { review, blockers, ready };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: supabaseMissingEnvMessage() ?? "Supabase not configured." }, { status: 500 });

  let profile;
  try { profile = await getCurrentProfile(); } catch { return NextResponse.json({ error: "Auth required." }, { status: 401 }); }
  if (!profile) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });

  const { reviewId } = await params;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service unavailable." }, { status: 500 });

  const result = await buildGateResult(reviewId, profile.organization_id, admin);
  if (!result) return NextResponse.json({ error: "Review not found or not accessible." }, { status: 404 });

  return NextResponse.json({ data: { ready: result.ready, blockers: result.blockers } });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: supabaseMissingEnvMessage() ?? "Supabase not configured." }, { status: 500 });

  let profile;
  try { profile = await getCurrentProfile(); } catch { return NextResponse.json({ error: "Auth required." }, { status: 401 }); }
  if (!profile) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  if (!canModifyHumanReview(profile.role)) return NextResponse.json({ error: "Reviewer permission required." }, { status: 403 });

  const { reviewId } = await params;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service unavailable." }, { status: 500 });

  const result = await buildGateResult(reviewId, profile.organization_id, admin);
  if (!result) return NextResponse.json({ error: "Review not found or not accessible." }, { status: 404 });

  if (!result.ready) {
    await admin.from("audit_logs").insert({
      organization_id: profile.organization_id,
      project_id:      result.review.project_id,
      user_id:         profile.id,
      action:          "review.ready_for_annotation_blocked",
      entity_type:     "compliance_reviews",
      entity_id:       reviewId,
      metadata:        { blockerCount: result.blockers.length, blockerCodes: result.blockers.map((b) => b.code) }
    });
    return NextResponse.json(
      { error: "Review is not ready for annotation.", blockers: result.blockers },
      { status: 422 }
    );
  }

  // Mark the review as ready for annotation.
  await admin.from("compliance_reviews").update({
    annotation_ready:    true,
    annotation_ready_at: new Date().toISOString(),
    annotation_ready_by: profile.id,
    annotation_blockers: null,
    updated_at:          new Date().toISOString()
  } as Record<string, unknown>).eq("id", reviewId);

  await admin.from("audit_logs").insert({
    organization_id: profile.organization_id,
    project_id:      result.review.project_id,
    user_id:         profile.id,
    action:          "review.ready_for_annotation",
    entity_type:     "compliance_reviews",
    entity_id:       reviewId,
    metadata:        { findingCount: (await admin.from("compliance_findings").select("id", { count: "exact", head: true }).eq("review_id", reviewId)).count ?? 0 }
  });

  return NextResponse.json({ data: { ready: true, blockers: [] } });
}
