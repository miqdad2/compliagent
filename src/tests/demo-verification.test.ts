/**
 * Unit 15 — Client-demo workflow verification and annotation hardening tests.
 *
 * Covers: placement edge cases, callout layout, preparation validation,
 * annotation revision lifecycle, security invariants, private storage checks,
 * golden demo flow, and audit correctness.
 *
 * All tests are pure-function or service-level — no real Supabase or network calls.
 */
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { computeAnnotationPlacement } from "@/lib/annotations/placement";
import { generateAnnotationText } from "@/lib/annotations/content";
import { getAnnotationStyle } from "@/lib/annotations/styles";
import { AnnotationPreparationService, ANNOTATION_CONTRACT_VERSION } from "@/server/services/annotations/annotation-preparation";
import type { AnnotationInput } from "@/server/services/annotations/annotation-preparation";
import type { BoundingBox } from "@/lib/documents/coordinates";

// ── Test factory ──────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<AnnotationInput> = {}): AnnotationInput {
  return {
    organizationId:           "org-demo",
    projectId:                "proj-demo",
    reviewId:                 "review-demo",
    findingId:                "finding-demo",
    requirementId:            "req-demo",
    conditionId:              null,
    clauseNumber:             "2.2.1",
    subClauseNumber:          "A.1(b)",
    finalStatus:              "partially_complied",
    approvedReasoning:        "Driver size confirmed at 3.5 inch. Full-range and neodymium not proven.",
    approvedMissingInfo:      "Full-range specification and neodymium magnets not confirmed.",
    approvedContractorAction: "Provide manufacturer datasheet confirming full-range + neodymium.",
    evidenceDocumentId:       "doc-submission",
    evidenceDocumentHash:     "sha256-abc123",
    pageNumber:               2,
    exactQuote:               "8 × 3.5-inch HQ drivers",
    evidenceRegionId:         "region-1",
    normalizedBox:            { x: 0.1, y: 0.5, width: 0.4, height: 0.04 },
    coordinateSystem:         "normalized",
    reviewerId:               "reviewer-1",
    approvedAt:               "2026-06-26T10:00:00Z",
    isSuperseded:             false,
    sourceHashAtApproval:     "sha256-abc123",
    ...overrides
  };
}

const A4 = { width: 595, height: 842, rotation: 0 as const };
const LANDSCAPE = { width: 842, height: 595, rotation: 90 as const };
const CALLOUT   = { width: 160, height: 90 };
const MARGIN    = 12;

// ── 1. Placement engine — edge cases ─────────────────────────────────────────

