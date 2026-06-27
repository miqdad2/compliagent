import { NextResponse } from "next/server";
import { z } from "zod";
import { canModifyHumanReview } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ComplianceStatus } from "@/types/domain";

export const runtime = "nodejs";

const POSITIVE_STATUSES: ComplianceStatus[] = ["complied", "exceeds_requirement"];
const EXPLANATION_STATUSES: ComplianceStatus[] = [
  "not_complied", "not_proven", "ambiguous", "not_verified", "partially_complied"
];

const patchSchema = z
  .object({
    action:              z.enum(["approve", "reject", "update"]),
    status:              z.string().optional(),
    reasoning:           z.string().min(1).optional(),
    missingInformation:  z.string().optional(),
    contractorAction:    z.string().optional(),
    reviewerComment:     z.string().optional(),
    overrideReason:      z.string().optional()
  })
  .strict();

type FindingRow = {
  id: string;
  review_id: string;
  project_id: string;
  organization_id: string | null;
  status: string;
  human_override_status: string | null;
  evidence_text: string | null;
  deterministic_derived_status: string | null;
  confidence_score: number;
};

/**
 * PATCH /api/reviews/[reviewId]/findings/[findingId]
 *
 * Supports actions: approve, reject, update (edit without final approval).
 *
 * Approval rules:
 * - COMPLIED / EXCEEDS_REQUIREMENT: requires evidence (evidence_text or condition evaluations with complied status)
 * - NOT_PROVEN / AMBIGUOUS / etc.: requires reasoning
 * - Verifier override requires overrideReason
 * - Human-approved findings are never silently overwritten by AI reruns
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reviewId: string; findingId: string }> }
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
    return NextResponse.json({ error: "You do not have permission to review findings." }, { status: 403 });
  }

  const { reviewId, findingId } = await params;
  const body = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body.", details: parsed.error.format() }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: supabaseMissingEnvMessage({ requireServiceRole: true }) ?? "Service unavailable." }, { status: 500 });
  }

  // Load review to verify org scope.
  const { data: review } = await admin
    .from("compliance_reviews")
    .select("id, organization_id, project_id, status")
    .eq("id", reviewId)
    .maybeSingle();

  if (!review) return NextResponse.json({ error: "Review not found." }, { status: 404 });
  if (review.organization_id !== null && review.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "You do not have access to this review." }, { status: 403 });
  }

  // Load finding.
  const { data: finding } = await admin
    .from("compliance_findings")
    .select("*")
    .eq("id", findingId)
    .eq("review_id", reviewId)
    .maybeSingle();

  if (!finding) return NextResponse.json({ error: "Finding not found." }, { status: 404 });

  const f = finding as unknown as FindingRow;
  const { action, status, reasoning, missingInformation, contractorAction, reviewerComment, overrideReason } = parsed.data;

  // Validate approval prerequisites.
  if (action === "approve" || (action === "update" && status)) {
    const effectiveStatus = (status ?? f.human_override_status ?? f.status) as ComplianceStatus;

    if (POSITIVE_STATUSES.includes(effectiveStatus)) {
      const hasEvidence = f.evidence_text ||
        (await admin
          .from("condition_evaluations")
          .select("id", { count: "exact", head: true })
          .eq("finding_id", findingId)
          .in("status", ["complied", "exceeds_requirement"])
          .eq("is_active", true)
          .then(({ count }) => (count ?? 0) > 0));
      if (!hasEvidence) {
        return NextResponse.json(
          { error: `Status "${effectiveStatus}" requires at least one complied condition evaluation with linked evidence.` },
          { status: 422 }
        );
      }
    }

    if (EXPLANATION_STATUSES.includes(effectiveStatus) && !reasoning && !f.deterministic_derived_status) {
      return NextResponse.json(
        { error: `Status "${effectiveStatus}" requires a reasoning explanation.` },
        { status: 422 }
      );
    }
  }

  const now = new Date().toISOString();
  const update: Record<string, unknown> = { updated_at: now };

  if (action === "approve") {
    update.human_override_status = (status ?? f.human_override_status ?? f.status) as ComplianceStatus;
    update.reviewed_by           = profile.id;
    update.reviewed_at           = now;
    if (reasoning)          update.reasoning = reasoning;
    if (reviewerComment)    update.reviewer_comment = reviewerComment;
    if (missingInformation !== undefined) update.missing_information = missingInformation;
    if (contractorAction   !== undefined) update.contractor_action = contractorAction;
    if (overrideReason)     update.human_comment = overrideReason;
  } else if (action === "reject") {
    update.human_override_status = "not_complied";
    update.reviewed_by           = profile.id;
    update.reviewed_at           = now;
    if (reviewerComment) update.reviewer_comment = reviewerComment;
    if (overrideReason)  update.human_comment = overrideReason;
  } else {
    // update: edit without final approval
    if (reasoning)          update.reasoning = reasoning;
    if (reviewerComment)    update.reviewer_comment = reviewerComment;
    if (missingInformation !== undefined) update.missing_information = missingInformation;
    if (contractorAction   !== undefined) update.contractor_action = contractorAction;
    if (status)             update.status = status as ComplianceStatus;
  }

  const { data: updated, error: updateError } = await admin
    .from("compliance_findings")
    .update(update)
    .eq("id", findingId)
    .select("*")
    .single();

  if (updateError || !updated) {
    return NextResponse.json({ error: updateError?.message ?? "Failed to update finding." }, { status: 500 });
  }

  // Write audit event.
  await admin.from("audit_logs").insert({
    organization_id: profile.organization_id,
    project_id:      review.project_id,
    user_id:         profile.id,
    action:          `finding.${action}`,
    entity_type:     "compliance_findings",
    entity_id:       findingId,
    metadata: {
      reviewId,
      action,
      newStatus:      update.human_override_status ?? update.status ?? null,
      hasOverride:    !!overrideReason
    }
  });

  return NextResponse.json({ data: { finding: updated } });
}
