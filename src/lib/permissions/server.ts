import { getStaticAuthSession, staticLoginEmail } from "@/lib/auth/static-auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import type { Database } from "@/types/database";
import type { UserRole } from "@/types/domain";

export type AuthProfile = Database["public"]["Tables"]["profiles"]["Row"];

async function ensureDefaultOrganization() {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    throw new Error(
      supabaseMissingEnvMessage({ requireServiceRole: true }) ??
        "Supabase service role client is required to create default organizations."
    );
  }

  const { data: existingOrganization, error: selectError } = await admin
    .from("organizations")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    throw new Error(`Could not load organization: ${selectError.message}`);
  }

  if (existingOrganization) {
    return existingOrganization;
  }

  const { data: createdOrganization, error: insertError } = await admin
    .from("organizations")
    .insert({ name: "Default Organization" })
    .select("*")
    .single();

  if (insertError) {
    throw new Error(`Could not create default organization: ${insertError.message}`);
  }

  return createdOrganization;
}

export async function ensureUserProfile(input: {
  userId: string;
  email?: string | null;
  fullName?: string | null;
}): Promise<AuthProfile> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    throw new Error(
      supabaseMissingEnvMessage({ requireServiceRole: true }) ??
        "Supabase service role client is required to create user profiles."
    );
  }

  const { data: existingProfile, error: profileError } = await admin
    .from("profiles")
    .select("*")
    .eq("user_id", input.userId)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Could not load user profile: ${profileError.message}`);
  }

  if (existingProfile) {
    return existingProfile as AuthProfile;
  }

  const organization = await ensureDefaultOrganization();
  const { count, error: countError } = await admin.from("profiles").select("id", { count: "exact", head: true });

  if (countError) {
    throw new Error(`Could not count profiles: ${countError.message}`);
  }

  const role: UserRole = count === 0 ? "admin" : "engineer";
  const fullName = input.fullName || input.email || null;

  const { data: createdProfile, error: insertError } = await admin
    .from("profiles")
    .insert({
      user_id: input.userId,
      organization_id: organization.id,
      full_name: fullName,
      role
    })
    .select("*")
    .single();

  if (insertError) {
    throw new Error(`Could not create user profile: ${insertError.message}`);
  }

  return createdProfile as AuthProfile;
}

async function findOrCreateStaticAuthUser(input: { username: string; displayName: string }) {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    throw new Error(
      supabaseMissingEnvMessage({ requireServiceRole: true }) ??
        "Supabase service role client is required to create the static login profile."
    );
  }

  const email = staticLoginEmail(input.username);
  const { data: userList, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });

  if (listError) {
    throw new Error(`Could not load auth users: ${listError.message}`);
  }

  const existingUser = userList.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
  if (existingUser) {
    return existingUser;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      full_name: input.displayName
    }
  });

  if (error || !data.user) {
    throw new Error(`Could not create static auth user: ${error?.message ?? "Unknown Supabase Auth error."}`);
  }

  return data.user;
}

async function ensureStaticProfile(session: { username: string; displayName: string }): Promise<AuthProfile> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    throw new Error(
      supabaseMissingEnvMessage({ requireServiceRole: true }) ??
        "Supabase service role client is required to create the static login profile."
    );
  }

  const { data: existingProfile, error: profileError } = await admin
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Could not load user profile: ${profileError.message}`);
  }

  if (existingProfile) {
    return existingProfile as AuthProfile;
  }

  const authUser = await findOrCreateStaticAuthUser(session);
  return ensureUserProfile({
    userId: authUser.id,
    email: authUser.email,
    fullName: session.displayName
  });
}

export async function getCurrentProfile(): Promise<AuthProfile | null> {
  const staticSession = await getStaticAuthSession();
  if (staticSession) {
    return ensureStaticProfile(staticSession);
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return null;
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  return ensureUserProfile({
    userId: user.id,
    email: user.email,
    fullName: typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : null
  });
}

export async function requireRole(allowedRoles: UserRole[]) {
  const profile = await getCurrentProfile();

  if (!profile) {
    throw new Error("Authentication is required.");
  }

  if (!allowedRoles.includes(profile.role)) {
    throw new Error("You do not have permission to perform this action.");
  }

  return profile;
}