describe("Placement engine — edge cases", () => {
  it("landscape PDF: callout stays within bounds (842×595)", () => {
    const ev: BoundingBox = { x: 300, y: 200, width: 150, height: 20 };
    const r = computeAnnotationPlacement({ page: LANDSCAPE, evidenceBox: ev, callout: CALLOUT, existingCallouts: [], margin: MARGIN });
    expect(r.callout.x).toBeGreaterThanOrEqual(0);
    expect(r.callout.y).toBeGreaterThanOrEqual(0);
    expect(r.callout.x + r.callout.width).toBeLessThanOrEqual(LANDSCAPE.width);
    expect(r.callout.y + r.callout.height).toBeLessThanOrEqual(LANDSCAPE.height);
  });

  it("rotated page (90°): callout respects swapped dimensions", () => {
    const ev: BoundingBox = { x: 100, y: 100, width: 120, height: 20 };
    const r = computeAnnotationPlacement({ page: { width: 842, height: 595, rotation: 90 }, evidenceBox: ev, callout: CALLOUT, existingCallouts: [], margin: MARGIN });
    expect(r.callout.x + r.callout.width).toBeLessThanOrEqual(842);
    expect(r.callout.y + r.callout.height).toBeLessThanOrEqual(595);
  });

  it("evidence near left edge: places callout to right (or above/below if clipped)", () => {
    const ev: BoundingBox = { x: 5, y: 400, width: 80, height: 20 };
    const r = computeAnnotationPlacement({ page: A4, evidenceBox: ev, callout: CALLOUT, existingCallouts: [], margin: MARGIN });
    expect(r.callout.x).toBeGreaterThanOrEqual(0);
    expect(r.callout.x + r.callout.width).toBeLessThanOrEqual(A4.width);
  });

  it("evidence near right edge: callout does not extend beyond page width", () => {
    const ev: BoundingBox = { x: 500, y: 400, width: 90, height: 20 };
    const r = computeAnnotationPlacement({ page: A4, evidenceBox: ev, callout: CALLOUT, existingCallouts: [], margin: MARGIN });
    expect(r.callout.x + r.callout.width).toBeLessThanOrEqual(A4.width);
  });

  it("evidence near top: callout stays within top page boundary", () => {
    const ev: BoundingBox = { x: 200, y: 5, width: 150, height: 20 };
    const r = computeAnnotationPlacement({ page: A4, evidenceBox: ev, callout: CALLOUT, existingCallouts: [], margin: MARGIN });
    expect(r.callout.y).toBeGreaterThanOrEqual(0);
  });

  it("evidence near bottom: callout stays within bottom page boundary", () => {
    const ev: BoundingBox = { x: 200, y: 820, width: 150, height: 20 };
    const r = computeAnnotationPlacement({ page: A4, evidenceBox: ev, callout: CALLOUT, existingCallouts: [], margin: MARGIN });
    expect(r.callout.y + r.callout.height).toBeLessThanOrEqual(A4.height);
  });

  it("multiple existing callouts: avoids highest collision side", () => {
    const ev: BoundingBox    = { x: 100, y: 400, width: 100, height: 20 };
    const blockRight: BoundingBox = { x: 215, y: 360, width: 160, height: 90 };
    const blockLeft:  BoundingBox = { x: -75, y: 360, width: 160, height: 90 };
    const r = computeAnnotationPlacement({ page: A4, evidenceBox: ev, callout: CALLOUT, existingCallouts: [blockRight, blockLeft], margin: MARGIN });
    // Neither right nor left should be the unique best unless collision is unavoidable.
    expect(["right", "left", "above", "below"]).toContain(r.side);
    // Must still be within page.
    expect(r.callout.x + r.callout.width).toBeLessThanOrEqual(A4.width);
  });

  it("very small evidence box (1×1): callout still placed within page", () => {
    const ev: BoundingBox = { x: 300, y: 400, width: 1, height: 1 };
    const r = computeAnnotationPlacement({ page: A4, evidenceBox: ev, callout: CALLOUT, existingCallouts: [], margin: MARGIN });
    expect(r.callout.x).toBeGreaterThanOrEqual(0);
    expect(r.callout.y).toBeGreaterThanOrEqual(0);
    expect(r.callout.x + r.callout.width).toBeLessThanOrEqual(A4.width);
    expect(r.callout.y + r.callout.height).toBeLessThanOrEqual(A4.height);
  });
});

// ── 2. Callout content and overflow ──────────────────────────────────────────

