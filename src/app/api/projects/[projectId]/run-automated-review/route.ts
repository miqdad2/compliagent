import { NextResponse } from "next/server";
import { canRunReview } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  isSpecificationRole,
  isSubmissionRole,
  resolveDocumentStatus,
  buildLatestJobMap
} from "@/lib/documents/document-status";
import type { ProjectJobRow } from "@/lib/documents/document-status";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

/**
 * POST /api/projects/[projectId]/run-automated-review
 *
 * One-click orchestration: enqueues any unprocessed documents and creates a
 * draft review row, returning immediately so the client can navigate to the
 * project-level progress page without hanging on a long HTTP request.
 *
 * The progress page polls document processing status, then calls
 * POST /api/reviews/[reviewId]/execute once all required docs are ready.
 *
 * Response: { data: { reviewId, status, enqueuedDocCount, redirectUrl } }
 */
export async function POST(_request: Request, context: RouteContext) {
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

  // Guard: reuse any existing active review for this project.
  const { data: existingReview } = await admin
    .from("compliance_reviews")
    .select("id, status")
    .eq("project_id", projectId)
    .eq("organization_id", profile.organization_id)
    .in("status", ["draft", "running", "awaiting_human_review"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingReview) {
    return NextResponse.json({
      data: {
        reviewId:         existingReview.id,
        status:           existingReview.status,
        reused:           true,
        enqueuedDocCount: 0,
        redirectUrl:      `/projects/${projectId}/review-progress?reviewId=${existingReview.id}`
      }
    });
  }

  // Load project documents with their latest processing job.
  const [docsResult, jobsResult] = await Promise.all([
    supabase
      .from("documents")
      .select("id, storage_path, mime_type, document_role, processing_status")
      .eq("project_id", projectId)
      .eq("organization_id", profile.organization_id),

    supabase
      .from("processing_jobs")
      .select("id, document_id, status, progress, last_error_code, safe_error_message, created_at, updated_at")
      .eq("project_id", projectId)
      .eq("job_type", "document_extraction")
      .order("created_at", { ascending: false })
  ]);

  const docs = docsResult.data ?? [];
  const latestJobMap = buildLatestJobMap((jobsResult.data ?? []) as ProjectJobRow[]);

  // Require at least one spec-role and one submission-role document.
  const hasAnySpec       = docs.some((d) => isSpecificationRole(d.document_role));
  const hasAnySubmission = docs.some((d) => isSubmissionRole(d.document_role));

  if (!hasAnySpec) {
    return NextResponse.json(
      { error: "Upload a specification document before running the review." },
      { status: 422 }
    );
  }
  if (!hasAnySubmission) {
    return NextResponse.json(
      { error: "Upload a contractor submission document before running the review." },
      { status: 422 }
    );
  }

  // Enqueue any documents that are not completed and not actively processing.
  const enqueuedDocIds: string[] = [];
  for (const doc of docs) {
    const docWithJob = { ...doc, latestJob: latestJobMap.get(doc.id) ?? null };
    const resolved   = resolveDocumentStatus(docWithJob as Parameters<typeof resolveDocumentStatus>[0]);

    if (resolved.status === "completed" || resolved.isActivelyProcessing) continue;

    const { data: job } = await supabase
      .from("processing_jobs")
      .insert({
        organization_id: profile.organization_id,
        project_id:      projectId,
        document_id:     doc.id,
        job_type:        "document_extraction",
        status:          "queued",
        progress:        0,
        priority:        5,
        available_at:    new Date().toISOString(),
        created_by:      profile.id,
        metadata:        { storagePath: doc.storage_path, mimeType: doc.mime_type }
      })
      .select("id")
      .single();

    if (job) {
      await supabase
        .from("documents")
        .update({ processing_status: "queued" })
        .eq("id", doc.id);
      enqueuedDocIds.push(doc.id);
    }
  }

  if (enqueuedDocIds.length > 0) {
    await supabase.from("projects").update({ status: "processing" }).eq("id", projectId);
  }

  // Create draft review — execution triggered by the progress page client.
  const reviewTitle = `${project.name} — automated review`;
  const { data: reviewRow, error: insertError } = await admin
    .from("compliance_reviews")
    .insert({
      organization_id: profile.organization_id,
      project_id:      projectId,
      title:           reviewTitle,
      review_scope:    [project.discipline, project.review_type].filter(Boolean).join(" – "),
      status:          "draft",
      execution_mode:  "deterministic",
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
      reviewId:         reviewRow.id,
      status:           "draft" as const,
      enqueuedDocCount: enqueuedDocIds.length,
      redirectUrl:      `/projects/${projectId}/review-progress?reviewId=${reviewRow.id}`
    }
  });
}
