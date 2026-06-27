import Link from "next/link";
import { ArrowRight, FolderKanban, PlusCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProjectDeleteButton } from "@/components/projects/project-delete-button";
import { listProjects } from "@/server/services/projects";
import type { ProjectRow } from "@/server/services/projects";
import type { ProjectStatus } from "@/types/domain";

type Tone = "green" | "amber" | "blue" | "red" | "gray";

const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft:                "Draft",
  documents_uploaded:   "Documents uploaded",
  processing:           "Processing",
  ready_for_review:     "Ready for review",
  ai_review_running:    "Review running",
  ai_review_completed:  "Review complete",
  human_review_pending: "Needs your review",
  approved:             "Approved",
  rejected:             "Rejected",
  archived:             "Archived"
};

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

/** Primary action label derived from project status. */
function nextAction(p: ProjectRow): string | null {
  switch (p.status) {
    case "draft":
    case "documents_uploaded":    return "Upload documents";
    case "processing":            return "View processing";
    case "ready_for_review":      return "Start review";
    case "ai_review_running":     return "View progress";
    case "ai_review_completed":
    case "human_review_pending":  return "Review flagged findings";
    case "approved":              return "View report";
    default:                      return null;
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function ProjectRow({ project, dimmed = false }: { project: ProjectRow; dimmed?: boolean }) {
  const tone   = STATUS_TONE[project.status as ProjectStatus] ?? "gray";
  const label  = STATUS_LABEL[project.status as ProjectStatus] ?? project.status.replace(/_/g, " ");
  const action = nextAction(project);

  return (
    <tr className={`group border-b last:border-0 hover:bg-slate-50/70 transition-colors ${dimmed ? "opacity-55" : ""}`}>
      <td className="py-3 px-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100">
            <FolderKanban className="h-4 w-4 text-slate-500" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <Link href={`/projects/${project.id}`}
              className="text-sm font-medium hover:underline underline-offset-2">
              {project.name}
            </Link>
            {project.client_name && (
              <p className="text-xs text-muted-foreground truncate">{project.client_name}</p>
            )}
          </div>
        </div>
      </td>
      <td className="py-3 px-4 text-xs text-muted-foreground hidden sm:table-cell">{project.discipline}</td>
      <td className="py-3 px-4"><Badge tone={tone}>{label}</Badge></td>
      <td className="py-3 px-4 text-xs text-muted-foreground hidden xl:table-cell">{formatDate(project.updated_at)}</td>
      <td className="py-3 px-4">
        <div className="flex items-center justify-end gap-2">
          {action && !dimmed && (
            <Link href={`/projects/${project.id}`}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-slate-50 transition-colors opacity-0 group-hover:opacity-100">
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
              {action}
            </Link>
          )}
          <ProjectDeleteButton projectId={project.id} projectName={project.name} />
        </div>
      </td>
    </tr>
  );
}

function TableHead() {
  return (
    <thead className="bg-slate-50/70">
      <tr className="border-b">
        <th className="py-2.5 px-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Project</th>
        <th className="py-2.5 px-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Discipline</th>
        <th className="py-2.5 px-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Stage</th>
        <th className="py-2.5 px-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden xl:table-cell">Updated</th>
        <th className="py-2.5 px-4 sr-only">Actions</th>
      </tr>
    </thead>
  );
}

export default async function ProjectsPage() {
  const allProjects = await listProjects();

  const needsAttention = allProjects.filter((p) =>
    ["human_review_pending", "ai_review_completed"].includes(p.status)
  );
  const activeProjects   = allProjects.filter((p) =>
    p.status !== "archived" && !needsAttention.some((n) => n.id === p.id)
  );
  const archivedProjects = allProjects.filter((p) => p.status === "archived");

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Open a project to continue document processing or technical review.
          </p>
        </div>
        <Link className={buttonVariants({ size: "sm" })} href="/projects/new">
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          Create project
        </Link>
      </div>

      {/* Needs attention */}
      {needsAttention.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-white shadow-sm overflow-hidden">
          <div className="border-b border-amber-100 bg-amber-50 px-5 py-3">
            <h2 className="text-sm font-semibold text-amber-800">Needs your attention</h2>
            <p className="text-xs text-amber-700 mt-0.5">These projects are awaiting reviewer action.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <TableHead />
              <tbody>{needsAttention.map((p) => <ProjectRow key={p.id} project={p} />)}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Active projects */}
      <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
        <div className="border-b px-5 py-3.5">
          <h2 className="text-sm font-semibold">
            Active projects
            {activeProjects.length > 0 && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">{activeProjects.length}</span>
            )}
          </h2>
        </div>
        {activeProjects.length === 0 && needsAttention.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-6">
            <FolderKanban className="h-8 w-8 text-muted-foreground/40 mb-3" aria-hidden="true" />
            <p className="text-sm font-medium text-muted-foreground">No active projects</p>
            <p className="mt-1 text-xs text-muted-foreground/70">
              Create a project to start a compliance review.
            </p>
            <Link className={`${buttonVariants({ size: "sm" })} mt-4`} href="/projects/new">
              <PlusCircle className="h-4 w-4" />
              Create project
            </Link>
          </div>
        ) : activeProjects.length === 0 ? null : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <TableHead />
              <tbody>{activeProjects.map((p) => <ProjectRow key={p.id} project={p} />)}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* Archived projects */}
      {archivedProjects.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
          <div className="border-b px-5 py-3.5">
            <h2 className="text-sm font-semibold">
              Archived
              <span className="ml-2 text-xs font-normal text-muted-foreground">{archivedProjects.length}</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Archived projects retain all documents and review history.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <TableHead />
              <tbody>{archivedProjects.map((p) => <ProjectRow key={p.id} project={p} dimmed />)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
