import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
export type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
export type ReviewRow = Database["public"]["Tables"]["compliance_reviews"]["Row"];
export type FindingRow = Database["public"]["Tables"]["compliance_findings"]["Row"];
export type ClarificationRow = Database["public"]["Tables"]["contractor_clarifications"]["Row"];

export async function listProjects(): Promise<ProjectRow[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .neq("status", "archived")
    .order("updated_at", { ascending: false });
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function getProject(projectId: string): Promise<ProjectRow | null> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listProjectDocuments(projectId: string): Promise<DocumentRow[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listProjectReviews(projectId: string): Promise<ReviewRow[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("compliance_reviews")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listReviewFindings(reviewId: string): Promise<FindingRow[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("compliance_findings")
    .select("*")
    .eq("review_id", reviewId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listReviewClarifications(reviewId: string): Promise<ClarificationRow[]> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from("contractor_clarifications")
    .select("*")
    .eq("review_id", reviewId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data;
}
