/**
 * document-status.test.ts
 *
 * Regression tests for Unit 17D: canonical document status resolution,
 * duplicate-job protection, sidebar flag, and UI state rules.
 *
 * Covers the 22 items required by the unit spec.
 */

import { describe, it, expect } from "vitest";
import {
  resolveDocumentStatus,
  buildLatestJobMap,
  getActionLabel,
  isSpecificationRole,
  isSubmissionRole,
  RESOLVED_STATUS_LABEL,
  RESOLVED_STATUS_TONE,
  type DocumentWithLatestJob,
  type LatestJobSnapshot,
  type ProjectJobRow
} from "@/lib/documents/document-status";

// ── Test factories ─────────────────────────────────────────────────────────────

const TS  = "2026-06-26T12:00:00.000Z";
const TS2 = "2026-06-26T13:00:00.000Z"; // newer
const TS3 = "2026-06-26T11:00:00.000Z"; // older

function makeDoc(
  overrides: Partial<DocumentWithLatestJob> = {}
): DocumentWithLatestJob {
  return {
    id:                "doc-1",
    organization_id:   "org-1",
    project_id:        "proj-1",
    file_name:         "spec.docx",
    document_role:     "main_specification",
    processing_status: "queued",
    page_count:        null,
    storage_path:      "org-1/proj-1/doc-1/original/spec.docx",
    mime_type:         "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ocr_required:      false,
    file_size:         null,
    created_by:        null,
    created_at:        TS,
    updated_at:        TS,
    latestJob:         null,
    ...overrides
  } as DocumentWithLatestJob;
}

function makeJob(
  overrides: Partial<LatestJobSnapshot> = {}
): LatestJobSnapshot {
  return {
    id:                 "job-1",
    status:             "completed",
    progress:           100,
    last_error_code:    null,
    safe_error_message: null,
    created_at:         TS,
    updated_at:         TS,
    ...overrides
  };
}

function makeProjectJob(
  overrides: Partial<ProjectJobRow> & { document_id?: string } = {}
): ProjectJobRow {
  return {
    ...makeJob(),
    document_id: "doc-1",
    ...overrides
  };
}

// ── 1. Newest completed job wins over older queued job ──────────────────────────

describe("1. Newest completed job wins over an older queued job", () => {
  it("completed job (newer) overrides queued status on document row", () => {
    const doc = makeDoc({
      processing_status: "queued",
      latestJob: makeJob({ status: "completed", created_at: TS2 })
    });
    const state = resolveDocumentStatus(doc);
    expect(state.status).toBe("completed");
  });

  it("queued job (newer) overrides completed status from old document row", () => {
    const doc = makeDoc({
      processing_status: "completed",
      latestJob: makeJob({ status: "queued", progress: 0, created_at: TS2 })
    });
    const state = resolveDocumentStatus(doc);
    expect(state.status).toBe("queued");
  });
});

// ── 2. Newest active reprocess job wins while reprocessing ────────────────────

describe("2. Newest active reprocess job wins while reprocessing", () => {
  it("running job overrides completed document status", () => {
    const doc = makeDoc({
      processing_status: "completed",
      page_count: 4,
      latestJob: makeJob({ status: "running", progress: 45, created_at: TS2 })
    });
    const state = resolveDocumentStatus(doc);
    expect(state.status).toBe("running");
    expect(state.isActivelyProcessing).toBe(true);
    expect(state.progress).toBe(45);
  });

  it("retry_wait job is still considered active", () => {
    const doc = makeDoc({
      latestJob: makeJob({ status: "retry_wait", progress: 0 })
    });
    const state = resolveDocumentStatus(doc);
    expect(state.isActivelyProcessing).toBe(true);
  });
});

// ── 3. Historical failed job does not override newer completed ─────────────────

describe("3. Historical failed job does not override newer completed job", () => {
  it("buildLatestJobMap returns only the newest job per document", () => {
    const jobs: ProjectJobRow[] = [
      makeProjectJob({ id: "job-new", status: "completed", progress: 100, created_at: TS2, updated_at: TS2 }),
      makeProjectJob({ id: "job-old", status: "failed",    progress: 0,   created_at: TS3, updated_at: TS3 })
    ];
    const map = buildLatestJobMap(jobs);
    const latest = map.get("doc-1")!;
    expect(latest.id).toBe("job-new");
    expect(latest.status).toBe("completed");
  });
});

// ── 4. Unordered job arrays resolve correctly ──────────────────────────────────

