/**
 * Diagnose a specific project's document and job state.
 * Usage: tsx --env-file .env src/server/workers/diagnose-project.ts [projectId]
 */
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildLatestJobMap } from "@/lib/documents/document-status";
import type { ProjectJobRow } from "@/lib/documents/document-status";

async function main() {
  const admin = createSupabaseAdminClient();
  if (!admin) { console.error("No admin client."); process.exit(2); }

  // List all projects
  const { data: projects } = await admin
    .from("projects")
    .select("id, name, status, updated_at")
    .order("updated_at", { ascending: false });

  console.log("=== Projects ===");
  for (const p of (projects ?? [])) {
    console.log(`  ${(p.id as string).slice(0,8)} ${p.name as string} status=${p.status as string}`);
  }

  // Check specific project IDs
  const projectIds = [
    "85b5a526", // potentially new project
    "ebd8aa84", // original target project
    ...((process.argv[2] ? [process.argv[2]] : []))
  ];

  for (const projPrefix of projectIds) {
    const proj = (projects ?? []).find(p => (p.id as string).startsWith(projPrefix));
    if (!proj) { console.log(`\nProject ${projPrefix}: NOT FOUND`); continue; }

    const projId = proj.id as string;
    console.log(`\n=== Project ${projId.slice(0,8)} (${proj.name as string}) ===`);

    // Documents
    const { data: docs } = await admin
      .from("documents")
      .select("id, file_name, document_role, processing_status, page_count")
      .eq("project_id", projId)
      .order("created_at", { ascending: false });

    console.log(`  Documents (${(docs ?? []).length}):`);
    for (const d of (docs ?? [])) {
      console.log(`    ${(d.id as string).slice(0,8)} ${d.file_name as string} role=${d.document_role as string} status=${d.processing_status as string} pages=${d.page_count ?? "?"}`);
    }

    // Jobs for this project
    const { data: jobs } = await admin
      .from("processing_jobs")
      .select("id, document_id, project_id, status, job_type, progress, last_error_code, created_at")
      .eq("project_id", projId)
      .order("created_at", { ascending: false })
      .limit(10);

    console.log(`  Processing jobs (${(jobs ?? []).length}):`);
    for (const j of (jobs ?? [])) {
      console.log(`    ${(j.id as string).slice(0,8)} doc=${j.document_id ? (j.document_id as string).slice(0,8) : "null"} type=${j.job_type as string} status=${j.status as string}`);
    }

    // Test the buildLatestJobMap logic
    const { data: extractionJobs } = await admin
      .from("processing_jobs")
      .select("id, document_id, status, progress, last_error_code, safe_error_message, created_at, updated_at")
      .eq("project_id", projId)
      .eq("job_type", "document_extraction")
      .order("created_at", { ascending: false });

    const jobMap = buildLatestJobMap((extractionJobs ?? []) as ProjectJobRow[]);
    console.log(`  Latest extraction job per doc (${jobMap.size} entries):`);
    for (const [docId, job] of jobMap) {
      console.log(`    doc=${docId.slice(0,8)} job=${job.id.slice(0,8)} status=${job.status}`);
    }

    // What the resolver would return
    console.log(`  Resolved status for each document:`);
    for (const d of (docs ?? [])) {
      const latestJob = jobMap.get(d.id as string) ?? null;
      const status = latestJob ? latestJob.status : (d.processing_status as string);
      console.log(`    ${(d.id as string).slice(0,8)} resolved=${status} (job: ${latestJob ? "YES" : "NO"}, doc.status=${d.processing_status as string})`);
    }
  }

  console.log("\n=== Done ===");
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message.slice(0,200) : "Unknown");
  process.exit(3);
});