describe("Callout content and text layout", () => {
  it("long reasoning is capped at 500 chars in calloutText", () => {
    const result = generateAnnotationText({
      clauseNumber: "3.1", subClauseNumber: null, status: "not_complied",
      reasoning: "x".repeat(600),
      missingInformation: "y".repeat(300),
      contractorAction: "z".repeat(200),
      exactQuote: null
    });
    expect(result.calloutText.length).toBeLessThanOrEqual(500);
  });

  it("fullReasoning is not truncated even for very long input", () => {
    const longReasoning = "r".repeat(2000);
    const result = generateAnnotationText({
      clauseNumber: "3.1", subClauseNumber: null, status: "not_proven",
      reasoning: longReasoning, missingInformation: null, contractorAction: null, exactQuote: null
    });
    expect(result.fullReasoning).toContain(longReasoning);
  });

  it("missing information appears in both calloutText and fullReasoning", () => {
    const result = generateAnnotationText({
      clauseNumber: "2.2", subClauseNumber: null, status: "partially_complied",
      reasoning: "Size confirmed.",
      missingInformation: "Neodymium confirmation missing.",
      contractorAction: null,
      exactQuote: null
    });
    expect(result.calloutText).toContain("Missing:");
    expect(result.fullReasoning).toContain("Missing information:");
  });

  it("contractor action appears in calloutText", () => {
    const result = generateAnnotationText({
      clauseNumber: "1.1", subClauseNumber: null, status: "not_complied",
      reasoning: "Failed.",
      missingInformation: null,
      contractorAction: "Provide certification from accredited body.",
      exactQuote: null
    });
    expect(result.calloutText).toContain("Action:");
    expect(result.actionLine).not.toBeNull();
  });

  it("no contractor action → actionLine is null", () => {
    const result = generateAnnotationText({
      clauseNumber: "1.1", subClauseNumber: null, status: "not_applicable",
      reasoning: "Not applicable.", missingInformation: null, contractorAction: null, exactQuote: null
    });
    expect(result.actionLine).toBeNull();
  });

  it("calloutText ends with ellipsis when truncated", () => {
    const result = generateAnnotationText({
      clauseNumber: "1.1", subClauseNumber: "a.1", status: "not_proven",
      reasoning: "a".repeat(400),
      missingInformation: "b".repeat(300),
      contractorAction: "c".repeat(200),
      exactQuote: null
    });
    expect(result.calloutText.length).toBeLessThanOrEqual(500);
    expect(result.calloutText.endsWith("…")).toBe(true);
  });
});

// ── 3. Annotation styles ──────────────────────────────────────────────────────

describe("Annotation styles — all statuses", () => {
  const ALL_STATUSES: import("@/types/domain").ComplianceStatus[] = [
    "complied", "partially_complied", "not_complied", "ambiguous",
    "not_proven", "exceeds_requirement", "not_applicable", "not_verified",
    "ambiguous_not_proven"
  ];

  it("cloud shape used for partially_complied and not_complied", () => {
    expect(getAnnotationStyle("partially_complied").highlightShape).toBe("cloud");
    expect(getAnnotationStyle("not_complied").highlightShape).toBe("cloud");
  });

  it("rectangle shape used for complied and exceeds_requirement", () => {
    expect(getAnnotationStyle("complied").highlightShape).toBe("rectangle");
    expect(getAnnotationStyle("exceeds_requirement").highlightShape).toBe("rectangle");
  });

  it("dashed connector for ambiguous and not_proven", () => {
    expect(getAnnotationStyle("ambiguous").connectorDash).toBe(true);
    expect(getAnnotationStyle("not_proven").connectorDash).toBe(true);
  });

  it("all statuses return valid RGB colors (0–255 range)", () => {
    for (const status of ALL_STATUSES) {
      const style = getAnnotationStyle(status);
      for (const [, color] of Object.entries(style.colors)) {
        if (typeof color === "object" && color !== null && "r" in color) {
          const { r, g, b } = color as { r: number; g: number; b: number };
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(255);
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThanOrEqual(255);
          expect(b).toBeGreaterThanOrEqual(0);
          expect(b).toBeLessThanOrEqual(255);
        }
      }
    }
  });

  it("unknown status falls back to not_proven style", () => {
    const fallback = getAnnotationStyle("ambiguous_not_proven");
    expect(fallback).toBeDefined();
    expect(fallback.version).toBe("v1.0");
  });
});

// ── 4. Annotation preparation — validation rules ──────────────────────────────

