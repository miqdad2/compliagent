import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, AlertTriangle, CheckCircle2, Download, FileText } from "lucide-react";
import { getCurrentProfile } from "@/lib/permissions/server";
import { canModifyHumanReview, canRunReview } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GenerateAnnotationsButton } from "@/components/reviews/generate-annotations-button";

type AnnotationsPageProps = {
  params: Promise<{ projectId: string; reviewId: string }>;
};

export default async function AnnotationsPage({ params }: AnnotationsPageProps) {
  const { projectId, reviewId } = await params;

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

  const { data: review } = await admin
    .from("compliance_reviews")
    .select("*")
    .eq("id", reviewId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!review) notFound();
  if (review.organization_id !== null && review.organization_id !== profile.organization_id) notFound();

  const annotationReady = !!(review as Record<string, unknown>)["annotation_ready"];

  // Load annotation outputs.
  const { data: outputs } = await admin
    .from("annotation_outputs")
    .select("*")
    .eq("review_id", reviewId)
    .neq("draft_status", "superseded")
    .order("created_at", { ascending: false });

  // Load finding counts.
  const { count: approvedCount } = await admin
    .from("compliance_findings")
    .select("id", { count: "exact", head: true })
    .eq("review_id", reviewId)
    .not("reviewed_by", "is", null);

  const { count: totalCount } = await admin
    .from("compliance_findings")
    .select("id", { count: "exact", head: true })
    .eq("review_id", reviewId);

  const canGenerate = canModifyHumanReview(profile.role) && annotationReady;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          href={`/projects/${projectId}/reviews/${reviewId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to review workspace
        </Link>
        <h1 className="text-2xl font-semibold">Annotation draft</h1>
        <p className="text-sm text-muted-foreground mt-1">{review.title}</p>
      </div>

      {/* Readiness status */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {annotationReady ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <span className="text-sm font-medium text-green-700">Ready for annotation</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  <span className="text-sm font-medium text-amber-700">Not yet ready for annotation</span>
                </>
              )}
            </div>
            <div className="text-sm text-muted-foreground">
              {approvedCount ?? 0} of {totalCount ?? 0} findings approved
            </div>
          </div>

          {!annotationReady && (
            <div className="mt-3 text-sm text-amber-700 rounded-md bg-amber-50 border border-amber-200 p-3">
              Resolve all annotation blockers in the review workspace, then mark the review ready for annotation before generating the annotated PDF.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Generate action */}
      {canGenerate && (
        <Card>
          <CardHeader>
            <CardTitle>Generate annotated PDF</CardTitle>
            <CardDescription>
              Creates a new annotated copy of each submitted PDF. The original files are never modified.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GenerateAnnotationsButton reviewId={reviewId} projectId={projectId} />
            <p className="text-xs text-muted-foreground mt-3">
              Only approved findings with evidence regions are annotated. Annotations with missing coordinates will show text-only callouts.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Existing outputs */}
      <Card>
        <CardHeader>
          <CardTitle>Annotation outputs</CardTitle>
          <CardDescription>Previously generated annotated PDFs for this review.</CardDescription>
        </CardHeader>
        <CardContent>
          {(outputs ?? []).length === 0 ? (
            <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              No annotation drafts yet. Generate one above.
            </div>
          ) : (
            <div className="space-y-3">
              {(outputs ?? []).map((output) => {
                const warnings = output.warnings as Array<{ pageNumber: number; message: string }> | null;
                const warningCount = Array.isArray(warnings) ? warnings.length : 0;
                return (
                  <div key={output.id} className="rounded-md border p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">
                          {output.annotation_count} annotation{output.annotation_count !== 1 ? "s" : ""} — {output.page_count} page{output.page_count !== 1 ? "s" : ""}
                        </span>
                        <Badge tone={output.draft_status === "approved" ? "green" : "gray"}>
                          {output.draft_status}
                        </Badge>
                      </div>
                      <a
                        href={`/api/reviews/${reviewId}/annotations/${output.id}/download`}
                        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 transition-colors"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </a>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Generated {new Date(output.created_at).toLocaleString()} · {output.renderer_version}
                    </div>
                    {warningCount > 0 && (
                      <div className="flex items-center gap-1 text-xs text-amber-700">
                        <AlertTriangle className="h-3 w-3" />
                        {warningCount} placement warning{warningCount !== 1 ? "s" : ""} — some annotations may require manual repositioning.
                      </div>
                    )}
                    <p className="text-xs text-slate-400 font-mono">SHA-256: {output.output_hash.slice(0, 16)}…</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