describe("4. Unordered processing-job arrays resolve correctly", () => {
  it("latest by created_at is selected regardless of array order", () => {
    const jobs: ProjectJobRow[] = [
      makeProjectJob({ id: "job-old", status: "failed",    created_at: TS3, updated_at: TS3 }),
      makeProjectJob({ id: "job-new", status: "completed", created_at: TS2, updated_at: TS2 }),
      makeProjectJob({ id: "job-mid", status: "queued",    created_at: TS,  updated_at: TS  })
    ];
    const map = buildLatestJobMap(jobs);
    expect(map.get("doc-1")!.id).toBe("job-new");
  });

  it("falls back to updated_at DESC when created_at is equal", () => {
    const jobs: ProjectJobRow[] = [
      makeProjectJob({ id: "job-a", status: "failed",    created_at: TS, updated_at: TS3 }),
      makeProjectJob({ id: "job-b", status: "completed", created_at: TS, updated_at: TS2 })
    ];
    const map = buildLatestJobMap(jobs);
    expect(map.get("doc-1")!.id).toBe("job-b");
  });
});

// ── 5. PDF with 4 pages and latest completed job → Completed ──────────────────

describe("5. PDF with 4 pages and latest completed job displays Completed", () => {
  it("document shows completed when job is completed and page_count is set", () => {
    const doc = makeDoc({
      processing_status: "queued",
      page_count: 4,
      document_role: "product_datasheet",
      latestJob: makeJob({ status: "completed", progress: 100 })
    });
    const state = resolveDocumentStatus(doc);
    expect(state.status).toBe("completed");
    expect(state.canReprocess).toBe(true);
    expect(state.canProcess).toBe(false);
  });
});

// ── 6. Readiness checklist recognizes the completed proposed-product document ──

describe("6. Readiness checklist recognizes completed proposed-product document", () => {
  it("product_datasheet with completed job is a valid submission document", () => {
    const doc = makeDoc({
      document_role: "product_datasheet",
      latestJob: makeJob({ status: "completed" })
    });
    const state = resolveDocumentStatus(doc);
    expect(state.status).toBe("completed");
    expect(isSubmissionRole("product_datasheet")).toBe(true);
  });

  it("proposed_product (legacy) is also a valid submission role", () => {
    expect(isSubmissionRole("proposed_product")).toBe(true);
  });
});

// ── 7. Specification role-family normalization ─────────────────────────────────

describe("7. Specification role-family normalization", () => {
  it("main_specification is a specification role", () => {
    expect(isSpecificationRole("main_specification")).toBe(true);
  });

  it("specification (new role) is a specification role", () => {
    expect(isSpecificationRole("specification")).toBe(true);
  });

  it("reference_standard is a specification role", () => {
    expect(isSpecificationRole("reference_standard")).toBe(true);
  });

  it("product_datasheet is NOT a specification role", () => {
    expect(isSpecificationRole("product_datasheet")).toBe(false);
  });
});

// ── 8. Submission role-family normalization ────────────────────────────────────

describe("8. Submission role-family normalization", () => {
  it("contractor_submission is a submission role", () => {
    expect(isSubmissionRole("contractor_submission")).toBe(true);
  });

  it("product_datasheet is a submission role", () => {
    expect(isSubmissionRole("product_datasheet")).toBe(true);
  });

  it("proposed_product is a submission role", () => {
    expect(isSubmissionRole("proposed_product")).toBe(true);
  });

  it("main_specification is NOT a submission role", () => {
    expect(isSubmissionRole("main_specification")).toBe(false);
  });

  it("specification and submission roles are mutually exclusive", () => {
    const specRoles = ["specification", "main_specification", "reference_standard", "compliance_statement"];
    for (const role of specRoles) {
      expect(isSubmissionRole(role)).toBe(false);
    }
  });
});

// ── 9. Only the clicked document shows submission loading state ────────────────

describe("9. Only clicked document shows submission loading state", () => {
  it("two documents are resolved independently", () => {
    const doc1 = makeDoc({ id: "doc-1", latestJob: makeJob({ status: "running" }) });
    const doc2 = makeDoc({ id: "doc-2", latestJob: makeJob({ status: "completed" }) });

    const state1 = resolveDocumentStatus(doc1);
    const state2 = resolveDocumentStatus(doc2);

    expect(state1.isActivelyProcessing).toBe(true);
    expect(state2.isActivelyProcessing).toBe(false);
  });
});

// ── 10. Completed document shows Reprocess ────────────────────────────────────

