import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { canRunReview } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { SupabaseReviewGateway } from "@/server/services/reviews/supabase-review-gateway";
import { SupabaseComplianceGateway } from "@/server/services/compliance/supabase-compliance-gateway";
import { ReviewOrchestrator } from "@/server/services/reviews/review-orchestrator";
import { SupabaseProvisionalRequirementGateway } from "@/server/services/reviews/provisional-requirement-gateway";
import { ControlledAiExecutionService } from "@/server/services/ai/controlled-execution";
import { SupabaseAiPersistenceGateway } from "@/server/services/ai/supabase-gateway";
import { anyProviderAvailable } from "@/server/services/ai/provider-registry";
import type { ExecutionMode } from "@/server/services/reviews/types";

export const runtime = "nodejs";

const PROMPT_VERSION     = "1.0.0";
const EXTRACTION_VERSION = "controlled-review:1.0.0";

const VALID_MODES: ExecutionMode[] = ["deterministic", "mock", "controlled_live"];

/**
 * POST /api/reviews/[reviewId]/execute
 *
 * Executes the automated compliance review pipeline for an existing review row.
 * The review must be in "draft" status (created by POST /api/reviews/controlled).
 *
 * This route is called by the workspace page after the user is redirected there,
 * so long-running processing happens while the user watches progress on-screen
 * rather than blocking the start-review form.
 *
 * Does NOT auto-approve. Does NOT expose API keys.
 * Requires authentication and engineer/reviewer role.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ reviewId: string }> }
) {
  const { reviewId } = await params;

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

  if (!canRunReview(profile.role)) {
    return NextResponse.json(
      { error: "You do not have permission to run compliance reviews." },
      { status: 403 }
    );
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: supabaseMissingEnvMessage({ requireServiceRole: true }) ?? "Service role client unavailable." },
      { status: 500 }
    );
  }

  // Load the review and verify org ownership.
  const { data: review, error: reviewError } = await admin
    .from("compliance_reviews")
    .select("id, project_id, organization_id, status, review_version, execution_mode")
    .eq("id", reviewId)
    .maybeSingle();

  if (reviewError || !review) {
    return NextResponse.json({ error: "Review not found." }, { status: 404 });
  }

  if (review.organization_id !== null && review.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "Access denied." }, { status: 403 });
  }

  // Only draft reviews can be executed.
  if (review.status !== "draft") {
    // Already running or complete — return current state.
    return NextResponse.json({
      data: {
        reviewId:     review.id,
        status:       review.status,
        executionMode: (review as Record<string, unknown>)["execution_mode"] as string ?? "deterministic",
        alreadyRunning: review.status === "running",
        complete:       review.status === "awaiting_human_review",
      }
    });
  }

  const projectId = review.project_id;

  // Resolve the execution mode stored on the review row.
  const rawMode = (review as Record<string, unknown>)["execution_mode"];
  const executionMode: ExecutionMode =
    typeof rawMode === "string" && VALID_MODES.includes(rawMode as ExecutionMode)
      ? (rawMode as ExecutionMode)
      : "deterministic";

  const sourceHash = createHash("sha256")
    .update(`${projectId}:${EXTRACTION_VERSION}:${PROMPT_VERSION}:${executionMode}`)
    .digest("hex");

  const reviewGateway     = new SupabaseReviewGateway(admin);
  const complianceGateway = new SupabaseComplianceGateway(admin);

  let aiExecutor: ControlledAiExecutionService | null = null;
  if (executionMode !== "deterministic") {
    const aiGateway = new SupabaseAiPersistenceGateway(admin);
    aiExecutor = new ControlledAiExecutionService(aiGateway);

    if (executionMode === "controlled_live") {
      const settingsRow = await admin
        .from("organization_ai_settings")
        .select("enabled_providers, ai_enabled")
        .eq("organization_id", profile.organization_id)
        .maybeSingle();

      const enabledProviders = (settingsRow.data?.enabled_providers ?? []) as string[];
      if (!settingsRow.data?.ai_enabled || enabledProviders.length === 0) {
        return NextResponse.json(
          { error: "AI is not enabled for this organization." },
          { status: 422 }
        );
      }
      if (!anyProviderAvailable(enabledProviders as Parameters<typeof anyProviderAvailable>[0])) {
        return NextResponse.json(
          { error: "No AI provider credentials are available." },
          { status: 422 }
        );
      }
    }
  }

  const provisionalGateway = new SupabaseProvisionalRequirementGateway(admin);
  const orchestrator = new ReviewOrchestrator(reviewGateway, complianceGateway, aiExecutor, provisionalGateway);

  const result = await orchestrator.runControlledReview({
    organizationId:    profile.organization_id,
    projectId,
    reviewId:          review.id,
    createdBy:         profile.id,
    reviewVersion:     review.review_version ?? 1,
    sourceHash,
    extractionVersion: EXTRACTION_VERSION,
    promptVersion:     PROMPT_VERSION,
    executionMode
  }, profile);

  if (!result.ok) {
    return NextResponse.json(
      {
        error:         result.message,
        errorCode:     result.errorCode,
        reviewId:      review.id,
        executionMode,
        retryable:     result.retryable
      },
      { status: result.retryable ? 503 : 422 }
    );
  }

  return NextResponse.json({
    data: {
      reviewId:                 result.data.reviewId,
      status:                   result.data.status,
      executionMode:            result.data.executionMode,
      findingCount:             result.data.findingCount,
      conditionCount:           result.data.conditionCount,
      requirementCount:         result.data.requirementCount,
      idempotentSkip:           result.data.idempotentSkip,
      aiRunCount:               result.data.aiRunCount,
      humanReviewRequiredCount: result.data.humanReviewRequiredCount,
      flags:                    result.data.flags
    }
  });
}
