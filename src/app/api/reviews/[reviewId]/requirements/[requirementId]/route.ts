import { NextResponse } from "next/server";
import { z } from "zod";
import { canModifyHumanReview } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProvisionalRequirementService } from "@/server/services/reviews/provisional-requirements";
import { SupabaseProvisionalRequirementGateway } from "@/server/services/reviews/provisional-requirement-gateway";

export const runtime = "nodejs";

const patchSchema = z
  .object({
    action:        z.enum(["confirm", "reject"]),
    normalizedText: z.string().min(1).optional(),
    reason:        z.string().min(1).optional()
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.action === "reject" && !val.reason) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "A reason is required when rejecting a requirement." });
    }
  });

/**
 * PATCH /api/reviews/[reviewId]/requirements/[requirementId]
 *
 * Confirm or reject a provisional requirement.
 * Requires authentication and reviewer permission.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reviewId: string; requirementId: string }> }
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
  if (!canModifyHumanReview(profile.role)) {
    return NextResponse.json({ error: "You do not have permission to confirm requirements." }, { status: 403 });
  }

  const { reviewId, requirementId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body.", details: parsed.error.format() }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: supabaseMissingEnvMessage({ requireServiceRole: true }) ?? "Service unavailable." }, { status: 500 });
  }

  // Verify review org scope.
  const { data: review } = await admin
    .from("compliance_reviews")
    .select("id, organization_id, project_id")
    .eq("id", reviewId)
    .maybeSingle();

  if (!review) return NextResponse.json({ error: "Review not found." }, { status: 404 });
  if (review.organization_id !== null && review.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "You do not have access to this review." }, { status: 403 });
  }

  const gateway = new SupabaseProvisionalRequirementGateway(admin);
  const svc     = new ProvisionalRequirementService(gateway);

  try {
    let updated;
    if (parsed.data.action === "confirm") {
      updated = await svc.confirm({
        requirementId,
        organizationId: profile.organization_id,
        projectId:      review.project_id,
        reviewId,
        reviewerId:     profile.id,
        normalizedText: parsed.data.normalizedText
      });
    } else {
      updated = await svc.reject({
        requirementId,
        organizationId: profile.organization_id,
        projectId:      review.project_id,
        reviewId,
        reviewerId:     profile.id,
        reason:         parsed.data.reason!
      });
    }
    return NextResponse.json({ data: { requirement: updated } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Could not update requirement.";
    return NextResponse.json({ error: msg }, { status: 422 });
  }
}
