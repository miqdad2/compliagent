import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight, CheckCircle2, Clock, FileText,
  FolderKanban, PlusCircle, RefreshCw, AlertCircle
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCurrentProfile } from "@/lib/permissions/server";
import { canSeeOverview } from "@/lib/permissions/roles";
import { listProjects } from "@/server/services/projects";
import type { ProjectRow } from "@/server/services/projects";
import type { ProjectStatus } from "@/types/domain";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft:                "Draft",
  documents_uploaded:   "Documents uploaded",
  processing:           "Processing",
  ready_for_review:     "Ready for review",
  ai_review_running:    "Review running",
  ai_review_completed:  "Review complete",
  human_review_pending: "Awaiting reviewer",
  approved:             "Approved",
  rejected:             "Rejected",
  archived:             "Archived"
};

type Tone = "green" | "amber" | "blue" | "red" | "gray";
const STATUS_TONE: Record<ProjectStatus, Tone> = {
  draft:                "gray",
  documents_uploaded:   "gray",
  processing:           "blue",
  ready_for_review:     "green",
  ai_review_running:    "blue",
  ai_review_completed:  "blue",
  human_review_pending: "amber",
  approved:             "green",
  rejected:             "red",
  archived:             "gray"
};

function pLabel(p: ProjectRow): string { return STATUS_LABEL[p.status] ?? p.status.replace(/_/g, " "); }
function pTone(p:  ProjectRow): Tone   { return STATUS_TONE[p.status]  ?? "gray"; }

function timeAgo(iso: string): string {
  const ms   = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1)   return "Just now";
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default async function OverviewPage() {
  // Guard: only authorized roles may view the Overview.
  let profile = null;
  try { profile = await getCurrentProfile(); } catch { /* handled below */ }
  if (!profile || !canSeeOverview(profile.role)) {
    redirect("/projects");
  }

  const allProjects      = await listProjects();
  const activeProjects   = allProjects.filter((p) => p.status !== "archived");
  const archivedProjects = allProjects.filter((p) => p.status === "archived");

  const awaitingReview = activeProjects.filter((p) =>
    ["human_review_pending", "ai_review_completed"].includes(p.status)
  ).length;
  const processing      = activeProjects.filter((p) => p.status === "processing").length;
  const completedReview = activeProjects.filter((p) => p.status === "approved").length;

  const metrics = [
    { label: "Active projects",          value: activeProjects.length, icon: FolderKanban, href: "/projects", note: archivedProjects.length > 0 ? `${archivedProjects.length} archived` : "All active" },
    { label: "Awaiting review action",   value: awaitingReview,        icon: Clock,        href: "/projects", note: "Human review pending" },
    { label: "Documents processing",     value: processing,            icon: RefreshCw,    href: "/projects", note: "In progress" },
    { label: "Approved reviews",         value: completedReview,       icon: CheckCircle2, href: "/projects", note: "Fully approved" }
  ];

  const recentProjects = [...allProjects]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 8);

  return (
    <div className="space-y-8">

      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Organization-wide view of projects, reviews, and processing activity.
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/projects" className={buttonVariants({ variant: "outline", size: "sm" })}>View all projects</Link>
          <Link href="/projects/new" className={buttonVariants({ size: "sm" })}>
            <PlusCircle className="h-4 w-4" aria-hidden="true" />
            Create project
          </Link>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <Link key={m.label} href={m.href}
            className="group flex flex-col gap-2 rounded-xl border bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{m.label}</p>
              <m.icon className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
            </div>
            <p className="text-3xl font-bold leading-none">{m.value}</p>
            <p className="text-xs text-muted-foreground">{m.note}</p>
          </Link>
        ))}
      </div>

      {/* Project activity */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Project activity</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Recent projects across all statuses</p>
          </div>
          <Link href="/projects" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            View all <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>

        {recentProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border-2 border-dashed border-slate-200 mb-4">
              <FileText className="h-5 w-5 text-muted-foreground/50" aria-hidden="true" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">No projects yet</p>
            <Link href="/projects/new" className={`${buttonVariants({ size: "sm" })} mt-4`}>
              <PlusCircle className="h-4 w-4" /> Create project
            </Link>
          </div>
        ) : (
          <div className="divide-y">
            {recentProjects.map((project) => (
              <Link key={project.id} href={`/projects/${project.id}`}
                className="group flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50/70 transition-colors">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                  project.status === "archived" ? "bg-slate-100" :
                  project.status === "approved" ? "bg-emerald-50" :
                  project.status.includes("review") ? "bg-amber-50" : "bg-primary/10"
                }`}>
                  <FolderKanban className={`h-4 w-4 ${
                    project.status === "archived" ? "text-slate-400" :
                    project.status === "approved" ? "text-emerald-600" :
                    project.status.includes("review") ? "text-amber-600" : "text-primary/70"
                  }`} aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{project.name}</p>
                    {project.status === "archived" && <Badge tone="gray" className="text-[10px] shrink-0">Archived</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {[project.client_name, project.discipline, project.review_type].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Badge tone={pTone(project)}>{pLabel(project)}</Badge>
                  <p className="text-[10px] text-muted-foreground">{timeAgo(project.updated_at)}</p>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors shrink-0" aria-hidden="true" />
              </Link>
            ))}
          </div>
        )}
      </div>

      {archivedProjects.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">
            <span className="font-medium">{archivedProjects.length} archived project{archivedProjects.length !== 1 ? "s" : ""}</span>
            {" "}visible in the list above with read-only access.
          </p>
        </div>
      )}
    </div>
  );
}
