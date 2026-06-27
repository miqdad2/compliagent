/**
 * Diagnose extraction + persistence failures for specific documents.
 * Run with: tsx --env-file .env src/server/workers/diagnose-extraction.ts
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { extractDocumentText } from "@/lib/documents/extraction";
import { chunkPages } from "@/lib/documents/chunking";

async function main() {
  const admin = createSupabaseAdminClient();
  if (!admin) { console.error("Cannot create admin client."); process.exit(2); }

  // Focus on the two currently-failed documents
  const { data: docs } = await admin
    .from("documents")
    .select("id, file_name, processing_status, storage_path, mime_type, project_id, organization_id")
    .in("processing_status", ["failed"])
    .in("file_name", [
      "Doc.-1-Specifications-Highlighted-References-.docx",
      "Doc.-4-Proposed-Speaker-with-referencing.pdf"
    ]);

  for (const d of (docs ?? [])) {
    const id = d.id as string;
    const fname = d.file_name as string;
    const storagePath = d.storage_path as string | null;
    const mimeType = d.mime_type as string;
    const projectId = d.project_id as string | null;
    const orgId = d.organization_id as string;

    console.log(`\n=== doc=${id.slice(0, 8)} (${fname}) ===`);
    console.log(`    project_id=${projectId ?? "(null)"}`);
    console.log(`    org_id=${orgId.slice(0, 8)}`);

    if (!storagePath || !projectId) {
      console.log(`    → SKIP: missing storage_path or project_id`);
      continue;
    }

    // Download
    let buffer: Buffer;
    try {
      const { data, error } = await admin.storage.from("documents").download(storagePath);
      if (error || !data) { console.log(`    → DOWNLOAD FAILED: ${error?.message ?? "no data"}`); continue; }
      buffer = Buffer.from(await data.arrayBuffer());
      console.log(`    → Download OK: ${buffer.length} bytes`);
    } catch (e) { console.log(`    → DOWNLOAD EXCEPTION: ${e instanceof Error ? e.message : "unknown"}`); continue; }

    // Extract
    let pages: ReturnType<typeof chunkPages>[number]["pageNumber"] extends number ? object[] : never;
    let pageCount = 0;
    try {
      const result = await extractDocumentText(buffer, mimeType);
      pageCount = result.pageCount;
      const textPages = result.pages.map(p => ({ ...p, documentId: id }));
      const chunks = chunkPages(textPages);
      console.log(`    → Extract OK: ${result.pageCount} pages, ${chunks.length} chunks`);

      // Fabricate a test job ID
      const fakeJobId = "00000000-0000-0000-0000-000000000001";
      const fakeExtVersion = `native-v1:${fakeJobId}`;

      // Try the RPC directly
      console.log(`    → Testing RPC replace_document_extraction_transactionally...`);
      const serializedPages = textPages.map(p => ({
        pageNumber: p.pageNumber,
        rawText: p.rawText,
        normalizedText: p.normalizedText,
        extractionMethod: p.extractionMethod,
        confidence: p.confidence ?? null,
        ocrRecommended: p.ocrRecommended ?? false,
        sourceHash: result.sourceHash,
        sourceLabel: p.sourceLabel ?? null,
        pageWidth: null,
        pageHeight: null,
        pageRotation: null,
        coordinateSystem: null
      }));
      const serializedChunks = chunks.map(c => ({
        pageNumber: c.pageNumber,
        clauseNumber: c.clauseNumber ?? null,
        sectionHeading: c.sectionHeading ?? null,
        chunkText: c.rawText,
        normalizedText: c.normalizedText,
        chunkIndex: c.chunkIndex,
        tokenCount: c.tokenCount,
        extractionMethod: c.extractionMethod,
        confidence: c.confidence ?? null,
        sourceLabel: c.sourceLabel ?? null
      }));

      const { data: rpcData, error: rpcError } = await admin.rpc("replace_document_extraction_transactionally", {
        p_document_id: id,
        p_organization_id: orgId,
        p_project_id: projectId,
        p_job_id: fakeJobId,
        p_extraction_version: fakeExtVersion,
        p_page_count: pageCount,
        p_ocr_required: result.ocrRequired,
        p_pages: JSON.stringify(serializedPages),
        p_chunks: JSON.stringify(serializedChunks),
        p_created_by: null
      });

      if (rpcError) {
        console.log(`    → RPC FAILED: ${rpcError.message}`);
        console.log(`    → RPC hint: ${rpcError.hint ?? "(none)"}`);
        console.log(`    → RPC details: ${rpcError.details ?? "(none)"}`);
        console.log(`    → RPC code: ${rpcError.code ?? "(none)"}`);
      } else {
        console.log(`    → RPC OK: ${JSON.stringify(rpcData)}`);
        // Reset: the RPC marked this doc as completed; reset to failed for safety
        await admin.from("documents").update({ processing_status: "failed" }).eq("id", id);
        await admin.from("processing_jobs").update({ status: "failed" }).eq("id", fakeJobId);
        await admin.from("document_pages").delete().eq("document_id", id);
        await admin.from("document_chunks").delete().eq("document_id", id);
        console.log(`    → Reset doc status back to failed, deleted test pages/chunks`);
      }
    } catch (e) {
      console.log(`    → EXCEPTION: ${e instanceof Error ? e.message.slice(0, 300) : "unknown"}`);
    }
  }

  console.log("\n=== Done ===");
}

main().catch((e: unknown) => {
  console.error(`Diagnostic failed: ${e instanceof Error ? e.message.slice(0, 200) : "Unknown"}`);
  process.exit(3);
});
