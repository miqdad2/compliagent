import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isStaticAuthConfigured, staticAuthCookieName, verifyStaticSessionToken } from "@/lib/auth/static-auth-core";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "./config";

const protectedPathPrefixes = ["/dashboard", "/projects", "/settings", "/users"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request
  });

  const isProtectedPath = protectedPathPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix));

  if (isStaticAuthConfigured()) {
    const staticSession = await verifyStaticSessionToken(request.cookies.get(staticAuthCookieName)?.value);

    if (!staticSession && isProtectedPath) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set("next", request.nextUrl.pathname);
      return NextResponse.redirect(redirectUrl);
    }

    if (staticSession && request.nextUrl.pathname === "/login") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }

    return response;
  }

  if (!isSupabaseConfigured()) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response = NextResponse.next({ request });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: "", ...options });
        response = NextResponse.next({ request });
        response.cookies.set({ name, value: "", ...options });
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user && isProtectedPath) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && request.nextUrl.pathname === "/login") {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
