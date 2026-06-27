/**
 * CLI script to re-enqueue specific documents that have failed processing jobs.
 * Enqueues ALL documents currently in "queued" or "failed" status with no active job.
 *
 * Run with: tsx --env-file .env src/server/workers/reenqueue-documents.ts
 *
 * Safe to run from CLI — uses admin client, no browser session required.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function reenqueue(admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>, documentId: string): Promise<void> {
  const { data: doc, error: docError } = await admin
    .from("documents")
    .select("id, file_name, organization_id, project_id, storage_path, mime_type, processing_status")
    .eq("id", documentId)
    .single();

  if (docError || !doc) {
    console.error(`  doc=${documentId.slice(0, 8)}: NOT FOUND — ${docError?.message ?? "no data"}`);
    return;
  }

  console.log(`\ndoc=${(doc.id as string).slice(0, 8)} (${doc.file_name as string}) status=${doc.processing_status as string}`);

  // Check for active jobs
  const { data: activeJob } = await admin
    .from("processing_jobs")
    .select("id, status")
    .eq("document_id", documentId)
    .in("status", ["queued", "claimed", "running", "retry_wait"])
    .limit(1)
    .maybeSingle();

  if (activeJob) {
    console.log(`  → Active job ${(activeJob.id as string).slice(0, 8)} status=${activeJob.status as string} — skipping`);
    return;
  }

  const { data: job, error: jobError } = await admin
    .from("processing_jobs")
    .insert({
      organization_id: doc.organization_id,
      project_id: doc.project_id,
      document_id: doc.id,
      job_type: "document_extraction",
      status: "queued",
      progress: 0,
      priority: 5,
      available_at: new Date().toISOString(),
      metadata: {
        storagePath: doc.storage_path,
        mimeType: doc.mime_type,
        reenqueuedAt: new Date().toISOString()
      }
    })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error(`  → FAILED to create job: ${jobError?.message ?? "unknown"}`);
    return;
  }

  await admin.from("documents").update({ processing_status: "queued" }).eq("id", documentId);
  console.log(`  → Created job ${(job.id as string).slice(0, 8)} — document re-queued`);
}

async function main() {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    console.error("Cannot create admin client — check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    process.exit(2);
  }

  // Enqueue any document currently in failed or queued status with no active job
  const { data: docs } = await admin
    .from("documents")
    .select("id, file_name, processing_status")
    .in("processing_status", ["failed", "queued"])
    .in("file_name", [
      "Doc.-1-Specifications-Highlighted-References-.docx",
      "Doc.-4-Proposed-Speaker-with-referencing.pdf"
    ]);

  console.log("=== Re-enqueue target documents ===");

  if (!docs || docs.length === 0) {
    console.log("No target documents found in failed/queued status.");
  } else {
    for (const d of docs) {
      await reenqueue(admin, d.id as string);
    }
  }

  console.log("\n=== Done — run pnpm worker:documents to process ===");
}

main().catch((e: unknown) => {
  console.error(`Script failed: ${e instanceof Error ? e.message.slice(0, 200) : "Unknown"}`);
  process.exit(3);
});
