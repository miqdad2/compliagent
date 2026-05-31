import { NextResponse } from "next/server";
import { enqueueDocumentProcessing, runDocumentProcessingFromBuffer } from "@/lib/documents/processing-pipeline";
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

  const { data: document, error } = await supabase.from("documents").select("*").eq("id", documentId).maybeSingle();
  if (error || !document) {
    return NextResponse.json({ error: "Document was not found or is not accessible." }, { status: 404 });
  }

  if (document.organization_id !== profile.organization_id) {
    return NextResponse.json({ error: "You do not have access to this document." }, { status: 403 });
  }

  const queuedJob = await enqueueDocumentProcessing({
    documentId,
    projectId: document.project_id,
    storagePath: document.storage_path,
    mimeType: document.mime_type
  });

  const { data: job, error: jobError } = await supabase
    .from("processing_jobs")
    .insert({
      organization_id: profile.organization_id,
      project_id: document.project_id,
      document_id: documentId,
      job_type: queuedJob.jobType,
      status: "running",
      progress: 10,
      metadata: { storagePath: document.storage_path, mimeType: document.mime_type }
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return NextResponse.json({ error: jobError?.message ?? "Could not create document processing job." }, { status: 400 });
  }

  await supabase.from("documents").update({ processing_status: "running" }).eq("id", documentId);
  await supabase.from("projects").update({ status: "processing" }).eq("id", document.project_id);

  const bucketName = process.env.SUPABASE_STORAGE_BUCKET_DOCUMENTS || "documents";
  const { data: fileBlob, error: downloadError } = await supabase.storage.from(bucketName).download(document.storage_path);

  if (downloadError || !fileBlob) {
    const message = downloadError?.message ?? "Document could not be downloaded from private storage.";
    await supabase.from("documents").update({ processing_status: "failed" }).eq("id", documentId);
    await supabase.from("projects").update({ status: "documents_uploaded" }).eq("id", document.project_id);
    await supabase.from("processing_jobs").update({ status: "failed", progress: 100, error_message: message }).eq("id", job.id);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const result = await runDocumentProcessingFromBuffer(
      {
        documentId,
        projectId: document.project_id,
        storagePath: document.storage_path,
        mimeType: document.mime_type
      },
      buffer
    );

    await supabase.from("document_chunks").delete().eq("document_id", documentId);
    await supabase.from("document_pages").delete().eq("document_id", documentId);

    if (result.pages.length > 0) {
      const pageRows = result.pages.map((page) => ({
        document_id: documentId,
        project_id: document.project_id,
        page_number: page.pageNumber,
        extracted_text: page.text,
        extraction_method: result.chunks.find((chunk) => chunk.pageNumber === page.pageNumber)?.extractionMethod ?? "manual",
        confidence: result.chunks.find((chunk) => chunk.pageNumber === page.pageNumber)?.confidence ?? 0.9
      }));
      const { error: pagesError } = await supabase.from("document_pages").insert(pageRows);

      if (pagesError) {
        throw new Error(pagesError.message);
      }
    }

    if (result.chunks.length > 0) {
      const { error: chunksError } = await supabase.from("document_chunks").insert(
        result.chunks.map((chunk) => ({
          document_id: documentId,
          project_id: document.project_id,
          page_number: chunk.pageNumber,
          clause_number: chunk.clauseNumber,
          section_heading: chunk.sectionHeading,
          chunk_text: chunk.rawText,
          normalized_text: chunk.normalizedText,
          metadata: {
            chunkIndex: chunk.chunkIndex,
            tokenCount: chunk.tokenCount,
            extractionMethod: chunk.extractionMethod,
            confidence: chunk.confidence
          }
        }))
      );

      if (chunksError) {
        throw new Error(chunksError.message);
      }
    }

    await supabase
      .from("documents")
      .update({
        processing_status: result.status,
        page_count: result.pageCount,
        ocr_required: result.ocrRequired
      })
      .eq("id", documentId);
    await supabase
      .from("processing_jobs")
      .update({
        status: result.status,
        progress: 100,
        error_message: result.status === "failed" ? result.message : null,
        metadata: {
          storagePath: document.storage_path,
          mimeType: document.mime_type,
          pageCount: result.pageCount,
          chunkCount: result.chunks.length,
          warnings: result.warnings
        }
      })
      .eq("id", job.id);

    if (result.status === "completed") {
      const { data: projectDocuments } = await supabase
        .from("documents")
        .select("processing_status")
        .eq("project_id", document.project_id);
      const allDocumentsCompleted =
        projectDocuments && projectDocuments.length > 0
          ? projectDocuments.every((projectDocument) => projectDocument.processing_status === "completed")
          : false;

      await supabase
        .from("projects")
        .update({ status: allDocumentsCompleted ? "ready_for_review" : "documents_uploaded" })
        .eq("id", document.project_id);
    } else {
      await supabase.from("projects").update({ status: "documents_uploaded" }).eq("id", document.project_id);
    }

    const status = result.status === "completed" ? 200 : 422;
    return NextResponse.json(
      {
        data: {
          ...queuedJob,
          status: result.status,
          pageCount: result.pageCount,
          chunkCount: result.chunks.length,
          ocrRequired: result.ocrRequired,
          message: result.message,
          warnings: result.warnings
        }
      },
      { status }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document processing failed.";
    await supabase.from("documents").update({ processing_status: "failed" }).eq("id", documentId);
    await supabase.from("projects").update({ status: "documents_uploaded" }).eq("id", document.project_id);
    await supabase.from("processing_jobs").update({ status: "failed", progress: 100, error_message: message }).eq("id", job.id);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
