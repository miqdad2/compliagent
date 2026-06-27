/**
 * one-click-review.test.ts
 *
 * Regression tests for Unit 17J: One-Click Automated Review Orchestration.
 *
 * Test strategy: source-file inspection (same pattern as 17I tests). These
 * tests verify the structural contracts of each file without requiring a
 * running server or live database.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  resolveAutomatedReviewAction,
  type AutomatedReviewActionInput
} from "@/lib/projects/automated-review-state";

const ROOT = resolve(__dirname, "../..");

function readSrc(rel: string): string {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

// ── 1. Automated review state resolver (pure logic) ──────────────────────────

describe("Unit 17J: resolveAutomatedReviewAction — review states", () => {
  const base: AutomatedReviewActionInput = {
    hasSpec:                 true,
    hasSubmission:           true,
    isAnyDocumentProcessing: false,
    hasAnyFailedDocuments:   false,
    canRunReview:            true,
    latestReview:            null
  };

  it("returns review_approved when review is approved", () => {
    const r = resolveAutomatedReviewAction({ ...base, latestReview: { id: "r1", status: "approved" } });
    expect(r.state).toBe("review_approved");
    expect(r.action.type).toBe("view_approved");
  });

  it("returns review_requires_attention when review is awaiting_human_review", () => {
    const r = resolveAutomatedReviewAction({ ...base, latestReview: { id: "r1", status: "awaiting_human_review" } });
    expect(r.state).toBe("review_requires_attention");
    expect(r.action.type).toBe("review_findings");
  });

  it("returns review_running for draft review", () => {
    const r = resolveAutomatedReviewAction({ ...base, latestReview: { id: "r1", status: "draft" } });
    expect(r.state).toBe("review_running");
    expect(r.action.type).toBe("view_progress");
  });

  it("returns review_running for running review", () => {
    const r = resolveAutomatedReviewAction({ ...base, latestReview: { id: "r1", status: "running" } });
    expect(r.state).toBe("review_running");
    expect(r.action.type).toBe("view_progress");
  });

  it("view_progress action carries the reviewId", () => {
    const r = resolveAutomatedReviewAction({ ...base, latestReview: { id: "review-xyz", status: "draft" } });
    expect(r.action.type).toBe("view_progress");
    if (r.action.type === "view_progress") {
      expect(r.action.reviewId).toBe("review-xyz");
    }
  });

  it("review_findings action carries the reviewId", () => {
    const r = resolveAutomatedReviewAction({ ...base, latestReview: { id: "review-abc", status: "awaiting_human_review" } });
    expect(r.action.type).toBe("review_findings");
    if (r.action.type === "review_findings") {
      expect(r.action.reviewId).toBe("review-abc");
    }
  });
});

describe("Unit 17J: resolveAutomatedReviewAction — document states", () => {
  const base: AutomatedReviewActionInput = {
    hasSpec: true, hasSubmission: true,
    isAnyDocumentProcessing: false,
    hasAnyFailedDocuments: false,
    canRunReview: true,
    latestReview: null
  };

  it("returns documents_missing when no spec doc", () => {
    const r = resolveAutomatedReviewAction({ ...base, hasSpec: false, canRunReview: false });
    expect(r.state).toBe("documents_missing");
    expect(r.action.type).toBe("upload_documents");
  });

  it("returns documents_missing when no submission doc", () => {
    const r = resolveAutomatedReviewAction({ ...base, hasSubmission: false, canRunReview: false });
    expect(r.state).toBe("documents_missing");
    expect(r.action.type).toBe("upload_documents");
  });

  it("returns documents_processing when a doc is actively processing", () => {
    const r = resolveAutomatedReviewAction({ ...base, isAnyDocumentProcessing: true });
    expect(r.state).toBe("documents_processing");
    expect(r.action.type).toBe("run_review");
  });

  it("returns documents_failed when there are failed docs and required docs not complete", () => {
    const r = resolveAutomatedReviewAction({
      ...base,
      hasAnyFailedDocuments: true,
      canRunReview: false
    });
    expect(r.state).toBe("documents_failed");
    expect(r.action.type).toBe("run_review");
  });

  it("returns ready_to_review when canRunReview is true and no review", () => {
    const r = resolveAutomatedReviewAction({ ...base });
    expect(r.state).toBe("ready_to_review");
    expect(r.action.type).toBe("run_review");
  });

  it("returns documents_ready_to_process when docs exist but not completed", () => {
    const r = resolveAutomatedReviewAction({ ...base, canRunReview: false });
    expect(r.state).toBe("documents_ready_to_process");
    expect(r.action.type).toBe("run_review");
  });
});

// ── 2. Orchestration endpoint ─────────────────────────────────────────────────

describe("Unit 17J: POST /api/projects/[projectId]/run-automated-review", () => {
  const src = readSrc("src/app/api/projects/[projectId]/run-automated-review/route.ts");

  it("route file exists", () => {
    expect(existsSync(resolve(ROOT, "src/app/api/projects/[projectId]/run-automated-review/route.ts"))).toBe(true);
  });

  it("has nodejs runtime export", () => {
    expect(src).toContain(`runtime = "nodejs"`);
  });

  it("has canRunReview permission check", () => {
    expect(src).toContain("canRunReview");
    expect(src).toContain("403");
  });

  it("has active-review guard to reuse existing review", () => {
    expect(src).toContain(`"draft", "running", "awaiting_human_review"`);
    expect(src).toContain("existingReview");
    expect(src).toContain("reused");
  });

  it("enqueues unprocessed documents", () => {
    expect(src).toContain("processing_jobs");
    expect(src).toContain(`"queued"`);
    expect(src).toContain("enqueuedDocIds");
  });

  it("creates draft review and returns redirectUrl to review-progress page", () => {
    expect(src).toContain(`status:          "draft"`);
    expect(src).toContain("review-progress");
    expect(src).toContain("redirectUrl");
  });
});

// ── 3. Processing-status endpoint ─────────────────────────────────────────────

describe("Unit 17J: GET /api/projects/[projectId]/processing-status", () => {
  const src = readSrc("src/app/api/projects/[projectId]/processing-status/route.ts");

  it("route file exists", () => {
    expect(existsSync(resolve(ROOT, "src/app/api/projects/[projectId]/processing-status/route.ts"))).toBe(true);
  });

  it("requires authentication", () => {
    expect(src).toContain("getCurrentProfile");
    expect(src).toContain("401");
  });

  it("returns allDocsReady field", () => {
    expect(src).toContain("allDocsReady");
    expect(src).toContain("processingCount");
    expect(src).toContain("completedCount");
  });
});

// ── 4. Project review-progress page ──────────────────────────────────────────

describe("Unit 17J: /projects/[projectId]/review-progress page", () => {
  const src = readSrc("src/app/(dashboard)/projects/[projectId]/review-progress/page.tsx");

  it("page file exists", () => {
    expect(existsSync(resolve(ROOT, "src/app/(dashboard)/projects/[projectId]/review-progress/page.tsx"))).toBe(true);
  });

  it("reads reviewId from searchParams", () => {
    expect(src).toContain("reviewId");
    expect(src).toContain("searchParams");
  });

  it("renders ProjectProgressClient component", () => {
    expect(src).toContain("ProjectProgressClient");
    expect(src).toContain("initialAllDocsReady");
  });
});

// ── 5. ProjectProgressClient component ───────────────────────────────────────

describe("Unit 17J: ProjectProgressClient component", () => {
  const src = readSrc("src/components/projects/project-progress-client.tsx");

  it("component file exists", () => {
    expect(existsSync(resolve(ROOT, "src/components/projects/project-progress-client.tsx"))).toBe(true);
  });

  it("polls document processing-status endpoint", () => {
    expect(src).toContain("processing-status");
    expect(src).toContain("allDocsReady");
  });

  it("calls review execute endpoint when docs are ready", () => {
    expect(src).toContain("/execute");
    expect(src).toContain("executeReview");
  });
});

// ── 6. RunReviewButton component ──────────────────────────────────────────────

describe("Unit 17J: RunReviewButton component", () => {
  const src = readSrc("src/components/projects/run-review-button.tsx");

  it("component file exists", () => {
    expect(existsSync(resolve(ROOT, "src/components/projects/run-review-button.tsx"))).toBe(true);
  });

  it("calls run-automated-review orchestration endpoint", () => {
    expect(src).toContain("run-automated-review");
    expect(src).toContain("POST");
  });

  it("navigates to redirectUrl from response", () => {
    expect(src).toContain("redirectUrl");
    expect(src).toContain("router.push");
  });
});

// ── 7. Project page integration ───────────────────────────────────────────────

describe("Unit 17J: Project page integration", () => {
  const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");

  it("imports resolveAutomatedReviewAction from automated-review-state", () => {
    expect(src).toContain("resolveAutomatedReviewAction");
    expect(src).toContain("automated-review-state");
  });

  it("imports RunReviewButton component", () => {
    expect(src).toContain("RunReviewButton");
    expect(src).toContain("run-review-button");
  });

  it("per-document process buttons are hidden in More disclosure", () => {
    expect(src).toContain("<details");
    expect(src).toContain("More");
    expect(src).not.toContain(`"Action"`);
  });

  it("deriveHeaderAction uses actionResult from resolver", () => {
    expect(src).toContain("actionResult");
    expect(src).toContain("deriveHeaderAction(actionResult");
  });
});
