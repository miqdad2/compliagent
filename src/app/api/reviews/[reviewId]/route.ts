import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/reviews/[reviewId]
 *
 * Returns the current status and summary of a controlled compliance review.
 * Authenticated and org-scoped — callers can only read reviews for their org.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      { error: supabaseMissingEnvMessage() ?? "Supabase is not configured." },
      { status: 500 }
    );
  }

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load user profile." },
      { status: 500 }
    );
  }

  if (!profile) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  const { reviewId } = await params;
  if (!reviewId || typeof reviewId !== "string") {
    return NextResponse.json({ error: "A reviewId is required." }, { status: 400 });
  }

  // Load review — RLS enforces org scope via the policy added in migration.
  const { data: review, error: reviewError } = await supabase
    .from("compliance_reviews")
    .select("id, organization_id, project_id, title, status, review_version, started_at, completed_at, failed_at, created_at, updated_at")
    .eq("id", reviewId)
    .maybeSingle();

  if (reviewError || !review) {
    return NextResponse.json({ error: "Review not found or not accessible." }, { status: 404 });
  }

  // Server-side org check (defence in depth beyond RLS).
  if (review.organization_id !== null && review.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "You do not have access to this review." }, { status: 403 });
  }

  // Load finding summary.
  const { data: findings } = await supabase
    .from("compliance_findings")
    .select("id, status, confidence_score, risk_level")
    .eq("review_id", reviewId);

  const findingList = findings ?? [];
  const statusCounts: Record<string, number> = {};
  for (const f of findingList) {
    statusCounts[f.status] = (statusCounts[f.status] ?? 0) + 1;
  }

  return NextResponse.json({
    data: {
      reviewId:      review.id,
      projectId:     review.project_id,
      title:         review.title,
      status:        review.status,
      reviewVersion: review.review_version,
      startedAt:     review.started_at,
      completedAt:   review.completed_at,
      failedAt:      review.failed_at,
      createdAt:     review.created_at,
      updatedAt:     review.updated_at,
      findingCount:  findingList.length,
      statusCounts
    }
  });
}
