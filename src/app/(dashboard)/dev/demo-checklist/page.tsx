/**
 * /dev/demo-checklist — guided pre-demo and during-demo reference.
 *
 * Static page. Dev-only; returns 404 in production unless ENABLE_DEV_DIAGNOSTICS=true.
 * Contains no secrets, no credentials, and no system-state queries.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";

const isDev =
  process.env.NODE_ENV !== "production" ||
  process.env.ENABLE_DEV_DIAGNOSTICS === "true";

export default function DemoChecklistPage() {
  if (!isDev) notFound();

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <div className="mb-1 inline-flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
          DEV ONLY
        </div>
        <h1 className="text-2xl font-semibold">Demo checklist</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Run through this list before and during every client demo. See also{" "}
          <Link href="/dev/system-readiness" className="underline hover:text-foreground">
            System readiness
          </Link>{" "}
          for automated infrastructure checks.
        </p>
      </div>

      <Section title="Before the demo">
        <CheckItem>
          Visit{" "}
          <Link href="/dev/system-readiness" className="underline hover:text-foreground">
            /dev/system-readiness
          </Link>{" "}
          and confirm every item is READY or WARNING — no BLOCKED items.
        </CheckItem>
        <CheckItem>
          Confirm the <strong>documents</strong> and <strong>exports</strong> storage buckets are
          private in Supabase Storage.
        </CheckItem>
        <CheckItem>
          Confirm all four demo documents (Doc. 1–4) have been uploaded and their processing
          status shows <strong>completed</strong> in the document register.
        </CheckItem>
        <CheckItem>
          If any document shows <strong>queued</strong>, use the &ldquo;Trigger document processing&rdquo;
          button on{" "}
          <Link href="/dev/system-readiness" className="underline hover:text-foreground">
            System readiness
          </Link>{" "}
          or click <strong>Process</strong> in the document register (it auto-triggers the worker).
        </CheckItem>
        <CheckItem>
          Confirm a review has been run and its status is <strong>awaiting human review</strong> or{" "}
          <strong>approved</strong>. Open the workspace to verify findings are populated.
        </CheckItem>
        <CheckItem>
          Log in as the demo user account (not as yourself) to ensure the demo session matches
          what the client will see.
        </CheckItem>
        <CheckItem>
          Disable any browser extensions that modify page layout or inject overlays.
        </CheckItem>
      </Section>

      <Section title="During the demo">
        <CheckItem>
          <strong>Upload flow:</strong> Upload one document → click Process → status changes to{" "}
          <em>completed</em>. The worker auto-runs after clicking Process; no manual step needed.
        </CheckItem>
        <CheckItem>
          <strong>Start review:</strong> Navigate to <em>Start controlled review</em> → confirm
          documents list shows filenames (not UUIDs) → select Deterministic mode → click Start.
          The workspace opens automatically.
        </CheckItem>
        <CheckItem>
          <strong>Workspace:</strong> Show the requirement tree → select a finding → confirm
          evidence viewer shows source text. Show the status badge and reasoning panel.
        </CheckItem>
        <CheckItem>
          <strong>Human review:</strong> Confirm a finding → show that status updates immediately.
          Explain that AI findings remain drafts until a qualified reviewer approves them.
        </CheckItem>
        <CheckItem>
          <strong>Annotations:</strong> If ready for annotation gate is satisfied, show the
          annotated PDF download. Confirm the download uses a signed URL (not a public link).
        </CheckItem>
        <CheckItem>
          <strong>Compliance matrix:</strong> Show the project page matrix — complied, partial,
          not complied, and ambiguous counts. Mention that the matrix is source-backed, not
          hallucinated.
        </CheckItem>
        <CheckItem>
          <strong>Chat:</strong> Ask a factual question the documents answer. Verify the response
          cites a document and page number. Do not ask questions outside the document scope.
        </CheckItem>
      </Section>

      <Section title="Do NOT claim during this demo">
        <DoNotItem>
          Do not claim that findings are automatically approved. Human approval is always required.
        </DoNotItem>
        <DoNotItem>
          Do not claim that Word or Excel report exports are available. These are not implemented.
        </DoNotItem>
        <DoNotItem>
          Do not claim that OCR is enabled. Native text extraction only; scanned PDFs require
          manual OCR outside the system.
        </DoNotItem>
        <DoNotItem>
          Do not claim live Anthropic API calls are made during this demo (unless controlled live
          mode is confirmed configured and org consent is granted).
        </DoNotItem>
        <DoNotItem>
          Do not claim DOCX, PPTX, or XLSX visual annotations are supported. PDF only.
        </DoNotItem>
        <DoNotItem>
          Do not claim cross-organization data is accessible. Each org&apos;s data is fully isolated.
        </DoNotItem>
        <DoNotItem>
          Do not claim that this page or /dev/system-readiness are available in production.
          Dev diagnostics pages are disabled by default in production builds.
        </DoNotItem>
      </Section>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-muted-foreground">
        <p>
          This checklist covers the demo scope for Unit 16. It is a reference document only and is
          not shown to clients. Update it in{" "}
          <code className="rounded bg-slate-200 px-1 py-0.5">src/app/(dashboard)/dev/demo-checklist/page.tsx</code>{" "}
          as the product evolves.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function CheckItem({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-md border bg-white p-3 text-sm">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-300 bg-slate-50 text-xs text-slate-400">
        ☐
      </span>
      <span className="leading-relaxed text-muted-foreground">{children}</span>
    </div>
  );
}

function DoNotItem({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-md border border-red-100 bg-red-50/50 p-3 text-sm">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-red-300 bg-red-100 text-xs font-bold text-red-500">
        ✕
      </span>
      <span className="leading-relaxed text-muted-foreground">{children}</span>
    </div>
  );
}
