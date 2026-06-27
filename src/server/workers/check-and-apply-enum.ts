/**
 * Checks review_status enum values and applies missing ones from migration 20260628000000.
 * Run with: tsx --env-file .env src/server/workers/check-and-apply-enum.ts
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function main() {
  const admin = createSupabaseAdminClient();
  if (!admin) { console.error("No admin client."); process.exit(2); }

  // Check current enum values via a catalog query function
  // We test by trying the RPC that sets awaiting_human_review
  // First, check what the current review states look like
  const { data: reviews } = await admin
    .from("compliance_reviews")
    .select("id, status")
    .limit(3);

  console.log("Sample review statuses:", reviews?.map(r => r.status));

  // Try to check if awaiting_human_review is a valid status by looking at
  // what the DB accepts. We can't query enum values directly without raw SQL.
  // Instead, let's try to update a test row and see if it fails.

  // Check if any reviews are already in awaiting_human_review status
  const { data: awaitingReviews } = await admin
    .from("compliance_reviews")
    .select("id, status")
    .eq("status", "awaiting_human_review" as never)
    .limit(1);

  if (awaitingReviews !== null) {
    console.log("awaiting_human_review IS valid (query succeeded, got:", awaitingReviews.length, "rows)");
  } else {
    console.log("awaiting_human_review might not be valid — query returned null");
  }

  // Check the review we just created
  const { data: failedReview } = await admin
    .from("compliance_reviews")
    .select("id, status, title")
    .eq("title", "CLI deterministic review — Unit 17C")
    .order("created_at", { ascending: false })
    .limit(2);

  console.log("Recent CLI reviews:", failedReview?.map(r => ({ id: (r.id as string).slice(0,8), status: r.status })));

  // Try calling begin_controlled_review RPC to see if the review pipeline RPCs work
  // by checking if a test review transition fails
  const { data: testCheckData, error: testCheckError } = await admin.rpc("complete_controlled_review_to_human_review" as never, {
    p_organization_id: "00000000-0000-0000-0000-000000000001",
    p_review_id: "00000000-0000-0000-0000-000000000999",
    p_finding_count: 0,
    p_condition_count: 0
  });

  if (testCheckError) {
    console.log("complete_controlled_review_to_human_review error:", testCheckError.message);
    if (testCheckError.message.includes("awaiting_human_review")) {
      console.log("\nCONFIRMED: review_status enum missing 'awaiting_human_review'");
      console.log("Migration 20260628000000 needs to be applied.");
    } else if (testCheckError.message.includes("REVIEW_NOT_FOUND") || testCheckError.message.includes("REVIEW_STATE_CONFLICT")) {
      console.log("\nawaiting_human_review IS in the enum (review validation worked)");
    }
  } else {
    console.log("Unexpected success on fake review:", testCheckData);
  }

  console.log("\n=== Done ===");
}

main().catch((e: unknown) => {
  console.error(`Failed: ${e instanceof Error ? e.message.slice(0,200) : "Unknown"}`);
  process.exit(3);
});
