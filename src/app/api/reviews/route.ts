import { NextResponse } from "next/server";
import { getAiRuntimeConfig } from "@/lib/ai/provider";
import { generateTechnicalReview, type ReviewDocument } from "@/lib/compliance/review-runner";
import { canRunReview } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { DocumentRole } from "@/types/domain";

export const runtime = "nodejs";

type ReviewRequest = {
  projectId?: string;
  reviewBrief?: string;
};

type DocumentWithChunks = {
  id: string;
  file_name: string;
  document_role: DocumentRole;
  processing_status: string;
  document_chunks?: Array<{
    page_number: number;
    clause_number: string | null;
    chunk_text: string;
    normalized_text: string;
  }>;
};

export async function POST(request: Request) {
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

  if (!canRunReview(profile.role)) {
    return NextResponse.json({ error: "You do not have permission to run reviews." }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({}))) as ReviewRequest;
  const projectId = payload.projectId;

  if (!projectId) {
    return NextResponse.json({ error: "A project ID is required." }, { status: 400 });
  }

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, organization_id, name, discipline, review_type")
    .eq("id", projectId)
    .maybeSingle();

  if (projectError || !project) {
    return NextResponse.json({ error: "Project was not found or is not accessible." }, { status: 404 });
  }

  if (project.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "You do not have access to this project." }, { status: 403 });
  }

  const { data: rawDocuments, error: documentsError } = await supabase
    .from("documents")
    .select(
      `
        id,
        file_name,
        document_role,
        processing_status,
        document_chunks (
          page_number,
          clause_number,
          chunk_text,
          normalized_text
        )
      `
    )
    .eq("project_id", projectId)
    .eq("processing_status", "completed");

  if (documentsError) {
    return NextResponse.json({ error: documentsError.message }, { status: 400 });
  }

  const documents = ((rawDocuments ?? []) as DocumentWithChunks[]).map<ReviewDocument>((document) => ({
    id: document.id,
    fileName: document.file_name,
    documentRole: document.document_role,
    chunks: (document.document_chunks ?? []).map((chunk) => ({
      pageNumber: chunk.page_number,
      clauseNumber: chunk.clause_number,
      chunkText: chunk.chunk_text,
      normalizedText: chunk.normalized_text
    }))
  }));

  if (documents.length === 0) {
    return NextResponse.json({ error: "Process at least one requirement document and one evidence document before running a review." }, { status: 400 });
  }

  const aiRuntime = getAiRuntimeConfig();

  const { data: review, error: reviewError } = await supabase
    .from("compliance_reviews")
    .insert({
      project_id: projectId,
      title: `${project.name} technical compliance review`,
      review_scope: `${project.discipline} - ${project.review_type}`,
      status: "running",
      ai_model: aiRuntime.reviewEngineId,
      created_by: profile.id
    })
    .select("id")
    .single();

  if (reviewError || !review) {
    return NextResponse.json({ error: reviewError?.message ?? "Could not create compliance review." }, { status: 400 });
  }

  const { data: job } = await supabase
    .from("processing_jobs")
    .insert({
      organization_id: profile.organization_id,
      project_id: projectId,
      review_id: review.id,
      job_type: "compliance_review",
      status: "running",
      progress: 25,
      metadata: { documentCount: documents.length }
    })
    .select("id")
    .single();

  await supabase.from("projects").update({ status: "ai_review_running" }).eq("id", projectId);

  try {
    const reviewBrief = typeof payload.reviewBrief === "string" ? payload.reviewBrief.slice(0, 6000).trim() : "";
    const generated = generateTechnicalReview(documents, { reviewBrief });

    await supabase
      .from("compliance_reviews")
      .update({
        title: generated.title,
        review_scope: `${generated.scope}\n\nRecommendation: ${generated.recommendation}\n${generated.recommendationReasoning}`,
        status: "human_review_pending"
      })
      .eq("id", review.id);

    const { data: insertedFindings, error: findingsError } = await supabase
      .from("compliance_findings")
      .insert(
        generated.findings.map((finding) => ({
          review_id: review.id,
          project_id: projectId,
          clause_number: finding.clauseNumber,
          sub_clause_number: finding.subClauseNumber,
          requirement_text: finding.requirementText,
          evidence_text: finding.evidenceText,
          status: finding.status,
          weightage_score: finding.weightageScore,
          confidence_score: finding.confidenceScore,
          reasoning: finding.reasoning,
          missing_information: finding.missingInformation,
          contractor_action: finding.contractorAction,
          risk_level: finding.riskLevel
        }))
      )
      .select("id, clause_number, missing_information, contractor_action, risk_level");

    if (findingsError) {
      throw new Error(findingsError.message);
    }

    if (insertedFindings && insertedFindings.length > 0) {
      const clarifications = generated.clarifications.map((clarification, index) => {
        const relatedFinding =
          insertedFindings.find((finding) => finding.clause_number === clarification.clauseNumber) ?? insertedFindings[index];

        return {
          review_id: review.id,
          project_id: projectId,
          finding_id: relatedFinding?.id ?? null,
          clause_number: clarification.clauseNumber,
          issue: clarification.issue,
          why_it_matters: clarification.whyItMatters,
          required_action: clarification.requiredAction,
          required_document: clarification.requiredDocument,
          priority: clarification.priority
        };
      });

      if (clarifications.length > 0) {
        const { error: clarificationError } = await supabase.from("contractor_clarifications").insert(clarifications);
        if (clarificationError) {
          throw new Error(clarificationError.message);
        }
      }
    }

    await supabase.from("projects").update({ status: "human_review_pending" }).eq("id", projectId);
    await supabase
      .from("processing_jobs")
      .update({
        status: "completed",
        progress: 100,
      metadata: {
        documentCount: documents.length,
        findingCount: generated.findings.length,
        clarificationCount: generated.clarifications.length,
        recommendation: generated.recommendation,
        reviewEngine: aiRuntime.reviewEngineId,
        aiEnabled: aiRuntime.aiEnabled,
        reviewBrief
      }
      })
      .eq("id", job?.id);
    await supabase.from("audit_logs").insert({
      organization_id: profile.organization_id,
      project_id: projectId,
      user_id: profile.id,
      action: "ai_review_completed",
      entity_type: "compliance_review",
      entity_id: review.id,
      metadata: {
        findingCount: generated.findings.length,
        clarificationCount: generated.clarifications.length,
        recommendation: generated.recommendation,
        reviewEngine: aiRuntime.reviewEngineId,
        aiEnabled: aiRuntime.aiEnabled
      }
    });

    return NextResponse.json({
      data: {
        reviewId: review.id,
        findingCount: generated.findings.length,
        clarificationCount: generated.clarifications.length,
        recommendation: generated.recommendation,
        reviewEngine: aiRuntime.reviewEngineLabel,
        aiEnabled: aiRuntime.aiEnabled
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The compliance review could not be completed.";
    await supabase.from("compliance_reviews").update({ status: "failed", review_scope: message }).eq("id", review.id);
    await supabase.from("projects").update({ status: "ready_for_review" }).eq("id", projectId);
    await supabase
      .from("processing_jobs")
      .update({ status: "failed", progress: 100, error_message: message })
      .eq("id", job?.id);

    return NextResponse.json({ error: message }, { status: 422 });
  }
}
