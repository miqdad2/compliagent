import { NextResponse } from "next/server";
import { canRunReview } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { MockAiExecutionService } from "@/server/services/ai/mock-execution";
import { isMockAiTestEndpointEnabled, safeMockAiTestPayloadSchema } from "@/server/services/ai/safe-test";
import { SupabaseAiPersistenceGateway } from "@/server/services/ai/supabase-gateway";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const profile = await getCurrentProfile().catch(() => null);
  if (!profile) {
    return NextResponse.json(
      { error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication is required.", retryable: false } },
      { status: 401 }
    );
  }
  if (!canRunReview(profile.role)) {
    return NextResponse.json(
      { error: { code: "PROJECT_ACCESS_DENIED", message: "You do not have permission to run AI tests.", retryable: false } },
      { status: 403 }
    );
  }
  if (!isMockAiTestEndpointEnabled(process.env.NODE_ENV, process.env.ENABLE_PRODUCTION_MOCK_AI_TEST_ENDPOINT)) {
    return NextResponse.json(
      { error: { code: "TEST_ENDPOINT_DISABLED", message: "The mock AI test endpoint is disabled.", retryable: false } },
      { status: 404 }
    );
  }

  const parsed = safeMockAiTestPayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_TEST_PAYLOAD", message: "Use a predefined mock AI test payload.", retryable: false } },
      { status: 400 }
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json(
      {
        error: {
          code: "PERSISTENCE_ERROR",
          message: supabaseMissingEnvMessage() ?? "AI persistence is not configured.",
          retryable: true
        }
      },
      { status: 503 }
    );
  }

  const gateway = new SupabaseAiPersistenceGateway(supabase);
  const service = new MockAiExecutionService(gateway);
  const result = await service.execute({
    actor: profile,
    organizationId: profile.organization_id,
    projectId: parsed.data.projectId,
    provider: parsed.data.provider,
    taskType: parsed.data.taskType,
    promptVersion: "safe-mock-test@1.0.0",
    predefinedPayloadId: `safe-${parsed.data.taskType}-${parsed.data.scenario}`,
    behavior: parsed.data.scenario,
    repairInvalidOutput: true,
    externalTransmissionRequested: false,
    multimodalTransmissionRequested: parsed.data.taskType === "document_understanding"
  });

  if (!result.ok) {
    const forbiddenCodes = new Set([
      "AI_DISABLED",
      "CONSENT_REQUIRED",
      "PROVIDER_NOT_ALLOWED",
      "TASK_NOT_ALLOWED",
      "EXTERNAL_TRANSMISSION_BLOCKED",
      "MULTIMODAL_TRANSMISSION_BLOCKED",
      "ORGANIZATION_ACCESS_DENIED",
      "PROJECT_ACCESS_DENIED",
      "SETTINGS_NOT_FOUND"
    ]);
    return NextResponse.json({ error: result.error }, { status: forbiddenCodes.has(result.error.code) ? 403 : 422 });
  }

  return NextResponse.json({
    data: {
      runId: result.runId,
      taskType: result.taskType,
      status: result.status,
      validationStatus: result.validationStatus,
      provider: result.provider,
      mockProvider: result.mockProvider,
      model: result.model
    }
  });
}