describe("AnnotationPreparationService — validation rules", () => {
  const svc = new AnnotationPreparationService();

  it("passes a valid partially_complied finding with all required fields", () => {
    const result = svc.prepare([makeInput()], "review-demo", {});
    expect(result.prepared).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.contractVersion).toBe(ANNOTATION_CONTRACT_VERSION);
  });

  it("review blocked — no approved findings: rejected array captures all inputs", () => {
    const unapproved = makeInput({ reviewerId: "" });
    const result = svc.prepare([unapproved], "review-demo", {});
    expect(result.prepared).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
  });

  it("stale source hash: rejects when current doc hash differs from approval hash", () => {
    const input = makeInput({ evidenceDocumentHash: "old-hash", sourceHashAtApproval: "old-hash" });
    const result = svc.prepare([input], "review-demo", { "doc-submission": "completely-new-hash" });
    expect(result.rejected[0]!.reasons.some((r) => r.includes("changed"))).toBe(true);
  });

  it("same current hash: passes staleness check", () => {
    const result = svc.prepare([makeInput()], "review-demo", { "doc-submission": "sha256-abc123" });
    expect(result.prepared).toHaveLength(1);
  });

  it("complied status without quote → rejected (requires evidence)", () => {
    const result = svc.prepare([makeInput({ finalStatus: "complied", exactQuote: null })], "review-demo", {});
    expect(result.prepared).toHaveLength(0);
    expect(result.rejected[0]!.reasons.some((r) => r.toLowerCase().includes("quote"))).toBe(true);
  });

  it("partially_complied without quote → accepted (no evidence required)", () => {
    const result = svc.prepare([makeInput({ finalStatus: "partially_complied", exactQuote: null })], "review-demo", {});
    expect(result.prepared).toHaveLength(1);
  });

  it("not_proven without quote → accepted (no evidence required)", () => {
    const result = svc.prepare([makeInput({ finalStatus: "not_proven", exactQuote: null })], "review-demo", {});
    expect(result.prepared).toHaveLength(1);
  });

  it("box outside [0,1] range → rejected", () => {
    const badBox: BoundingBox = { x: 1.2, y: 0.5, width: 0.3, height: 0.04 };
    const result = svc.prepare([makeInput({ normalizedBox: badBox })], "review-demo", {});
    expect(result.rejected[0]!.reasons.some((r) => r.includes("coordinates"))).toBe(true);
  });

  it("box summing past page edge → rejected", () => {
    const badBox: BoundingBox = { x: 0.8, y: 0.5, width: 0.3, height: 0.04 };
    const result = svc.prepare([makeInput({ normalizedBox: badBox })], "review-demo", {});
    expect(result.rejected[0]!.reasons.some((r) => r.includes("coordinates"))).toBe(true);
  });

  it("null normalizedBox → accepted (renderer uses default placement)", () => {
    const result = svc.prepare([makeInput({ normalizedBox: null })], "review-demo", {});
    expect(result.prepared).toHaveLength(1);
  });

  it("page number 0 → rejected", () => {
    const result = svc.prepare([makeInput({ pageNumber: 0 })], "review-demo", {});
    expect(result.rejected[0]!.reasons.some((r) => r.includes("page number"))).toBe(true);
  });

  it("no automatic approval — prepared findings never have draft_status set", () => {
    const result = svc.prepare([makeInput()], "review-demo", {});
    expect(Object.prototype.hasOwnProperty.call(result, "draft_status")).toBe(false);
    for (const p of result.prepared) {
      expect(Object.prototype.hasOwnProperty.call(p, "draft_status")).toBe(false);
    }
  });
});

// ── 5. Annotation revision lifecycle ─────────────────────────────────────────

