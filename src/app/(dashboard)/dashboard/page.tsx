import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock3, FileText, FolderKanban } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listProjects } from "@/server/services/projects";

export default async function DashboardPage() {
  const projects = await listProjects();
  const activeProjects = projects.filter((project) => project.status !== "archived");

  const metrics = [
    { label: "Total projects", value: activeProjects.length, icon: FolderKanban },
    { label: "Pending reviews", value: activeProjects.filter((project) => project.status.includes("review")).length, icon: Clock3 },
    { label: "Completed reports", value: activeProjects.filter((project) => project.status === "approved").length, icon: CheckCircle2 },
    { label: "Needs attention", value: activeProjects.filter((project) => project.status === "processing").length, icon: AlertTriangle }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track projects, document processing, AI review status, and human review workload.
          </p>
        </div>
        <Link className={buttonVariants()} href="/projects/new">
          Create project
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{metric.label}</CardTitle>
              <metric.icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{metric.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent projects</CardTitle>
          <CardDescription>Projects are generic across disciplines and review types.</CardDescription>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center">
              <FileText className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
              <p className="mt-3 text-sm font-medium">No projects yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Configure Supabase and create your first technical review project.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {projects.slice(0, 6).map((project) => (
                <Link className="flex items-center justify-between py-3 text-sm" href={`/projects/${project.id}`} key={project.id}>
                  <span className="font-medium">{project.name}</span>
                  <span className="text-muted-foreground">{project.status.replaceAll("_", " ")}</span>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
