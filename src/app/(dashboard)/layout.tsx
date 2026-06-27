import { AppSidebar } from "@/components/layout/app-sidebar";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";

export default async function DashboardLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const setupError = supabaseMissingEnvMessage({ requireServiceRole: true });
  let profile = null;
  let profileError: string | null = null;
  let isAdmin = false;

  if (!setupError) {
    try {
      profile = await getCurrentProfile();
      isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
    } catch (error) {
      profileError = error instanceof Error ? error.message : "Could not load the authenticated profile.";
    }
  }

  return (
    <div className="min-h-screen bg-slate-50/50 lg:flex">
      <AppSidebar profile={profile} isAdmin={isAdmin} />
      <main className="min-w-0 flex-1 flex flex-col">
        {/* Setup / profile errors */}
        {setupError && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 lg:px-8">
            {setupError}
          </div>
        )}
        {profileError && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 lg:px-8">
            {profileError}
          </div>
        )}
        {/* Page content */}
        <div className="flex-1 px-4 py-6 sm:px-6 lg:px-8 max-w-screen-2xl w-full">
          {children}
        </div>
        {/* Subtle footer note */}
        <footer className="border-t px-4 py-3 lg:px-8">
          <p className="text-xs text-muted-foreground">
            AI findings are draft outputs. Final technical approval remains with the responsible engineer or reviewer.
          </p>
        </footer>
      </main>
    </div>
  );
}