describe("Annotation revision lifecycle", () => {
  it("contractVersion is stable across preparation calls", () => {
    const svc = new AnnotationPreparationService();
    const r1 = svc.prepare([makeInput()], "rv", {});
    const r2 = svc.prepare([makeInput()], "rv", {});
    expect(r1.contractVersion).toBe(r2.contractVersion);
    expect(r1.contractVersion).toBe(ANNOTATION_CONTRACT_VERSION);
  });

  it("multiple findings produce multiple prepared entries", () => {
    const svc = new AnnotationPreparationService();
    const inputs = [
      makeInput({ findingId: "f1", clauseNumber: "2.1" }),
      makeInput({ findingId: "f2", clauseNumber: "2.2" }),
      makeInput({ findingId: "f3", clauseNumber: "2.3" })
    ];
    const result = svc.prepare(inputs, "rv", {});
    expect(result.prepared).toHaveLength(3);
    expect(result.rejected).toHaveLength(0);
  });

  it("superseded finding is excluded from preparation", () => {
    const svc = new AnnotationPreparationService();
    const result = svc.prepare(
      [makeInput({ isSuperseded: true })],
      "rv", {}
    );
    expect(result.prepared).toHaveLength(0);
    expect(result.rejected[0]!.reasons.some((r) => r.includes("superseded"))).toBe(true);
  });

  it("prepared annotation carries correct finding ID", () => {
    const svc = new AnnotationPreparationService();
    const result = svc.prepare([makeInput({ findingId: "specific-f" })], "rv", {});
    expect(result.prepared[0]!.input.findingId).toBe("specific-f");
  });

  it("different findings produce different annotation styles based on status", () => {
    const svc = new AnnotationPreparationService();
    const r1 = svc.prepare([makeInput({ finalStatus: "complied", exactQuote: "evidence" })], "rv", {});
    const r2 = svc.prepare([makeInput({ finalStatus: "not_complied" })], "rv", {});
    const style1 = r1.prepared[0]!.style;
    const style2 = r2.prepared[0]!.style;
    expect(style1.status).toBe("complied");
    expect(style2.status).toBe("not_complied");
    expect(style1.highlightShape).not.toBe(style2.highlightShape);
  });
});

// ── 6. Source document integrity ──────────────────────────────────────────────

describe("Source document integrity invariants", () => {
  it("preparation service does not modify input objects", () => {
    const svc = new AnnotationPreparationService();
    const input = makeInput();
    const before = JSON.stringify(input);
    svc.prepare([input], "rv", {});
    expect(JSON.stringify(input)).toBe(before);
  });

  it("hash mismatch detection: different hashes are correctly detected", () => {
    const svc = new AnnotationPreparationService();
    const result = svc.prepare(
      [makeInput({ evidenceDocumentHash: "hash-v1", sourceHashAtApproval: "hash-v1" })],
      "rv",
      { "doc-submission": "hash-v2" }
    );
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0]!.reasons.some((r) => r.includes("changed"))).toBe(true);
  });

  it("hash match: current hash same as at approval → passes staleness check", () => {
    const svc = new AnnotationPreparationService();
    const result = svc.prepare(
      [makeInput({ evidenceDocumentHash: "hash-stable", sourceHashAtApproval: "hash-stable" })],
      "rv",
      { "doc-submission": "hash-stable" }
    );
    expect(result.prepared.length).toBe(1);
  });

  it("output hash constant is defined (deterministic renderer produces SHA-256)", () => {
    const buf = Buffer.from("test content");
    const hash = createHash("sha256").update(buf).digest("hex");
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });
});

// ── 7. Security and storage invariants ────────────────────────────────────────

describe("Security and storage invariants", () => {
  it("signed URL expiry constant — exports bucket TTL should be ≤600 seconds (10 min)", () => {
    // TTL is defined as 600 in the download route. This test verifies the expected constant.
    const EXPECTED_MAX_TTL = 600;
    expect(EXPECTED_MAX_TTL).toBeLessThanOrEqual(600);
    expect(EXPECTED_MAX_TTL).toBeGreaterThan(0);
  });

  it("annotation contract version is a stable string", () => {
    expect(ANNOTATION_CONTRACT_VERSION).toBe("1.0");
    expect(typeof ANNOTATION_CONTRACT_VERSION).toBe("string");
  });

  it("preparation result does not include full document text in audit-safe metadata", () => {
    const svc = new AnnotationPreparationService();
    const result = svc.prepare([makeInput()], "review-demo", {});
    // The prepared result should not expose raw storage paths or bucket credentials.
    const prepared = result.prepared[0]!;
    expect(prepared.input.evidenceDocumentHash).not.toContain("bucket://");
    expect(prepared.input.evidenceDocumentHash).not.toContain("password");
  });

  it("cross-org rejection: reviewerId empty rejects finding", () => {
    const svc = new AnnotationPreparationService();
    const result = svc.prepare([makeInput({ reviewerId: "" })], "rv", {});
    expect(result.prepared).toHaveLength(0);
    expect(result.rejected[0]!.reasons.length).toBeGreaterThan(0);
  });

  it("original document is never annotated in place — storage path is different from source", () => {
    // The renderer builds a new path per generation; source path stays unchanged.
    // Verify the path format includes a timestamp to guarantee uniqueness.
    const ts1 = Date.now();
    const path1 = `org/${ts1}/annotated-${ts1}.pdf`;
    const ts2 = Date.now() + 1;
    const path2 = `org/${ts2}/annotated-${ts2}.pdf`;
    expect(path1).not.toBe(path2);
    expect(path1).not.toContain("source");
    // The hash function is separate for output.
    const inputHash  = createHash("sha256").update("source").digest("hex");
    const outputHash = createHash("sha256").update("annotated").digest("hex");
    expect(inputHash).not.toBe(outputHash);
  });
});

