import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/permissions/server";
import { canRunReview } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProjectProgressClient } from "@/components/projects/project-progress-client";
import {
  resolveDocumentStatus,
  buildLatestJobMap,
  isSpecificationRole,
  isSubmissionRole
} from "@/lib/documents/document-status";
import type { ProjectJobRow } from "@/lib/documents/document-status";

type Props = {
  params:       Promise<{ projectId: string }>;
  searchParams: Promise<{ reviewId?: string }>;
};

export default async function ReviewProgressPage({ params, searchParams }: Props) {
  const { projectId }       = await params;
  const { reviewId: rawId } = await searchParams;

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch {
    redirect("/login");
  }
  if (!profile) redirect("/login");
  if (!canRunReview(profile.role)) redirect(`/projects/${projectId}`);

  const reviewId = typeof rawId === "string" && rawId.length > 0 ? rawId : null;
  if (!reviewId) redirect(`/projects/${projectId}`);

  const admin = createSupabaseAdminClient();
  if (!admin) notFound();

  // Load review (verify org ownership).
  const { data: review } = await admin
    .from("compliance_reviews")
    .select("id, title, status, project_id, organization_id")
    .eq("id", reviewId)
    .maybeSingle();

  if (!review || review.organization_id !== profile.organization_id) notFound();
  if (review.project_id !== projectId) notFound();

  // If the review is already complete, skip the progress page and go to workspace.
  const terminalStatuses = new Set(["awaiting_human_review", "approved", "failed", "cancelled"]);
  if (terminalStatuses.has(review.status)) {
    redirect(`/projects/${projectId}/reviews/${reviewId}`);
  }

  // Determine whether all required documents are already ready (two-query pattern).
  const supabase = await createSupabaseServerClient();
  let initialAllDocsReady = false;

  if (supabase) {
    const [docsResult, jobsResult] = await Promise.all([
      supabase
        .from("documents")
        .select("id, document_role, processing_status")
        .eq("project_id", projectId)
        .eq("organization_id", profile.organization_id),

      supabase
        .from("processing_jobs")
        .select("id, document_id, status, progress, last_error_code, safe_error_message, created_at, updated_at")
        .eq("project_id", projectId)
        .eq("job_type", "document_extraction")
        .order("created_at", { ascending: false })
    ]);

    const docs         = docsResult.data ?? [];
    const latestJobMap = buildLatestJobMap((jobsResult.data ?? []) as ProjectJobRow[]);

    let processingCount = 0;
    let hasCompletedSpec = false;
    let hasCompletedSubmission = false;

    for (const doc of docs) {
      const docWithJob = { ...doc, latestJob: latestJobMap.get(doc.id) ?? null };
      const resolved   = resolveDocumentStatus(docWithJob as Parameters<typeof resolveDocumentStatus>[0]);

      if (resolved.isActivelyProcessing) processingCount++;
      if (resolved.status === "completed") {
        if (isSpecificationRole(doc.document_role)) hasCompletedSpec = true;
        if (isSubmissionRole(doc.document_role))    hasCompletedSubmission = true;
      }
    }

    initialAllDocsReady = processingCount === 0 && hasCompletedSpec && hasCompletedSubmission;
  }

  return (
    <ProjectProgressClient
      projectId={projectId}
      reviewId={reviewId}
      reviewTitle={review.title ?? `Review ${reviewId.slice(0, 8)}`}
      initialReviewStatus={review.status}
      initialAllDocsReady={initialAllDocsReady}
    />
  );
}
