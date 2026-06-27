/**
 * CLI diagnostic: runs a deterministic controlled review directly against Supabase.
 * No HTTP, no browser session required.
 *
 * Usage: tsx --env-file .env src/server/workers/run-deterministic-review.ts
 *
 * Uses the real project ID for the two completed target documents.
 * Reports review ID, finding count, condition count, and any errors.
 */

import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SupabaseReviewGateway } from "@/server/services/reviews/supabase-review-gateway";
import { SupabaseComplianceGateway } from "@/server/services/compliance/supabase-compliance-gateway";
import { SupabaseProvisionalRequirementGateway } from "@/server/services/reviews/provisional-requirement-gateway";
import { ReviewOrchestrator } from "@/server/services/reviews/review-orchestrator";

const TARGET_PROJECT_ID = "ebd8aa84-ac1f-4108-acf2-3f6fa1beb48e";
const PROMPT_VERSION    = "1.0.0";
const EXTRACTION_VERSION = "controlled-review:1.0.0";

async function main() {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    console.error("Cannot create admin client — check environment variables.");
    process.exit(2);
  }

  console.log("=== Deterministic Review CLI Runner ===\n");

  // Verify target documents
  const { data: docs } = await admin
    .from("documents")
    .select("id, file_name, document_role, processing_status, organization_id")
    .eq("project_id", TARGET_PROJECT_ID)
    .eq("processing_status", "completed");

  console.log("--- Completed documents in project ---");
  for (const d of (docs ?? [])) {
    console.log(`  ${(d.id as string).slice(0, 8)} ${d.file_name as string} role=${d.document_role as string}`);
  }

  if (!docs || docs.length === 0) {
    console.error("No completed documents found for this project. Aborting.");
    process.exit(3);
  }

  const orgId = docs[0].organization_id as string;
  console.log(`\nOrg: ${orgId.slice(0, 8)}, Project: ${TARGET_PROJECT_ID.slice(0, 8)}`);

  // Load a profile to use as creator (any admin user)
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("organization_id", orgId)
    .limit(1)
    .maybeSingle();

  if (!profile) {
    console.error("No profile found for org. Aborting.");
    process.exit(3);
  }
  console.log(`Creator profile: ${(profile.id as string).slice(0, 8)} role=${profile.role as string}`);

  // Create a review row
  const { data: reviewRow, error: insertError } = await admin
    .from("compliance_reviews")
    .insert({
      organization_id: orgId,
      project_id: TARGET_PROJECT_ID,
      title: "CLI deterministic review — Unit 17C",
      review_scope: "Active speaker PA compliance check",
      status: "draft",
      created_by: profile.id as string
    })
    .select("id, review_version")
    .single();

  if (insertError || !reviewRow) {
    console.error(`Failed to create review: ${insertError?.message ?? "unknown"}`);
    process.exit(3);
  }

  const reviewId = reviewRow.id as string;
  console.log(`\nCreated review: ${reviewId}`);

  const sourceHash = createHash("sha256")
    .update(`${TARGET_PROJECT_ID}:${EXTRACTION_VERSION}:${PROMPT_VERSION}:deterministic`)
    .digest("hex");

  const reviewGateway    = new SupabaseReviewGateway(admin);
  const complianceGateway = new SupabaseComplianceGateway(admin);
  const provisionalGateway = new SupabaseProvisionalRequirementGateway(admin);
  const orchestrator = new ReviewOrchestrator(reviewGateway, complianceGateway, null, provisionalGateway);

  console.log("\nRunning deterministic review pipeline...");
  const result = await orchestrator.runControlledReview({
    organizationId:    orgId,
    projectId:         TARGET_PROJECT_ID,
    reviewId,
    createdBy:         profile.id as string,
    reviewVersion:     (reviewRow.review_version as number | null) ?? 1,
    sourceHash,
    extractionVersion: EXTRACTION_VERSION,
    promptVersion:     PROMPT_VERSION,
    executionMode:     "deterministic"
  });

  console.log("\n--- Review result ---");
  if (!result.ok) {
    console.error(`Review FAILED: [${result.errorCode}] ${result.message}`);
    process.exit(4);
  }

  console.log(`Status:           ${result.data.status}`);
  console.log(`Findings:         ${result.data.findingCount}`);
  console.log(`Conditions:       ${result.data.conditionCount}`);
  console.log(`Requirements:     ${result.data.requirementCount}`);
  console.log(`AI runs:          ${result.data.aiRunCount}`);
  console.log(`Human review req: ${result.data.humanReviewRequiredCount}`);
  console.log(`Flags:            ${result.data.flags.join(", ") || "(none)"}`);
  console.log(`Idempotent skip:  ${result.data.idempotentSkip}`);

  // Check for findings in DB
  const { data: findings } = await admin
    .from("compliance_findings")
    .select("id, clause_number, status, confidence_score, deterministic_derived_status")
    .eq("review_id", reviewId);

  console.log(`\n--- Findings in DB (${(findings ?? []).length}) ---`);
  for (const f of (findings ?? [])) {
    console.log(`  ${(f.id as string).slice(0, 8)} clause=${f.clause_number as string | null ?? "(none)"} status=${f.status as string} det=${f.deterministic_derived_status as string | null ?? "?"} conf=${f.confidence_score as number}`);
  }

  // Check provisional requirements
  const { data: reqs } = await admin
    .from("extracted_requirements")
    .select("id, clause_number, requirement_state, mandatory_level, requirement_text")
    .eq("project_id", TARGET_PROJECT_ID)
    .eq("is_active", true);

  console.log(`\n--- Provisional requirements in DB (${(reqs ?? []).length}) ---`);
  for (const r of (reqs ?? []).slice(0, 5)) {
    const text = (r.requirement_text as string).slice(0, 80);
    console.log(`  ${(r.id as string).slice(0, 8)} clause=${r.clause_number as string | null ?? "(none)"} state=${r.requirement_state as string} lvl=${r.mandatory_level as string | null ?? "?"} text="${text}"`);
  }

  // Check conditions
  const { count: condCount } = await admin
    .from("requirement_conditions")
    .select("id", { count: "exact", head: true })
    .eq("project_id", TARGET_PROJECT_ID);
  console.log(`\nConditions in DB: ${condCount ?? 0}`);

  // Check evaluations
  const { count: evalCount } = await admin
    .from("condition_evaluations")
    .select("id", { count: "exact", head: true })
    .eq("review_id", reviewId);
  console.log(`Evaluations in DB: ${evalCount ?? 0}`);

  console.log(`\nReview workspace: /projects/${TARGET_PROJECT_ID}/reviews/${reviewId}`);
  console.log("\n=== Done ===");
}

main().catch((e: unknown) => {
  console.error(`CLI review failed: ${e instanceof Error ? e.message.slice(0, 200) : "Unknown"}`);
  process.exit(5);
});
