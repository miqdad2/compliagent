/**
 * Development-only endpoint: runs the document processing worker synchronously.
 * Disabled in production unless ENABLE_PRODUCTION_DEV_WORKER=true is explicitly set.
 *
 * POST /api/dev/processing/run-worker
 * Body: { batchSize?: number }
 * Returns: { processed, succeeded, retried, failed, skipped, recovered }
 */
import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/permissions/server";
import { canUploadDocument } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseProcessingGateway } from "@/server/services/processing/supabase-processing-gateway";
import { createDocumentProcessingWorker } from "@/server/workers/document-processing-worker";

export const runtime = "nodejs";

const isProductionModeEnabled = process.env.NODE_ENV === "production" && process.env.ENABLE_PRODUCTION_DEV_WORKER !== "true";

export async function POST(request: Request) {
  if (isProductionModeEnabled) {
    return NextResponse.json({ error: "This endpoint is only available in development." }, { status: 404 });
  }

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  if (!profile) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  if (!canUploadDocument(profile.role)) {
    return NextResponse.json({ error: "You do not have permission to trigger document processing." }, { status: 403 });
  }

  let batchSize = 5;
  try {
    const body = (await request.json().catch(() => ({}))) as { batchSize?: number };
    if (typeof body.batchSize === "number" && body.batchSize > 0 && body.batchSize <= 20) {
      batchSize = body.batchSize;
    }
  } catch {
    // Use default batch size.
  }

  const adminClient = createSupabaseAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase admin client is not configured." }, { status: 500 });
  }

  const gateway = new SupabaseProcessingGateway(adminClient);
  const worker = createDocumentProcessingWorker(gateway, `dev-worker-${profile.id.slice(0, 8)}`);
  const result = await worker.processBatch(batchSize);

  return NextResponse.json({ data: result });
}
