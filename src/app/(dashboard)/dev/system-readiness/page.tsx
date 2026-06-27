/**
 * /dev/system-readiness — development-only diagnostics page.
 *
 * Disabled in production unless ENABLE_DEV_DIAGNOSTICS=true.
 * Never exposes: service-role key, access tokens, raw credentials,
 * full connection strings, or API key values.
 */

import { notFound, redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/permissions/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runReadinessChecks } from "@/lib/diagnostics/readiness";
import { buildDiagnosticsClient, buildEnvFlags } from "@/lib/diagnostics/client";
import { TriggerWorkerButton } from "@/components/dev/trigger-worker-button";
import type { ReadinessItem, ReadinessStatus } from "@/lib/diagnostics/readiness";

const isDev =
  process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_DEV_DIAGNOSTICS === "true";

export default async function SystemReadinessPage() {
  if (!isDev) notFound();

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch {
    redirect("/login");
  }
  if (!profile) redirect("/login");

  const admin = createSupabaseAdminClient();
  const env = buildEnvFlags();

  let report: Awaited<ReturnType<typeof runReadinessChecks>> | null = null;
  let buildError: string | null = null;

  if (!admin) {
    buildError = "Supabase admin client could not be created — SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is missing.";
  } else {
    try {
      report = await runReadinessChecks(buildDiagnosticsClient(admin), env);
    } catch (err) {
      buildError = err instanceof Error ? err.message : "Unknown error running diagnostics.";
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <div className="mb-1 inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
          DEV ONLY
        </div>
        <h1 className="text-2xl font-semibold">System readiness</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pre-demo health check. No credentials or secret values are shown on this page.
          {report ? ` Checked at ${new Date(report.checkedAt).toLocaleTimeString()}.` : null}
        </p>
      </div>

      {buildError && (
        <div className="rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-medium">Could not run diagnostics</p>
          <p className="mt-1">{buildError}</p>
        </div>
      )}

      {report && (
        <>
          <OverallBanner status={report.overallStatus} />

          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="border-b bg-slate-50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Check</th>
                  <th className="px-4 py-3 text-left font-medium w-28">Status</th>
                  <th className="px-4 py-3 text-left font-medium">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {report.items.map((item) => (
                  <ReadinessRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="rounded-lg border p-5 space-y-3">
        <div>
          <p className="font-medium text-sm">Trigger document processing</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Runs the document processing worker for up to 10 queued jobs. Requires authentication.
            This button is a no-op in production (the endpoint returns 404 there).
          </p>
        </div>
        <TriggerWorkerButton />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-xs text-muted-foreground space-y-1">
        <p className="font-semibold text-slate-700">Security reminders</p>
        <p>This page shows only boolean presence flags — not the actual values of any environment variable.</p>
        <p>Service-role keys, access tokens, connection strings, and API key values are never rendered here.</p>
        <p>Set ENABLE_DEV_DIAGNOSTICS=false (or leave unset in production) to disable this page.</p>
      </div>
    </div>
  );
}

function OverallBanner({ status }: { status: ReadinessStatus }) {
  if (status === "ready") {
    return (
      <div className="rounded-md border border-green-300 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
        All checks passed — system is ready for demo.
      </div>
    );
  }
  if (status === "warning") {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
        One or more warnings — review the table below before the demo.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm font-medium text-red-800">
      One or more blockers — the system is not ready. Resolve BLOCKED items before proceeding.
    </div>
  );
}

function StatusPill({ status }: { status: ReadinessStatus }) {
  if (status === "ready") {
    return (
      <span className="inline-flex items-center rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
        READY
      </span>
    );
  }
  if (status === "warning") {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
        WARNING
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
      BLOCKED
    </span>
  );
}

function ReadinessRow({ item }: { item: ReadinessItem }) {
  return (
    <tr className={item.status === "blocked" ? "bg-red-50/50" : item.status === "warning" ? "bg-amber-50/30" : ""}>
      <td className="px-4 py-3 font-medium">{item.label}</td>
      <td className="px-4 py-3">
        <StatusPill status={item.status} />
      </td>
      <td className="px-4 py-3 text-muted-foreground">{item.detail}</td>
    </tr>
  );
}
