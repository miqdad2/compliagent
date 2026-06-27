/**
 * Database diagnostic script for Unit 17B pre-implementation check.
 * Run with: tsx --env-file .env src/server/workers/run-db-diagnostics.ts
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function main() {
  const admin = createSupabaseAdminClient();
  if (!admin) { console.error("Cannot create admin client."); process.exit(2); }

  console.log("=== CompliAgent Database Diagnostics ===\n");

  // All documents with project_id
  const { data: docs } = await admin
    .from("documents")
    .select("id, file_name, document_role, processing_status, page_count, project_id, organization_id, created_at")
    .order("created_at", { ascending: false });

  console.log("--- All Documents ---");
  for (const d of (docs ?? [])) {
    const id = (d.id as string | null) ?? "(null)";
    const fname = (d.file_name as string | null) ?? "(null)";
    const role = (d.document_role as string | null) ?? "(null)";
    const status = (d.processing_status as string | null) ?? "(null)";
    const pages = (d.page_count as number | null) ?? "?";
    const proj = (d.project_id as string | null)?.slice(0, 8) ?? "(null)";
    console.log(`  [${status}] id=${id.slice(0, 8)} proj=${proj} file=${fname} role=${role} pages=${pages}`);
  }

  // All processing jobs with project_id
  const { data: jobs } = await admin
    .from("processing_jobs")
    .select("id, document_id, project_id, organization_id, status, job_type, attempts, last_error_code, safe_error_message, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  console.log("\n--- Processing Jobs (last 20) ---");
  for (const j of (jobs ?? [])) {
    const jid = (j.id as string | null) ?? "(null)";
    const did = (j.document_id as string | null) ?? "(null)";
    const proj = (j.project_id as string | null)?.slice(0, 8) ?? "(null)";
    const status = (j.status as string | null) ?? "(null)";
    const err = (j.last_error_code as string | null) ?? "-";
    const msg = ((j.safe_error_message as string | null) ?? "").slice(0, 100);
    const attempts = j.attempts as number | null;
    console.log(`  [${status}] job=${jid.slice(0, 8)} doc=${did.slice(0, 8)} proj=${proj} attempts=${attempts ?? 0} err=${err} msg=${msg}`);
  }

  // Check queued documents specifically — look for job/document project_id mismatch
  const queuedDocs = (docs ?? []).filter(d => (d.processing_status as string) === "queued");
  if (queuedDocs.length > 0) {
    console.log("\n--- Queued Documents: Job/Document project_id check ---");
    for (const d of queuedDocs) {
      const docId = d.id as string;
      const docProjId = d.project_id as string | null;
      const { data: docJobs } = await admin
        .from("processing_jobs")
        .select("id, status, project_id, last_error_code, safe_error_message")
        .eq("document_id", docId);
      console.log(`  doc=${docId.slice(0, 8)} (${d.file_name as string}) doc.project_id=${docProjId?.slice(0, 8) ?? "NULL"}`);
      if (!docJobs || docJobs.length === 0) {
        console.log(`    → NO PROCESSING JOBS EXIST for this document`);
      } else {
        for (const j of docJobs) {
          const jobProjId = j.project_id as string | null;
          const mismatch = docProjId !== jobProjId ? " *** MISMATCH ***" : "";
          const msg = ((j.safe_error_message as string | null) ?? "").slice(0, 80);
          console.log(`    job=${(j.id as string).slice(0, 8)} status=${j.status as string} job.project_id=${jobProjId?.slice(0, 8) ?? "NULL"}${mismatch} err=${j.last_error_code as string | null ?? "-"} msg=${msg}`);
        }
      }
    }
  }

  // Check failed documents too
  const failedDocs = (docs ?? []).filter(d => (d.processing_status as string) === "failed");
  if (failedDocs.length > 0) {
    console.log("\n--- Failed Documents ---");
    for (const d of failedDocs) {
      const docId = d.id as string;
      const { data: docJobs } = await admin
        .from("processing_jobs")
        .select("id, status, last_error_code, safe_error_message")
        .eq("document_id", docId);
      console.log(`  doc=${docId.slice(0, 8)} (${d.file_name as string})`);
      for (const j of docJobs ?? []) {
        const msg = ((j.safe_error_message as string | null) ?? "").slice(0, 80);
        console.log(`    job=${(j.id as string).slice(0, 8)} status=${j.status as string} err=${j.last_error_code as string | null ?? "-"} msg=${msg}`);
      }
    }
  }

  // Completed docs summary
  console.log("\n--- Completed Documents ---");
  const completedDocs = (docs ?? []).filter(d => (d.processing_status as string) === "completed");
  for (const d of completedDocs) {
    const docId = d.id as string;
    const { count: pc } = await admin
      .from("document_pages")
      .select("id", { count: "exact", head: true })
      .eq("document_id", docId);
    const { count: cc } = await admin
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", docId);
    console.log(`  ${docId.slice(0, 8)} ${d.file_name as string} → ${pc ?? 0} pages, ${cc ?? 0} chunks`);
  }

  // Requirements
  const { data: reqRows } = await admin
    .from("extracted_requirements")
    .select("id, source_document_id, clause_number, requirement_text");
  console.log(`\n--- Extracted Requirements (${reqRows?.length ?? 0} total) ---`);

  console.log("\n=== Done ===");
}

main().catch((e: unknown) => {
  console.error(`Diagnostic failed: ${e instanceof Error ? e.message.slice(0, 200) : "Unknown"}`);
  process.exit(3);
});
