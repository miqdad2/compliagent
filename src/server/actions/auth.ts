"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import {
  clearStaticAuthSessionCookie,
  setStaticAuthSessionCookie,
  staticAuthMissingEnvMessage,
  validateStaticCredentials
} from "@/lib/auth/static-auth";
import { ensureUserProfile, getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const staticAuthInputSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

const supabaseAuthInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().trim().max(160).optional()
});

function redirectWithAuthError(message: string): never {
  redirect(`/login?error=${encodeURIComponent(message)}`);
}

function safeNextPath(value: FormDataEntryValue | null) {
  const path = typeof value === "string" && value.startsWith("/") ? value : "/dashboard";
  return path.startsWith("//") ? "/dashboard" : path;
}

export async function signInAction(formData: FormData) {
  const parsed = staticAuthInputSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password")
  });

  if (!parsed.success) {
    redirectWithAuthError("Enter the configured username and password.");
  }

  const setupError = staticAuthMissingEnvMessage() ?? supabaseMissingEnvMessage({ requireServiceRole: true });
  if (setupError) {
    redirectWithAuthError(setupError);
  }

  if (!validateStaticCredentials(parsed.data)) {
    redirectWithAuthError("The username or password is incorrect.");
  }

  await setStaticAuthSessionCookie();
  await getCurrentProfile();

  redirect(safeNextPath(formData.get("next")));
}

export async function signUpAction() {
  redirectWithAuthError("Account creation is disabled for this single-user installation.");
}

export async function signOutAction() {
  await clearStaticAuthSessionCookie();

  const supabase = await createSupabaseServerClient();
  if (supabase) {
    await supabase.auth.signOut();
  }

  redirect("/login");
}

export async function supabaseSignInAction(formData: FormData) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirectWithAuthError(supabaseMissingEnvMessage() ?? "Supabase is not configured.");
  }

  const parsed = supabaseAuthInputSchema.pick({ email: true, password: true }).safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });

  if (!parsed.success) {
    redirectWithAuthError("Enter a valid email and password.");
  }

  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    redirectWithAuthError(error.message);
  }

  if (!data.session) {
    redirect(`/login?error=${encodeURIComponent("Check your email to confirm your account before signing in.")}`);
  }

  if (data.user) {
    await ensureUserProfile({
      userId: data.user.id,
      email: data.user.email,
      fullName: typeof data.user.user_metadata?.full_name === "string" ? data.user.user_metadata.full_name : null
    });
  }

  redirect(safeNextPath(formData.get("next")));
}