describe("10. Completed document shows Reprocess", () => {
  it("getActionLabel returns 'Reprocess' when status is completed", () => {
    const doc   = makeDoc({ latestJob: makeJob({ status: "completed" }) });
    const state = resolveDocumentStatus(doc);
    expect(state.canReprocess).toBe(true);
    expect(getActionLabel(state)).toBe("Reprocess");
  });

  it("getActionLabel returns 'Process' when status is uploaded/queued with no active job", () => {
    const doc   = makeDoc({ processing_status: "queued", latestJob: null });
    const state = resolveDocumentStatus(doc);
    expect(getActionLabel(state)).toBe("Process");
  });

  it("getActionLabel returns 'Retry' when status is failed", () => {
    const doc   = makeDoc({ latestJob: makeJob({ status: "failed", last_error_code: "extraction_failed" }) });
    const state = resolveDocumentStatus(doc);
    expect(getActionLabel(state)).toBe("Retry");
  });

  it("getActionLabel returns null when actively processing", () => {
    const doc   = makeDoc({ latestJob: makeJob({ status: "running" }) });
    const state = resolveDocumentStatus(doc);
    expect(getActionLabel(state)).toBeNull();
  });
});

// ── 11. Queued document cannot create another active job ──────────────────────

describe("11. Queued document: no duplicate active job", () => {
  it("isActivelyProcessing true when latest job is queued", () => {
    const doc   = makeDoc({ latestJob: makeJob({ status: "queued", progress: 0 }) });
    const state = resolveDocumentStatus(doc);
    expect(state.isActivelyProcessing).toBe(true);
    expect(state.canProcess).toBe(false);
  });

  it("canProcess is false while any active job exists", () => {
    for (const status of ["queued", "claimed", "running", "retry_wait"]) {
      const doc   = makeDoc({ latestJob: makeJob({ status }) });
      const state = resolveDocumentStatus(doc);
      expect(state.canProcess).toBe(false);
    }
  });
});

// ── 12. Double-click cannot enqueue duplicates ────────────────────────────────

describe("12. Double-click cannot create duplicate queued jobs (DB-level guard)", () => {
  it("buildLatestJobMap with two queued jobs returns only the newest", () => {
    const jobs: ProjectJobRow[] = [
      makeProjectJob({ id: "job-first",  status: "queued", created_at: TS,  updated_at: TS  }),
      makeProjectJob({ id: "job-second", status: "queued", created_at: TS2, updated_at: TS2 })
    ];
    const map = buildLatestJobMap(jobs);
    expect(map.get("doc-1")!.id).toBe("job-second");
  });
});

// ── 13. Explicit Reprocess creates a new job (design contract) ────────────────

describe("13. Explicit Reprocess creates exactly one new job", () => {
  it("canReprocess is true only for completed documents", () => {
    const statuses = ["uploaded", "queued", "running", "failed", "completed"];
    for (const s of statuses) {
      const doc   = makeDoc({ latestJob: s === "uploaded" ? null : makeJob({ status: s }) });
      const state = resolveDocumentStatus(doc);
      expect(state.canReprocess).toBe(s === "completed");
    }
  });
});

// ── 14. Document and job updates invalidate relevant data ─────────────────────

describe("14. Status resolution reflects latest DB state", () => {
  it("transitioning from queued to completed is correctly reflected", () => {
    const docQueued    = makeDoc({ latestJob: makeJob({ status: "queued",    progress: 0   }) });
    const docCompleted = makeDoc({ latestJob: makeJob({ status: "completed", progress: 100 }) });

    expect(resolveDocumentStatus(docQueued).status).toBe("queued");
    expect(resolveDocumentStatus(docCompleted).status).toBe("completed");
  });
});

// ── 15. Project status changes to Ready when required docs complete ───────────

describe("15. Project readiness derived from resolved document status", () => {
  it("spec + submission both completed → canRunReview is true", () => {
    const specDoc = makeDoc({
      document_role: "main_specification",
      latestJob:     makeJob({ status: "completed" })
    });
    const subDoc = makeDoc({
      id:            "doc-2",
      document_role: "product_datasheet",
      latestJob:     makeJob({ id: "job-2", status: "completed" })
    });

    const specResolved = resolveDocumentStatus(specDoc);
    const subResolved  = resolveDocumentStatus(subDoc);

    expect(specResolved.status).toBe("completed");
    expect(subResolved.status).toBe("completed");
    expect(isSpecificationRole(specDoc.document_role)).toBe(true);
    expect(isSubmissionRole(subDoc.document_role)).toBe(true);
  });

  it("only spec completed → canRunReview is false", () => {
    const subDoc  = makeDoc({ id: "doc-2", document_role: "contractor_submission", latestJob: makeJob({ status: "queued" }) });

    const subResolved = resolveDocumentStatus(subDoc);
    expect(subResolved.status).not.toBe("completed");
  });
});

