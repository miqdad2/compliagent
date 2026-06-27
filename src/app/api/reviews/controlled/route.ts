import { NextResponse } from "next/server";
import { canRunReview } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { anyProviderAvailable } from "@/server/services/ai/provider-registry";
import type { ExecutionMode } from "@/server/services/reviews/types";

export const runtime = "nodejs";

type StartReviewRequest = {
  projectId?:     string;
  reviewTitle?:   string;
  executionMode?: string;
};

const VALID_MODES: ExecutionMode[] = ["deterministic", "mock", "controlled_live"];

/**
 * POST /api/reviews/controlled
 *
 * Creates a new compliance review row in "draft" status and returns immediately.
 * The actual orchestration is executed by POST /api/reviews/[reviewId]/execute,
 * which is called by the workspace progress page after the client navigates there.
 *
 * This two-phase design prevents the start-review form from hanging on a
 * long-running HTTP request when processing many requirements.
 *
 * Response: { data: { reviewId, status, executionMode, redirectUrl } }
 */
export async function POST(request: Request) {
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

  if (!canRunReview(profile.role)) {
    return NextResponse.json(
      { error: "You do not have permission to run compliance reviews." },
      { status: 403 }
    );
  }

  const payload = (await request.json().catch(() => ({}))) as StartReviewRequest;
  const projectId = payload.projectId;

  if (!projectId || typeof projectId !== "string") {
    return NextResponse.json({ error: "A projectId is required." }, { status: 400 });
  }

  const requestedMode = payload.executionMode;
  const executionMode: ExecutionMode =
    typeof requestedMode === "string" && VALID_MODES.includes(requestedMode as ExecutionMode)
      ? (requestedMode as ExecutionMode)
      : "deterministic";

  // Verify project ownership.
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, organization_id, name, discipline, review_type")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !project) {
    return NextResponse.json({ error: "Project not found or not accessible." }, { status: 404 });
  }

  if (project.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "You do not have access to this project." }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: supabaseMissingEnvMessage({ requireServiceRole: true }) ?? "Service role client unavailable." },
      { status: 500 }
    );
  }

  // Pre-flight check for live AI mode before creating the review slot.
  if (executionMode === "controlled_live") {
    const settingsRow = await admin
      .from("organization_ai_settings")
      .select("enabled_providers, ai_enabled")
      .eq("organization_id", profile.organization_id)
      .maybeSingle();

    const enabledProviders = (settingsRow.data?.enabled_providers ?? []) as string[];
    if (!settingsRow.data?.ai_enabled || enabledProviders.length === 0) {
      return NextResponse.json(
        { error: "AI is not enabled for this organization. Configure AI settings before using live mode.", executionMode },
        { status: 422 }
      );
    }
    if (!anyProviderAvailable(enabledProviders as Parameters<typeof anyProviderAvailable>[0])) {
      return NextResponse.json(
        { error: "No AI provider credentials are available. Set the relevant API key environment variable.", executionMode },
        { status: 422 }
      );
    }
  }

  // Guard: if an active review already exists for this project, reuse it.
  const { data: existingReview } = await admin
    .from("compliance_reviews")
    .select("id, status, execution_mode")
    .eq("project_id", projectId)
    .eq("organization_id", profile.organization_id)
    .in("status", ["draft", "running", "awaiting_human_review"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingReview) {
    return NextResponse.json({
      data: {
        reviewId:      existingReview.id,
        status:        existingReview.status,
        executionMode: (existingReview as Record<string, unknown>)["execution_mode"] as string ?? executionMode,
        redirectUrl:   `/projects/${projectId}/reviews/${existingReview.id}`,
        reused:        true
      }
    });
  }

  const reviewTitle =
    typeof payload.reviewTitle === "string" && payload.reviewTitle.trim().length > 0
      ? payload.reviewTitle.trim().slice(0, 200)
      : `${project.name} — automated review`;

  // Create review in draft state — execution happens separately via /execute.
  const { data: reviewRow, error: insertError } = await admin
    .from("compliance_reviews")
    .insert({
      organization_id: profile.organization_id,
      project_id:      projectId,
      title:           reviewTitle,
      review_scope:    `${project.discipline} – ${project.review_type}`,
      status:          "draft",
      execution_mode:  executionMode,
      created_by:      profile.id
    })
    .select("id")
    .single();

  if (insertError || !reviewRow) {
    return NextResponse.json(
      { error: insertError?.message ?? "Could not create compliance review." },
      { status: 400 }
    );
  }

  return NextResponse.json({
    data: {
      reviewId:      reviewRow.id,
      status:        "draft" as const,
      executionMode,
      redirectUrl:   `/projects/${projectId}/reviews/${reviewRow.id}`
    }
  });
}
