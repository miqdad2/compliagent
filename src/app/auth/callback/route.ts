import { NextResponse } from "next/server";
import { ensureUserProfile } from "@/lib/permissions/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") ?? "/dashboard";
  const redirectUrl = new URL(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard", requestUrl.origin);

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("error", supabaseMissingEnvMessage() ?? "Supabase is not configured.");
    return NextResponse.redirect(redirectUrl);
  }

  if (!code) {
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("error", "Authentication callback is missing the confirmation code.");
    return NextResponse.redirect(redirectUrl);
  }

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(redirectUrl);
  }

  if (data.user) {
    try {
      await ensureUserProfile({
        userId: data.user.id,
        email: data.user.email,
        fullName: typeof data.user.user_metadata?.full_name === "string" ? data.user.user_metadata.full_name : null
      });
    } catch (profileError) {
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set(
        "error",
        profileError instanceof Error ? profileError.message : "Could not create your user profile."
      );
      return NextResponse.redirect(redirectUrl);
    }
  }

  return NextResponse.redirect(redirectUrl);
}