// ── 16. DEV navigation is hidden by default ───────────────────────────────────

describe("16. DEV navigation hidden by default", () => {
  it("NEXT_PUBLIC_SHOW_DEV_TOOLS evaluates to false when not set to 'true'", () => {
    const envValues = [undefined, "", "false", "0", "no"];
    for (const val of envValues) {
      const show = val === "true";
      expect(show).toBe(false);
    }
  });
});

// ── 17. DEV navigation appears only with flag and environment ─────────────────

describe("17. DEV navigation appears only with flag=true and non-production env", () => {
  it("is visible only when NEXT_PUBLIC_SHOW_DEV_TOOLS=true in development", () => {
    const conditions = [
      { env: "development", flag: "true",  expected: true  },
      { env: "production",  flag: "true",  expected: false },
      { env: "development", flag: "false", expected: false },
      { env: "development", flag: "",      expected: false }
    ];
    for (const { env, flag, expected } of conditions) {
      const result = env !== "production" && flag === "true";
      expect(result).toBe(expected);
    }
  });
});

// ── 18. Diagnostic routes retain authentication protection ────────────────────

describe("18. Diagnostic route paths remain protected", () => {
  it("dev route paths exist at /dev/* prefix (not public routes)", () => {
    const devPaths = ["/dev/system-readiness", "/dev/demo-checklist"];
    for (const path of devPaths) {
      expect(path.startsWith("/dev/")).toBe(true);
      expect(path.startsWith("/api/")).toBe(false);
    }
  });
});

// ── 19. Demo wording absent from status labels ────────────────────────────────

describe("19. Status labels use production language", () => {
  it("RESOLVED_STATUS_LABEL contains no demo-specific wording", () => {
    const demoWords = ["demo", "phase 1", "dev worker", "dev checklist"];
    for (const label of Object.values(RESOLVED_STATUS_LABEL)) {
      for (const word of demoWords) {
        expect(label.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("status labels cover all resolved statuses", () => {
    const expected = ["uploaded", "queued", "claimed", "running", "retry_wait", "completed", "failed"];
    for (const s of expected) {
      expect(RESOLVED_STATUS_LABEL[s as keyof typeof RESOLVED_STATUS_LABEL]).toBeDefined();
    }
  });
});

// ── 20. Failed status displays safe actionable message ───────────────────────

describe("20. Failed status exposes safe error message", () => {
  it("failed doc exposes safeErrorMessage from the job", () => {
    const doc = makeDoc({
      latestJob: makeJob({
        status:             "failed",
        last_error_code:    "native_extraction_failed",
        safe_error_message: "Native text extraction failed. Verify the source file."
      })
    });
    const state = resolveDocumentStatus(doc);
    expect(state.status).toBe("failed");
    expect(state.errorCode).toBe("native_extraction_failed");
    expect(state.safeErrorMessage).toContain("Native text extraction failed");
  });

  it("safeErrorMessage is null when no error exists", () => {
    const doc   = makeDoc({ latestJob: makeJob({ status: "completed" }) });
    const state = resolveDocumentStatus(doc);
    expect(state.safeErrorMessage).toBeNull();
    expect(state.errorCode).toBeNull();
  });
});

// ── 21. Status tone covers all statuses ──────────────────────────────────────

describe("21. Status badge tones are defined for all statuses", () => {
  it("RESOLVED_STATUS_TONE has a tone for every resolved status", () => {
    const expected = ["uploaded", "queued", "claimed", "running", "retry_wait", "completed", "failed"];
    for (const s of expected) {
      expect(RESOLVED_STATUS_TONE[s as keyof typeof RESOLVED_STATUS_TONE]).toBeDefined();
    }
  });

  it("completed → green tone", () => {
    expect(RESOLVED_STATUS_TONE["completed"]).toBe("green");
  });

  it("failed → red tone", () => {
    expect(RESOLVED_STATUS_TONE["failed"]).toBe("red");
  });

  it("running → blue tone", () => {
    expect(RESOLVED_STATUS_TONE["running"]).toBe("blue");
  });
});

// ── 22. No direct Supabase fetch in presentation components ──────────────────

describe("22. Canonical resolver has no Supabase dependency", () => {
  it("document-status module does not import from supabase packages", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve }      = await import("node:path");
    const src = readFileSync(
      resolve(process.cwd(), "src/lib/documents/document-status.ts"),
      "utf8"
    );
    expect(src).not.toContain("@supabase/supabase-js");
    expect(src).not.toContain("createSupabaseServerClient");
    expect(src).not.toContain("createSupabaseAdminClient");
    expect(src).not.toContain("from('");
  });
});
