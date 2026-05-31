"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { projectInputSchema } from "@/lib/db/schemas";
import { canCreateProject } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ProjectFormState = {
  error: string | null;
};

export async function createProjectAction(_previousState: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return { error: supabaseMissingEnvMessage() ?? "Supabase is not configured." };
  }

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not load or create your user profile." };
  }

  if (!profile) {
    return { error: "Authentication is required to create projects." };
  }

  if (!canCreateProject(profile.role)) {
    return { error: "You do not have permission to create projects." };
  }

  const parsed = projectInputSchema.safeParse({
    name: formData.get("name"),
    clientName: formData.get("clientName"),
    discipline: formData.get("discipline"),
    reviewType: formData.get("reviewType"),
    description: formData.get("description")
  });

  if (!parsed.success) {
    return { error: parsed.error.issues.map((issue) => issue.message).join(" ") };
  }

  const input = parsed.data;

  const { data, error } = await supabase
    .from("projects")
    .insert({
      organization_id: profile.organization_id,
      name: input.name,
      client_name: input.clientName,
      discipline: input.discipline,
      review_type: input.reviewType,
      description: input.description || null,
      created_by: profile.id
    })
    .select("id")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/projects");
  redirect(`/projects/${data.id}`);
}