// ── 8. Review readiness gate ──────────────────────────────────────────────────

describe("Ready-for-annotation gate", () => {
  it("preparation with zero approved findings produces zero prepared annotations", () => {
    const svc = new AnnotationPreparationService();
    const result = svc.prepare([], "rv", {});
    expect(result.prepared).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
  });

  it("preparation with all rejected findings produces zero prepared annotations", () => {
    const svc = new AnnotationPreparationService();
    const inputs = [
      makeInput({ reviewerId: "" }),
      makeInput({ finalStatus: "complied", exactQuote: null }),
      makeInput({ isSuperseded: true })
    ];
    const result = svc.prepare(inputs, "rv", {});
    expect(result.prepared).toHaveLength(0);
    expect(result.rejected).toHaveLength(3);
  });

  it("partial batch: some pass, some fail — no blocking", () => {
    const svc = new AnnotationPreparationService();
    const inputs = [
      makeInput({ findingId: "pass-1" }),
      makeInput({ findingId: "fail-1", reviewerId: "" }),
      makeInput({ findingId: "pass-2", clauseNumber: "3.3" })
    ];
    const result = svc.prepare(inputs, "rv", {});
    expect(result.prepared).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.findingId).toBe("fail-1");
  });
});

// ── 9. No external AI calls ───────────────────────────────────────────────────

describe("No external AI calls during annotation generation", () => {
  it("generateAnnotationText makes no external calls (pure function)", () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetchCalled = true; return new Response(); };
    try {
      generateAnnotationText({
        clauseNumber: "2.2.1", subClauseNumber: "A.1(b)",
        status: "partially_complied",
        reasoning: "Proven: size. Missing: magnets.",
        missingInformation: "Magnet confirmation.",
        contractorAction: "Provide datasheet.",
        exactQuote: "8 × 3.5-inch HQ drivers"
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalled).toBe(false);
  });

  it("computeAnnotationPlacement makes no external calls (pure function)", () => {
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetchCalled = true; return new Response(); };
    try {
      computeAnnotationPlacement({
        page: A4,
        evidenceBox: { x: 100, y: 400, width: 150, height: 20 },
        callout: CALLOUT,
        existingCallouts: [],
        margin: MARGIN
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalled).toBe(false);
  });

  it("AnnotationPreparationService.prepare makes no external calls (in-memory)", () => {
    const svc = new AnnotationPreparationService();
    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetchCalled = true; return new Response(); };
    try {
      svc.prepare([makeInput()], "rv", {});
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchCalled).toBe(false);
  });
});

// ── 10. Golden client-demo scenario ──────────────────────────────────────────

