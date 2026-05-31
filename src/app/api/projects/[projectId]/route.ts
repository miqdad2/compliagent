import { NextResponse } from "next/server";
import { projectUpdateSchema } from "@/lib/db/schemas";
import { canCreateProject } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ data: null, setupRequired: true, error: supabaseMissingEnvMessage() });
  }

  const { data, error } = await supabase.from("projects").select("*").eq("id", projectId).maybeSingle();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data });
}

export async function PATCH(request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: supabaseMissingEnvMessage() ?? "Supabase is not configured." }, { status: 500 });
  }

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load user profile." }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  if (!canCreateProject(profile.role)) {
    return NextResponse.json({ error: "You do not have permission to update projects." }, { status: 403 });
  }

  const input = projectUpdateSchema.parse(await request.json());
  const update = {
    name: input.name,
    client_name: input.clientName,
    discipline: input.discipline,
    review_type: input.reviewType,
    description: input.description,
    status: input.status
  };

  const { data, error } = await supabase.from("projects").update(update).eq("id", projectId).select("*").single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { projectId } = await context.params;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: supabaseMissingEnvMessage() ?? "Supabase is not configured." }, { status: 500 });
  }

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load user profile." }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json({ error: "Authentication is required." }, { status: 401 });
  }

  if (!canCreateProject(profile.role)) {
    return NextResponse.json({ error: "You do not have permission to archive projects." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("projects")
    .update({ status: "archived" })
    .eq("id", projectId)
    .eq("organization_id", profile.organization_id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data });
}
