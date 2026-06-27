import { NextResponse } from "next/server";
import { canUploadDocument } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ documentId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { documentId } = await context.params;
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

  if (!profile) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  if (!canUploadDocument(profile.role)) {
    return NextResponse.json({ error: "You do not have permission to process documents." }, { status: 403 });
  }

  // Verify document access.
  const { data: document, error: documentError } = await supabase
    .from("documents")
    .select("id, project_id, organization_id, storage_path, mime_type")
    .eq("id", documentId)
    .maybeSingle();

  if (documentError || !document) {
    return NextResponse.json({ error: "Document was not found or is not accessible." }, { status: 404 });
  }

  if (document.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "You do not have access to this document." }, { status: 403 });
  }

  // Prevent duplicate active jobs.
  const { data: activeJob } = await supabase
    .from("processing_jobs")
    .select("id, status, updated_at")
    .eq("document_id", documentId)
    .eq("job_type", "document_extraction")
    .in("status", ["queued", "claimed", "running", "retry_wait"])
    .limit(1)
    .maybeSingle();

  if (activeJob) {
    const ageMs = Date.now() - new Date(activeJob.updated_at).getTime();
    const staleThresholdMs = 15 * 60 * 1000;
    if (ageMs < staleThresholdMs) {
      return NextResponse.json(
        { error: "This document already has an extraction job in progress.", code: "job_in_progress", retryable: true },
        { status: 409 }
      );
    }
    // Abandon the stale job so a new one can be created.
    await supabase
      .from("processing_jobs")
      .update({
        status: "failed",
        safe_error_message: "Job abandoned: no heartbeat before a new processing request was received.",
        last_error_code: "stale_job"
      })
      .eq("id", activeJob.id);
  }

  // Enqueue a new processing job.
  const { data: job, error: jobError } = await supabase
    .from("processing_jobs")
    .insert({
      organization_id: profile.organization_id,
      project_id: document.project_id,
      document_id: documentId,
      job_type: "document_extraction",
      status: "queued",
      progress: 0,
      priority: 5,
      available_at: new Date().toISOString(),
      created_by: profile.id,
      metadata: { storagePath: document.storage_path, mimeType: document.mime_type }
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: jobError?.message ?? "Could not create document processing job." }, { status: 400 });
  }

  // Update document and project to reflect queued state.
  await Promise.all([
    supabase.from("documents").update({ processing_status: "queued" }).eq("id", documentId),
    supabase.from("projects").update({ status: "processing" }).eq("id", document.project_id)
  ]);

  await supabase.from("audit_logs").insert({
    organization_id: profile.organization_id,
    project_id: document.project_id,
    user_id: profile.id,
    action: "document.processing_queued",
    entity_type: "processing_jobs",
    entity_id: job.id,
    metadata: { documentId }
  });

  return NextResponse.json({
    data: {
      jobId: job.id,
      status: "queued",
      documentId,
      message: "Document queued for processing. Run the processing worker to execute."
    }
  });
}
