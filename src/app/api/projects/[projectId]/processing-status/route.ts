import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  resolveDocumentStatus,
  buildLatestJobMap,
  isSpecificationRole,
  isSubmissionRole
} from "@/lib/documents/document-status";
import type { ProjectJobRow } from "@/lib/documents/document-status";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

// Jobs stale for more than this are considered potentially stalled.
const STALL_THRESHOLD_MS = 5 * 60 * 1000;

// Worker liveness thresholds (milliseconds).
const WORKER_ACTIVE_THRESHOLD_MS = 2  * 60 * 1000; //  2 min → recently active
const WORKER_STALE_THRESHOLD_MS  = 10 * 60 * 1000; // 10 min → stale

/**
 * GET /api/projects/[projectId]/processing-status
 *
 * Lightweight poll endpoint used by the project-level progress page to check
 * whether all documents have finished processing before triggering the review.
 *
 * Response: { data: { totalCount, processingCount, completedCount, failedCount,
 *              allDocsReady, queuedCount, claimedCount, stalledCount } }
 *
 * queuedCount  — docs whose latest job is "queued" (no worker has claimed yet)
 * claimedCount — docs whose latest job is "claimed" or "running" (active worker)
 * stalledCount — claimed/running jobs with a stale heartbeat (worker may have died)
 */
export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;

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
  } catch {
    return NextResponse.json({ error: "Could not load user profile." }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  // Verify project belongs to this user's org.
  const { data: project } = await supabase
    .from("projects")
    .select("id, organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!project || project.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "Project not found or not accessible." }, { status: 404 });
  }

  // Load documents with their latest processing job plus worker liveness.
  const [docsResult, jobsResult, livenessResult] = await Promise.all([
    supabase
      .from("documents")
      .select("id, document_role, processing_status")
      .eq("project_id", projectId),

    supabase
      .from("processing_jobs")
      .select(
        "id, document_id, status, progress, last_error_code, safe_error_message, " +
        "created_at, updated_at, heartbeat_at"
      )
      .eq("project_id", projectId)
      .eq("job_type", "document_extraction")
      .order("created_at", { ascending: false }),

    supabase
      .from("worker_liveness")
      .select("last_heartbeat_at")
      .eq("worker_type", "document_processing")
      .maybeSingle()
  ]);

  // Determine worker liveness from the heartbeat row.
  const heartbeatAt = livenessResult.data?.last_heartbeat_at ?? null;
  let workerLiveness: "active" | "stale" | "unknown" = "unknown";
  if (heartbeatAt) {
    const ageMs = Date.now() - new Date(heartbeatAt).getTime();
    if (ageMs <= WORKER_ACTIVE_THRESHOLD_MS)      workerLiveness = "active";
    else if (ageMs <= WORKER_STALE_THRESHOLD_MS)  workerLiveness = "stale";
  }

  const docs    = docsResult.data ?? [];
  type RawJobRow = {
    id: string;
    document_id: string | null;
    status: string;
    progress: number;
    last_error_code: string | null;
    safe_error_message: string | null;
    created_at: string;
    updated_at: string;
    heartbeat_at: string | null;
  };
  const rawJobs = (jobsResult.data ?? []) as unknown as RawJobRow[];

  const latestJobMap = buildLatestJobMap(rawJobs as ProjectJobRow[]);

  // Build a per-document latest-job map for stall detection.
  // rawJobs is ordered by created_at DESC, so first occurrence per doc is the latest.
  const stalledInfoMap = new Map<string, { status: string; heartbeat_at: string | null }>();
  for (const job of rawJobs) {
    const docId = job.document_id;
    if (!docId || stalledInfoMap.has(docId)) continue;
    stalledInfoMap.set(docId, { status: job.status, heartbeat_at: job.heartbeat_at });
  }

  let processingCount = 0;
  let completedCount  = 0;
  let failedCount     = 0;
  let queuedCount     = 0;
  let claimedCount    = 0;
  let stalledCount    = 0;
  let hasSpec         = false;
  let hasSubmission   = false;

  for (const doc of docs) {
    const docWithJob = {
      ...doc,
      latestJob: latestJobMap.get(doc.id) ?? null
    };
    const resolved = resolveDocumentStatus(docWithJob as Parameters<typeof resolveDocumentStatus>[0]);

    if (resolved.isActivelyProcessing) processingCount++;
    else if (resolved.status === "completed") completedCount++;
    else if (resolved.status === "failed")    failedCount++;

    if (resolved.status === "completed") {
      if (isSpecificationRole(doc.document_role)) hasSpec = true;
      if (isSubmissionRole(doc.document_role))    hasSubmission = true;
    }

    // Stall detection using the enriched info map.
    const info = stalledInfoMap.get(doc.id);
    if (info) {
      if (info.status === "queued") {
        queuedCount++;
      } else if (info.status === "claimed" || info.status === "running") {
        claimedCount++;
        if (info.heartbeat_at) {
          const staleMs = Date.now() - new Date(info.heartbeat_at).getTime();
          if (staleMs > STALL_THRESHOLD_MS) stalledCount++;
        }
      }
    }
  }

  const totalCount   = docs.length;
  const allDocsReady = processingCount === 0 && hasSpec && hasSubmission;

  return NextResponse.json({
    data: {
      totalCount,
      processingCount,
      completedCount,
      failedCount,
      allDocsReady,
      queuedCount,
      claimedCount,
      stalledCount,
      workerLiveness
    }
  });
}
