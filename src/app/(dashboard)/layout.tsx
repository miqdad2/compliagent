import { AppSidebar } from "@/components/layout/app-sidebar";
import { getCurrentProfile } from "@/lib/permissions/server";
import { supabaseMissingEnvMessage } from "@/lib/supabase/config";

export default async function DashboardLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const setupError = supabaseMissingEnvMessage({ requireServiceRole: true });
  let profileError: string | null = null;

  if (!setupError) {
    try {
      await getCurrentProfile();
    } catch (error) {
      profileError = error instanceof Error ? error.message : "Could not load or create the authenticated profile.";
    }
  }

  return (
    <div className="min-h-screen lg:flex">
      <AppSidebar />
      <main className="min-w-0 flex-1">
        <div className="border-b bg-white px-4 py-4 lg:px-8">
          <p className="text-sm text-muted-foreground">
            CompliAgent assists technical reviewers. Final approval remains with the responsible engineer or reviewer.
          </p>
        </div>
        {setupError ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 lg:px-8">
            {setupError}
          </div>
        ) : null}
        {profileError ? (
          <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 lg:px-8">
            {profileError}
          </div>
        ) : null}
        <div className="px-3 py-5 sm:px-4 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
