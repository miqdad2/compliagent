import { NextResponse } from "next/server";
import { projectInputSchema } from "@/lib/db/schemas";
import { canCreateProject } from "@/lib/permissions/roles";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ data: [], setupRequired: true, error: supabaseMissingEnvMessage() });
  }

  const { data, error } = await supabase.from("projects").select("*").order("updated_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: Request) {
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
    return NextResponse.json({ error: "You do not have permission to create projects." }, { status: 403 });
  }

  const input = projectInputSchema.parse(await request.json());
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
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
