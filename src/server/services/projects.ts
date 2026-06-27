import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import {
  buildLatestJobMap,
  type DocumentWithLatestJob,
  type ProjectJobRow
} from "@/lib/documents/document-status";

export type ProjectRow       = Database["public"]["Tables"]["projects"]["Row"];
export type DocumentRow      = Database["public"]["Tables"]["documents"]["Row"];
export type ReviewRow        = Database["public"]["Tables"]["compliance_reviews"]["Row"];
export type FindingRow       = Database["public"]["Tables"]["compliance_findings"]["Row"];
export type ClarificationRow = Database["public"]["Tables"]["contractor_clarifications"]["Row"];

export async function listProjects(): Promise<ProjectRow[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  // Include all projects — archived ones are shown with a visual indicator rather
  // than hidden, so users can navigate to projects that contain processed documents.
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function getProject(projectId: string): Promise<ProjectRow | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Load all documents for a project WITH their latest processing job attached.
 *
 * Two separate queries are made and merged in application code so that the
 * latest job per document is deterministically selected by:
 *   created_at DESC, updated_at DESC, id DESC
 *
 * This eliminates the stale-status problem caused by relying solely on the
 * `documents.processing_status` column, which can lag behind the actual job state.
 */
export async function listProjectDocuments(projectId: string): Promise<DocumentWithLatestJob[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  const [docsResult, jobsResult] = await Promise.all([
    supabase
      .from("documents")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false }),

    supabase
      .from("processing_jobs")
      .select("id, document_id, status, progress, last_error_code, safe_error_message, created_at, updated_at")
      .eq("project_id", projectId)
      .eq("job_type", "document_extraction")
      .order("created_at", { ascending: false })
  ]);

  if (docsResult.error) throw new Error(docsResult.error.message);

  const docs = docsResult.data ?? [];
  const jobs = (jobsResult.data ?? []) as ProjectJobRow[];

  // Build a map from document_id → latest job.
  const latestJobMap = buildLatestJobMap(jobs);

  return docs.map((doc) => ({
    ...doc,
    latestJob: latestJobMap.get(doc.id) ?? null
  }));
}

export async function listProjectReviews(projectId: string): Promise<ReviewRow[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("compliance_reviews")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

export async function listReviewFindings(reviewId: string): Promise<FindingRow[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("compliance_findings")
    .select("*")
    .eq("review_id", reviewId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

export async function listReviewClarifications(reviewId: string): Promise<ClarificationRow[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("contractor_clarifications")
    .select("*")
    .eq("review_id", reviewId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}
