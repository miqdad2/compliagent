import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function main() {
  const admin = createSupabaseAdminClient();
  if (!admin) { console.error("No admin."); process.exit(2); }

  // Try inserting with awaiting_human_review — will fail with enum error if missing
  const { data, error } = await admin.from("compliance_reviews").insert({
    organization_id: "00000000-0000-0000-0000-000000000001",
    project_id: "22222222-2222-4222-8222-222222222222",
    title: "__enum_test__",
    status: "awaiting_human_review" as never
  }).select("id").single();

  if (error) {
    console.log("Error:", error.message.slice(0, 150));
    if (error.message.includes("awaiting_human_review")) {
      console.log("STATUS: enum value MISSING");
    } else {
      console.log("STATUS: enum value present (failed for other reason)");
    }
  } else if (data) {
    console.log("STATUS: enum value VALID, inserted id=" + (data.id as string).slice(0,8));
    await admin.from("compliance_reviews").delete().eq("id", data.id as string);
  }

  // Also test 'running' (should always work)
  const { error: e2 } = await admin.from("compliance_reviews").insert({
    organization_id: "00000000-0000-0000-0000-000000000001",
    project_id: "22222222-2222-4222-8222-222222222222",
    title: "__enum_test2__",
    status: "running" as never
  }).select("id").single();

  if (e2) {
    console.log("'running' error:", e2.message.slice(0, 100));
  } else {
    console.log("'running' is valid");
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message.slice(0,200) : "Unknown");
  process.exit(3);
});
