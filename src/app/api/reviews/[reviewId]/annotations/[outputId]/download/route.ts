import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/permissions/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/reviews/[reviewId]/annotations/[outputId]/download
 *
 * Returns a signed download URL for an approved annotated PDF.
 * Requires authentication and org membership.
 * Private storage — never publicly accessible.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ reviewId: string; outputId: string }> }
) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ error: "Supabase not configured." }, { status: 500 });

  let profile;
  try { profile = await getCurrentProfile(); } catch { return NextResponse.json({ error: "Auth required." }, { status: 401 }); }
  if (!profile) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { reviewId, outputId } = await params;
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Service unavailable." }, { status: 500 });

  const { data: output } = await admin
    .from("annotation_outputs")
    .select("*")
    .eq("id", outputId)
    .eq("review_id", reviewId)
    .maybeSingle();

  if (!output) return NextResponse.json({ error: "Annotation output not found." }, { status: 404 });
  if (output.organization_id !== profile.organization_id) return NextResponse.json({ error: "Access denied." }, { status: 403 });

  // Generate a time-limited signed URL (10 minutes).
  const { data: signedUrl, error: signedError } = await admin.storage
    .from("exports")
    .createSignedUrl(output.output_storage_path, 600);

  if (signedError || !signedUrl) {
    return NextResponse.json({ error: "Could not generate download URL." }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    organization_id: profile.organization_id,
    project_id:      output.project_id,
    user_id:         profile.id,
    action:          "annotation.output_downloaded",
    entity_type:     "annotation_outputs",
    entity_id:       outputId,
    metadata:        { reviewId, outputHash: output.output_hash }
  });

  return NextResponse.json({
    data: {
      downloadUrl: signedUrl.signedUrl,
      expiresInSeconds: 600,
      outputId,
      outputHash: output.output_hash,
      draftStatus: output.draft_status
    }
  });
}
