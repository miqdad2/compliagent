/**
 * review-workflow-17i.test.ts
 *
 * Regression tests for Unit 17I:
 * - Fix automated review navigation, state synchronization, and client workflow.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

function readSrc(rel: string): string {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

// ── 1. Two-phase review creation ────────────────────────────────────────────

describe("Unit 17I: Two-phase review creation (POST /api/reviews/controlled)", () => {
  it("controlled route creates draft and does NOT call orchestrator directly", () => {
    const src = readSrc("src/app/api/reviews/controlled/route.ts");
    expect(src).toContain(`status:          "draft"`);
    expect(src).not.toContain("orchestrator.runControlledReview");
    expect(src).not.toContain("runControlledReview(");
  });

  it("controlled route returns redirectUrl pointing to workspace", () => {
    const src = readSrc("src/app/api/reviews/controlled/route.ts");
    expect(src).toContain("redirectUrl");
    expect(src).toContain(`/projects/\${projectId}/reviews/\${reviewRow.id}`);
  });

  it("controlled route stores execution_mode on insert", () => {
    const src = readSrc("src/app/api/reviews/controlled/route.ts");
    expect(src).toContain("execution_mode:  executionMode");
  });

  it("controlled route has active-review guard (prevents duplicate creation)", () => {
    const src = readSrc("src/app/api/reviews/controlled/route.ts");
    expect(src).toContain(`"draft", "running", "awaiting_human_review"`);
    expect(src).toContain("existingReview");
  });
});

// ── 2. Execute route ─────────────────────────────────────────────────────────

describe("Unit 17I: Execute route (POST /api/reviews/[reviewId]/execute)", () => {
  it("execute route file exists", () => {
    expect(existsSync(resolve(ROOT, "src/app/api/reviews/[reviewId]/execute/route.ts"))).toBe(true);
  });

  it("execute route runs orchestrator", () => {
    const src = readSrc("src/app/api/reviews/[reviewId]/execute/route.ts");
    expect(src).toMatch(/runControlledReview|ReviewOrchestrator/);
  });

  it("execute route guards against re-running a completed review", () => {
    const src = readSrc("src/app/api/reviews/[reviewId]/execute/route.ts");
    expect(src).toMatch(/awaiting_human_review|approved|complete/);
  });

  it("execute route has nodejs runtime export", () => {
    const src = readSrc("src/app/api/reviews/[reviewId]/execute/route.ts");
    expect(src).toContain(`runtime = "nodejs"`);
  });
});

// ── 3. execution_mode migration ──────────────────────────────────────────────

describe("Unit 17I: execution_mode DB migration", () => {
  it("migration file exists", () => {
    expect(
      existsSync(resolve(ROOT, "supabase/migrations/20260702000000_review_execution_mode.sql"))
    ).toBe(true);
  });

  it("migration adds execution_mode column with valid values", () => {
    const src = readSrc("supabase/migrations/20260702000000_review_execution_mode.sql");
    expect(src).toContain("execution_mode");
    expect(src).toContain("deterministic");
    expect(src).toContain("mock");
    expect(src).toContain("controlled_live");
  });

  it("workspace page reads execution_mode from DB (not prompt_version)", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/reviews/[reviewId]/page.tsx");
    expect(src).toContain("execution_mode");
    expect(src).not.toContain(`prompt_version" ? "controlled_live" : "deterministic"`);
  });
});

// ── 4. Progress page ─────────────────────────────────────────────────────────

describe("Unit 17I: Review progress page", () => {
  it("ReviewProgressPage component exists", () => {
    expect(
      existsSync(resolve(ROOT, "src/components/reviews/review-progress-page.tsx"))
    ).toBe(true);
  });

  it("ReviewProgressPage auto-triggers execute route on mount", () => {
    const src = readSrc("src/components/reviews/review-progress-page.tsx");
    expect(src).toContain("/api/reviews/");
    expect(src).toContain("/execute");
  });

  it("ReviewProgressPage shows progress stages", () => {
    const src = readSrc("src/components/reviews/review-progress-page.tsx");
    expect(src).toContain("Discovering requirements");
    expect(src).toContain("Checking evidence");
    expect(src).toContain("Evaluating compliance");
  });

  it("workspace page renders progress page for draft/running reviews", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/reviews/[reviewId]/page.tsx");
    expect(src).toContain("ReviewProgressPage");
    expect(src).toContain(`review.status === "draft"`);
    expect(src).toContain(`review.status === "running"`);
  });

  it("ReviewProgressPage navigates to workspace on completion", () => {
    const src = readSrc("src/components/reviews/review-progress-page.tsx");
    expect(src).toContain("router.replace");
    expect(src).toContain("router.refresh");
  });

  it("ReviewProgressPage shows retry button on failure", () => {
    const src = readSrc("src/components/reviews/review-progress-page.tsx");
    expect(src).toContain("Retry");
    expect(src).toContain("retryable");
  });
});

// ── 5. Workspace header fixes ────────────────────────────────────────────────

describe("Unit 17I: Workspace header fixes", () => {
  it("mode label map has correct display names", () => {
    const src = readSrc("src/components/reviews/review-workspace.tsx");
    expect(src).toContain('"Deterministic review"');
    expect(src).toContain('"Test review"');
    expect(src).toContain('"AI-assisted review"');
  });

  it("status label map has human-readable names", () => {
    const src = readSrc("src/components/reviews/review-workspace.tsx");
    expect(src).toContain('"Needs your review"');
  });

  it("Annotations link is removed from workspace header", () => {
    const src = readSrc("src/components/reviews/review-workspace.tsx");
    expect(src).not.toContain("Annotations &amp; readiness");
    expect(src).not.toContain("Annotations & readiness");
    expect(src).not.toContain("/annotations");
  });

  it("filter default is requires_attention, not all", () => {
    const src = readSrc("src/components/reviews/review-workspace.tsx");
    expect(src).toContain(`("requires_attention")`);
    expect(src).not.toContain(`useState<StatusFilterValue>("all")`);
  });

  it("filter dropdown shows Requires attention as first option", () => {
    const src = readSrc("src/components/reviews/review-workspace.tsx");
    expect(src).toContain(`value="requires_attention"`);
  });
});

// ── 6. Project page action consolidation ────────────────────────────────────

describe("Unit 17I: Project page action consolidation", () => {
  it("deriveHeaderAction uses resolver-based actionResult (17J refactor)", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    // Unit 17J replaced latestReviewId param with actionResult from resolver.
    expect(src).toContain("actionResult");
    expect(src).toContain("resolveAutomatedReviewAction");
  });

  it("deriveHeaderAction links to actual workspace URL via action.reviewId", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    // Unit 17J uses action.reviewId instead of latestReviewId directly.
    expect(src).toContain(`/projects/\${projectId}/reviews/\${action.reviewId}`);
    expect(src).not.toContain(`/projects/\${projectId}/reviews\``);
  });

  it("ReviewTab does not show Run Review button when latestReview exists", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).toContain("!latestReview");
  });

  it("Legacy assessment run section is removed from ReviewTab", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).not.toContain("Legacy assessment run");
    expect(src).not.toContain("ReviewRunButton");
  });

  it("CompactProjectPanel shows run button only via resolver action type (17J refactor)", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    // Unit 17J: run button gated by resolver action type, not latestReview directly.
    expect(src).toContain(`actionResult.action.type === "run_review"`);
    expect(src).toContain("RunReviewButton");
  });
});

// ── 7. Auto-confirm provisional requirements ─────────────────────────────────

describe("Unit 17I: Provisional requirement auto-confirmation", () => {
  it("orchestrator has canAutoConfirm helper", () => {
    const src = readSrc("src/server/services/reviews/review-orchestrator.ts");
    expect(src).toContain("canAutoConfirm");
  });

  it("canAutoConfirm checks clause number", () => {
    const src = readSrc("src/server/services/reviews/review-orchestrator.ts");
    expect(src).toContain("clauseNumber");
    expect(src).toContain("hasMandatoryLanguage");
  });

  it("orchestrator uses autoConfirm to set requirementState conditionally", () => {
    const src = readSrc("src/server/services/reviews/review-orchestrator.ts");
    expect(src).toContain(`autoConfirm ? "confirmed" : "provisional"`);
  });

  it("orchestrator sets humanReviewRequired false for auto-confirmed requirements", () => {
    const src = readSrc("src/server/services/reviews/review-orchestrator.ts");
    expect(src).toContain("!autoConfirm");
  });
});

// ── 8. Evidence quality threshold ────────────────────────────────────────────

describe("Unit 17I: Evidence quality threshold", () => {
  it("evidence retrieval uses minimum threshold of 0.15", () => {
    const src = readSrc("src/server/services/reviews/evidence-retrieval.ts");
    expect(src).toContain(">= 0.15");
    expect(src).not.toContain("> 0).slice");
  });
});

// ── 9. Text display normalization ────────────────────────────────────────────

describe("Unit 17I: Text display normalization", () => {
  it("text-display.ts module exists", () => {
    expect(existsSync(resolve(ROOT, "src/lib/documents/text-display.ts"))).toBe(true);
  });

  it("normalizeDisplayText is exported", () => {
    const src = readSrc("src/lib/documents/text-display.ts");
    expect(src).toContain("export function normalizeDisplayText");
  });

  it("normalization handles u-bullet artifact", () => {
    const src = readSrc("src/lib/documents/text-display.ts");
    expect(src).toContain("• ");
    expect(src).toMatch(/\^u\\s\+/);
  });

  it("workspace uses normalizeDisplayText for evidence text", () => {
    const src = readSrc("src/components/reviews/review-workspace.tsx");
    expect(src).toContain("normalizeDisplayText");
    expect(src).toContain("text-display");
  });
});

// ── 10. Start page title ──────────────────────────────────────────────────────

describe("Unit 17I: Start page title", () => {
  it("start page title says 'Run automated technical review'", () => {
    const src = readSrc(
      "src/app/(dashboard)/projects/[projectId]/reviews/start/page.tsx"
    );
    expect(src).toContain("Run automated technical review");
    expect(src).not.toContain("Start controlled review");
  });
});
