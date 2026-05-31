import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectDeleteButton } from "@/components/projects/project-delete-button";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { listProjects } from "@/server/services/projects";

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create and manage technical compliance review projects.</p>
        </div>
        <Link className={buttonVariants()} href="/projects/new">
          <PlusCircle className="h-4 w-4" aria-hidden="true" />
          New project
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Project register</CardTitle>
          <CardDescription>Each project can hold mixed document roles and independent compliance reviews.</CardDescription>
        </CardHeader>
        <CardContent>
          {projects.length === 0 ? (
            <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
              No projects found. Create a project after Supabase Auth and profiles are configured.
            </div>
          ) : (
            <>
              <div className="space-y-3 md:hidden">
                {projects.map((project) => (
                  <article key={project.id} className="rounded-md border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link className="font-medium hover:underline" href={`/projects/${project.id}`}>
                          {project.name}
                        </Link>
                        <p className="mt-1 text-sm text-muted-foreground">{project.client_name}</p>
                      </div>
                      <ProjectStatusBadge status={project.status} />
                    </div>
                    <div className="mt-3 grid gap-2 text-sm">
                      <div>
                        <span className="text-muted-foreground">Discipline: </span>
                        {project.discipline}
                      </div>
                      <div>
                        <span className="text-muted-foreground">Review type: </span>
                        {project.review_type}
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <ProjectDeleteButton projectId={project.id} projectName={project.name} />
                    </div>
                  </article>
                ))}
              </div>
              <div className="hidden overflow-x-auto md:block">
              <table className="min-w-[760px] w-full text-left text-sm">
                <thead className="border-b text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="py-3 pr-4">Project</th>
                    <th className="py-3 pr-4">Client</th>
                    <th className="py-3 pr-4">Discipline</th>
                    <th className="py-3 pr-4">Review type</th>
                    <th className="py-3 pr-4">Status</th>
                    <th className="py-3 pr-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {projects.map((project) => (
                    <tr key={project.id}>
                      <td className="py-3 pr-4 font-medium">
                        <Link className="hover:underline" href={`/projects/${project.id}`}>
                          {project.name}
                        </Link>
                      </td>
                      <td className="py-3 pr-4">{project.client_name}</td>
                      <td className="py-3 pr-4">{project.discipline}</td>
                      <td className="py-3 pr-4">{project.review_type}</td>
                      <td className="py-3 pr-4">
                        <ProjectStatusBadge status={project.status} />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex justify-end">
                          <ProjectDeleteButton projectId={project.id} projectName={project.name} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
