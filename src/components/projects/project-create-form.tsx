"use client";

import { useActionState } from "react";
import { createProjectAction } from "@/server/actions/projects";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ProjectCreateForm() {
  const [state, formAction, isPending] = useActionState(createProjectAction, { error: null });

  return (
    <Card>
      <CardHeader>
        <CardTitle>New review project</CardTitle>
        <CardDescription>Create a reusable technical compliance review project for any discipline.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name">Project name</Label>
              <Input id="name" name="name" required placeholder="Airport terminal ELV submittal review" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="clientName">Client name</Label>
              <Input id="clientName" name="clientName" required placeholder="Client or authority" />
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="discipline">Discipline</Label>
              <Input id="discipline" name="discipline" required placeholder="Electrical, Mechanical, Civil, ICT..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reviewType">Review type</Label>
              <Input id="reviewType" name="reviewType" required placeholder="Material submittal, tender compliance..." />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Review scope</Label>
            <Textarea id="description" name="description" placeholder="Describe what documents and requirements should be reviewed." />
          </div>
          {state.error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{state.error}</div>
          ) : null}
          <Button className="w-fit" disabled={isPending} type="submit">
            {isPending ? "Creating..." : "Create project"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
