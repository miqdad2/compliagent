import { NextResponse } from "next/server";
import { canManageOrganization } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requirementRefinementOutputSchema } from "@/lib/ai/review-schemas";
import { ControlledAiExecutionService, hashSafeInputRef } from "@/server/services/ai/controlled-execution";
import { SupabaseAiPersistenceGateway } from "@/server/services/ai/supabase-gateway";
import { resolveAnthropicKey } from "@/server/services/ai/anthropic-provider";
import { _injectTestTransport } from "@/server/services/ai/provider-registry";

export const runtime = "nodejs";

const PREDEFINED_TEST_CLAUSE = "The device shall have an IP65 ingress protection rating.";
const PREDEFINED_TEST_PROMPT_VERSION = "1.0.0";

/**
 * POST /api/admin/ai-verify
 *
 * Admin-only endpoint to verify live provider connectivity.
 * Sends a predefined non-confidential test clause to verify the provider
 * returns a valid structured response.
 *
 * Rules:
 * - Requires admin or super-admin role.
 * - Only available in development unless ENABLE_PRODUCTION_DEV_WORKER=true.
 * - Never transmits uploaded client documents.
 * - Persists an AI run for audit traceability.
 * - Does not hardcode provider secrets.
 */
export async function POST(request: Request) {
  // Production gate.
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_PRODUCTION_DEV_WORKER !== "true") {
    return NextResponse.json(
      { error: "This endpoint is disabled in production. Set ENABLE_PRODUCTION_DEV_WORKER=true to enable." },
      { status: 403 }
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: supabaseMissingEnvMessage() ?? "Supabase not configured." }, { status: 500 });
  }

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Auth required." }, { status: 401 });
  }
  if (!profile) return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  if (!canManageOrganization(profile.role)) {
    return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required." }, { status: 400 });
  }

  // Verify project belongs to org.
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service unavailable." }, { status: 500 });

  const { data: project } = await admin
    .from("projects")
    .select("id, organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project || project.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "Project not found or not accessible." }, { status: 404 });
  }

  // Check credentials.
  const anthropicKey = resolveAnthropicKey();
  if (!anthropicKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not set. Set it as a server environment variable to enable live verification." },
      { status: 422 }
    );
  }

  // Run the verification with the predefined test payload.
  const aiGateway  = new SupabaseAiPersistenceGateway(admin);
  const executor   = new ControlledAiExecutionService(aiGateway);

  const inputHash = hashSafeInputRef({
    organizationId: profile.organization_id,
    projectId,
    reviewId:       null,
    entityId:       "verification-test",
    taskType:       "requirement_refinement",
    promptVersion:  PREDEFINED_TEST_PROMPT_VERSION
  });

  const systemPrompt = `You are a precise technical requirements analyst verifying provider connectivity. Return a valid JSON object for the provided test clause.`;
  const userMessage  = `Test clause: "${PREDEFINED_TEST_CLAUSE}"\n\nReturn a valid requirement refinement JSON object for this clause.`;

  const result = await executor.execute({
    actor:                          profile,
    organizationId:                 profile.organization_id,
    projectId,
    reviewId:                       null,
    documentId:                     null,
    taskType:                       "requirement_refinement",
    promptVersion:                  PREDEFINED_TEST_PROMPT_VERSION,
    systemPrompt,
    input:                          [{ type: "text", text: userMessage }],
    inputHash,
    outputSchema:                   requirementRefinementOutputSchema,
    outputSchemaName:               "RequirementRefinementOutput",
    temperature:                    0,
    timeoutMs:                      30_000,
    externalTransmissionRequested:  false,
    multimodalTransmissionRequested: false
  });

  if (!result.ok) {
    return NextResponse.json(
      {
        verified:  false,
        error:     result.error.message,
        errorCode: result.error.code
      },
      { status: 422 }
    );
  }

  return NextResponse.json({
    verified:  true,
    runId:     result.runId,
    provider:  result.provider,
    model:     result.model,
    repaired:  result.repaired,
    output: {
      isReviewable:    result.data.isReviewable,
      mandatoryLevel:  result.data.mandatoryLevel,
      confidence:      result.data.confidence,
      humanReviewRequired: result.data.humanReviewRequired
    }
  });
}
