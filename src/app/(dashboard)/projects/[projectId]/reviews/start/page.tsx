import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/permissions/server";
import { canRunReview } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StartReviewForm } from "@/components/reviews/start-review-form";
import { resolveAnthropicKey } from "@/server/services/ai/anthropic-provider";

type StartReviewPageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function StartReviewPage({ params }: StartReviewPageProps) {
  const { projectId } = await params;

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch {
    redirect("/login");
  }
  if (!profile) redirect("/login");
  if (!canRunReview(profile.role)) redirect(`/projects/${projectId}`);

  const admin = createSupabaseAdminClient();
  if (!admin) notFound();

  const { data: project } = await admin
    .from("projects")
    .select("id, name, organization_id, discipline, review_type")
    .eq("id", projectId)
    .maybeSingle();

  if (!project || project.organization_id !== profile.organization_id) notFound();

  // Check whether processed documents exist.
  const { data: processedDocs } = await admin
    .from("documents")
    .select("id, file_name, document_role, processing_status")
    .eq("project_id", projectId)
    .eq("processing_status", "completed");

  const hasSpecification = (processedDocs ?? []).some((d) =>
    ["specification", "main_specification", "reference_standard"].includes(d.document_role)
  );
  const hasSubmission = (processedDocs ?? []).some((d) =>
    ["contractor_submission", "proposed_product", "product_datasheet", "certificate",
     "drawing", "calculation", "method_statement", "test_report",
     "supporting_evidence", "manual", "compliance_statement", "other"].includes(d.document_role)
  );
  const canStart = hasSpecification && hasSubmission;

  // Check AI settings for live mode availability.
  const { data: aiSettings } = await admin
    .from("organization_ai_settings")
    .select("ai_enabled, consent_granted_at, enabled_providers")
    .eq("organization_id", profile.organization_id)
    .maybeSingle();

  const hasAnthropicKey = !!resolveAnthropicKey();
  const liveAiAvailable =
    aiSettings?.ai_enabled &&
    aiSettings?.consent_granted_at &&
    (aiSettings?.enabled_providers as string[] ?? []).length > 0 &&
    hasAnthropicKey;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {project.name}
        </Link>
        <h1 className="text-2xl font-semibold">Run automated technical review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {project.discipline} — {project.review_type}
        </p>
      </div>

      {!canStart && (
        <Card>
          <CardContent className="pt-4 text-sm text-amber-700">
            Process at least one specification document and one submission document before starting a review.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Execution mode</CardTitle>
          <CardDescription>
            Choose how conditions are compared. Deterministic mode uses no external AI calls.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StartReviewForm
            projectId={projectId}
            canStart={canStart}
            liveAiAvailable={!!liveAiAvailable}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documents</CardTitle>
          <CardDescription>Processed documents ready for review.</CardDescription>
        </CardHeader>
        <CardContent>
          {(processedDocs ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No processed documents yet.</p>
          ) : (
            <div className="space-y-1.5">
              {(processedDocs ?? []).map((doc) => (
                <div key={doc.id} className="flex items-center justify-between gap-3 text-sm rounded-md border px-3 py-2">
                  <span className="font-medium truncate min-w-0">{(doc as { file_name?: string }).file_name ?? doc.id.slice(0, 8) + "…"}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{doc.document_role.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