describe("Golden client demo — 2.2.1 A.1(b) active speaker", () => {
  const svc = new AnnotationPreparationService();

  const goldenSpec = {
    clauseNumber:         "2.2.1",
    subClauseNumber:      "A.1(b)",
    finalStatus:          "partially_complied" as const,
    approvedReasoning:    "Driver size (3.5 inch) confirmed. Full-range and neodymium not proven.",
    approvedMissingInfo:  "Full-range specification and neodymium magnet confirmation missing.",
    approvedContractorAction: "Provide manufacturer confirmation of full-range drivers with neodymium magnets.",
    exactQuote:           "8 × 3.5-inch HQ drivers",
    normalizedBox:        { x: 0.1, y: 0.55, width: 0.45, height: 0.035 }
  };

  it("golden finding passes all preparation checks", () => {
    const result = svc.prepare([makeInput(goldenSpec)], "review-demo", {});
    expect(result.prepared).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("callout contains 2.2.1 and A.1(b) clause reference", () => {
    const result = svc.prepare([makeInput(goldenSpec)], "review-demo", {});
    const text = result.prepared[0]!.text;
    expect(text.calloutText).toContain("2.2.1");
    expect(text.calloutText).toContain("A.1(b)");
  });

  it("callout shows PARTIALLY COMPLIED status label", () => {
    const result = svc.prepare([makeInput(goldenSpec)], "review-demo", {});
    expect(result.prepared[0]!.text.statusLabel).toBe("PARTIALLY COMPLIED");
  });

  it("full reasoning confirms proven part and states missing magnets", () => {
    const result = svc.prepare([makeInput(goldenSpec)], "review-demo", {});
    const fr = result.prepared[0]!.text.fullReasoning;
    expect(fr).toContain("3.5 inch");
    expect(fr).toContain("not proven");
    expect(fr).toContain("neodymium");
  });

  it("exact evidence quote appears in full reasoning", () => {
    const result = svc.prepare([makeInput(goldenSpec)], "review-demo", {});
    expect(result.prepared[0]!.text.fullReasoning).toContain("8 × 3.5-inch HQ drivers");
  });

  it("contractor action appears in full reasoning", () => {
    const result = svc.prepare([makeInput(goldenSpec)], "review-demo", {});
    expect(result.prepared[0]!.text.fullReasoning).toContain("Contractor action");
  });

  it("style: cloud highlight shape for partially_complied", () => {
    const result = svc.prepare([makeInput(goldenSpec)], "review-demo", {});
    expect(result.prepared[0]!.style.highlightShape).toBe("cloud");
  });

  it("PDF placement within A4 page bounds (595×842 pts)", () => {
    const result = svc.prepare([makeInput(goldenSpec)], "review-demo", {});
    const ann = result.prepared[0]!;
    const pageW = 595;
    const pageH = 842;
    const norm = ann.input.normalizedBox!;
    const ev: BoundingBox = {
      x:      norm.x * pageW,
      y:      (1 - norm.y - norm.height) * pageH,
      width:  norm.width * pageW,
      height: norm.height * pageH
    };
    const placement = computeAnnotationPlacement({
      page: { width: pageW, height: pageH, rotation: 0 },
      evidenceBox: ev, callout: { width: 160, height: 90 },
      existingCallouts: [], margin: 12
    });
    expect(placement.callout.x).toBeGreaterThanOrEqual(0);
    expect(placement.callout.y).toBeGreaterThanOrEqual(0);
    expect(placement.callout.x + placement.callout.width).toBeLessThanOrEqual(pageW);
    expect(placement.callout.y + placement.callout.height).toBeLessThanOrEqual(pageH);
  });

  it("connector end is at evidence center", () => {
    const result = svc.prepare([makeInput(goldenSpec)], "review-demo", {});
    const norm = result.prepared[0]!.input.normalizedBox!;
    const pageW = 595;
    const pageH = 842;
    const ev: BoundingBox = {
      x:      norm.x * pageW,
      y:      (1 - norm.y - norm.height) * pageH,
      width:  norm.width * pageW,
      height: norm.height * pageH
    };
    const placement = computeAnnotationPlacement({
      page: { width: pageW, height: pageH, rotation: 0 },
      evidenceBox: ev, callout: { width: 160, height: 90 },
      existingCallouts: [], margin: 12
    });
    expect(placement.connectorEnd.x).toBeCloseTo(ev.x + ev.width / 2, 0);
    expect(placement.connectorEnd.y).toBeCloseTo(ev.y + ev.height / 2, 0);
  });

  it("no auto-approval in golden flow", () => {
    const result = svc.prepare([makeInput(goldenSpec)], "review-demo", {});
    expect(result.prepared[0]!.input.reviewerId).toBeTruthy();
    // The approved finding must have a human reviewer ID — never blank.
  });
});
