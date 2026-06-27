/**
 * Unit 14 — Annotation foundation tests.
 *
 * Covers: annotation preparation validation, content templates, styles,
 * placement engine, and the golden speaker annotation scenario.
 * Does NOT test the PDF renderer directly (requires storage + file IO).
 */
import { describe, it, expect } from "vitest";
import { AnnotationPreparationService, ANNOTATION_CONTRACT_VERSION } from "@/server/services/annotations/annotation-preparation";
import { generateAnnotationText } from "@/lib/annotations/content";
import { getAnnotationStyle } from "@/lib/annotations/styles";
import { computeAnnotationPlacement } from "@/lib/annotations/placement";
import type { AnnotationInput } from "@/server/services/annotations/annotation-preparation";
import type { BoundingBox } from "@/lib/documents/coordinates";

// ── Test factories ─────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<AnnotationInput> = {}): AnnotationInput {
  return {
    organizationId:           "org-1",
    projectId:                "proj-1",
    reviewId:                 "review-1",
    findingId:                "finding-1",
    requirementId:            "req-1",
    conditionId:              null,
    clauseNumber:             "2.2.1",
    subClauseNumber:          "A.1(b)",
    finalStatus:              "partially_complied",
    approvedReasoning:        "Driver size confirmed. Full-range and neodymium not proven.",
    approvedMissingInfo:      "Full-range specification and neodymium magnet confirmation required.",
    approvedContractorAction: "Provide manufacturer datasheet confirming full-range construction and neodymium magnets.",
    evidenceDocumentId:       "doc-sub-1",
    evidenceDocumentHash:     "abc123def456",
    pageNumber:               3,
    exactQuote:               "8 × 3.5-inch HQ drivers",
    evidenceRegionId:         "region-1",
    normalizedBox:            { x: 0.1, y: 0.5, width: 0.4, height: 0.04 },
    coordinateSystem:         "normalized",
    reviewerId:               "reviewer-1",
    approvedAt:               "2026-06-28T10:00:00Z",
    isSuperseded:             false,
    sourceHashAtApproval:     "abc123def456",
    ...overrides
  };
}

// ── AnnotationPreparationService tests ───────────────────────────────────────

describe("AnnotationPreparationService", () => {
  const svc = new AnnotationPreparationService();

  it("accepts a valid approved finding", () => {
    const result = svc.prepare([makeInput()], "review-1", {});
    expect(result.prepared).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.contractVersion).toBe(ANNOTATION_CONTRACT_VERSION);
  });

  it("rejects finding without reviewer approval", () => {
    const result = svc.prepare([makeInput({ reviewerId: "" })], "review-1", {});
    expect(result.prepared).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.reasons.some((r) => r.includes("reviewer-approved"))).toBe(true);
  });

  it("rejects superseded finding", () => {
    const result = svc.prepare([makeInput({ isSuperseded: true })], "review-1", {});
    expect(result.rejected[0]!.reasons.some((r) => r.includes("superseded"))).toBe(true);
  });

  it("rejects stale source document hash", () => {
    const result = svc.prepare(
      [makeInput({ sourceHashAtApproval: "old-hash", evidenceDocumentHash: "old-hash" })],
      "review-1",
      { "doc-sub-1": "new-different-hash" }
    );
    expect(result.rejected[0]!.reasons.some((r) => r.includes("changed"))).toBe(true);
  });

  it("rejects complied status without exact quote", () => {
    const result = svc.prepare(
      [makeInput({ finalStatus: "complied", exactQuote: null })],
      "review-1",
      {}
    );
    expect(result.rejected[0]!.reasons.some((r) => r.includes("exact evidence quote"))).toBe(true);
  });

  it("rejects exceeds_requirement without exact quote", () => {
    const result = svc.prepare(
      [makeInput({ finalStatus: "exceeds_requirement", exactQuote: null })],
      "review-1",
      {}
    );
    expect(result.rejected[0]!.reasons.some((r) => r.includes("quote"))).toBe(true);
  });

  it("rejects invalid normalized bounding box (outside [0,1])", () => {
    const badBox: BoundingBox = { x: 1.5, y: 0.1, width: 0.3, height: 0.03 };
    const result = svc.prepare([makeInput({ normalizedBox: badBox })], "review-1", {});
    expect(result.rejected[0]!.reasons.some((r) => r.includes("coordinates"))).toBe(true);
  });

  it("accepts null normalizedBox (fallback placement)", () => {
    const result = svc.prepare([makeInput({ normalizedBox: null })], "review-1", {});
    expect(result.prepared).toHaveLength(1);
  });

  it("rejects page number less than 1", () => {
    const result = svc.prepare([makeInput({ pageNumber: 0 })], "review-1", {});
    expect(result.rejected[0]!.reasons.some((r) => r.includes("page number"))).toBe(true);
  });

  it("processes multiple findings: some pass, some fail", () => {
    const inputs = [
      makeInput({ findingId: "f1" }),
      makeInput({ findingId: "f2", reviewerId: "" }),
      makeInput({ findingId: "f3" })
    ];
    const result = svc.prepare(inputs, "review-1", {});
    expect(result.prepared).toHaveLength(2);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.findingId).toBe("f2");
  });

  it("generates correct annotation text for prepared findings", () => {
    const result = svc.prepare([makeInput()], "review-1", {});
    const text = result.prepared[0]!.text;
    expect(text.clauseLabel).toContain("2.2.1");
    expect(text.statusLabel).toContain("PARTIALLY COMPLIED");
    expect(text.calloutText.length).toBeLessThanOrEqual(500);
  });

  it("applies correct style for partially_complied", () => {
    const result = svc.prepare([makeInput()], "review-1", {});
    const style  = result.prepared[0]!.style;
    expect(style.status).toBe("partially_complied");
    expect(style.highlightShape).toBe("cloud");
  });

  it("never auto-approves — draft_status is not set by preparation", () => {
    const result = svc.prepare([makeInput()], "review-1", {});
    // The preparation service does not set draft_status — that's the renderer's job.
    // Verify it returns prepared inputs without a draft_status field.
    expect("draft_status" in result).toBe(false);
  });
});

// ── generateAnnotationText tests ──────────────────────────────────────────────

describe("generateAnnotationText", () => {
  it("produces header with clause and status", () => {
    const result = generateAnnotationText({
      clauseNumber:       "2.2.1",
      subClauseNumber:    "A.1(b)",
      status:             "partially_complied",
      reasoning:          "Size complied. Neodymium not proven.",
      missingInformation: "Neodymium confirmation required.",
      contractorAction:   "Provide manufacturer spec.",
      exactQuote:         "8 × 3.5-inch HQ drivers"
    });
    expect(result.clauseLabel).toBe("2.2.1 A.1(b)");
    expect(result.statusLabel).toBe("PARTIALLY COMPLIED");
    expect(result.calloutText).toContain("2.2.1 A.1(b)");
    expect(result.calloutText).toContain("PARTIALLY COMPLIED");
  });

  it("calloutText is at most 500 characters", () => {
    const longText = "a".repeat(1000);
    const result = generateAnnotationText({
      clauseNumber: "1.1", subClauseNumber: null, status: "not_proven",
      reasoning: longText, missingInformation: longText,
      contractorAction: longText, exactQuote: null
    });
    expect(result.calloutText.length).toBeLessThanOrEqual(500);
  });

  it("fullReasoning includes exact quote when provided", () => {
    const result = generateAnnotationText({
      clauseNumber: "3.2", subClauseNumber: null, status: "complied",
      reasoning: "Direct match.", missingInformation: null,
      contractorAction: null, exactQuote: "8 × 3.5-inch HQ drivers"
    });
    expect(result.fullReasoning).toContain("8 × 3.5-inch HQ drivers");
  });

  it("actionLine is null when no contractorAction", () => {
    const result = generateAnnotationText({
      clauseNumber: "1.1", subClauseNumber: null, status: "complied",
      reasoning: "OK", missingInformation: null, contractorAction: null, exactQuote: "text"
    });
    expect(result.actionLine).toBeNull();
  });

  it("uses fallback clause label when no clause number", () => {
    const result = generateAnnotationText({
      clauseNumber: null, subClauseNumber: null, status: "not_proven",
      reasoning: "Missing.", missingInformation: null, contractorAction: null, exactQuote: null
    });
    expect(result.clauseLabel).toBe("—");
  });

  it("all compliance statuses produce a valid status label", () => {
    const statuses: import("@/types/domain").ComplianceStatus[] = [
      "complied", "partially_complied", "not_complied", "ambiguous",
      "not_proven", "exceeds_requirement", "not_applicable", "not_verified"
    ];
    for (const status of statuses) {
      const result = generateAnnotationText({
        clauseNumber: "1.1", subClauseNumber: null, status,
        reasoning: "r", missingInformation: null, contractorAction: null, exactQuote: null
      });
      expect(result.statusLabel.length).toBeGreaterThan(0);
    }
  });
});

// ── Annotation styles tests ───────────────────────────────────────────────────

describe("getAnnotationStyle", () => {
  it("complied → green colors, rectangle highlight", () => {
    const style = getAnnotationStyle("complied");
    expect(style.highlightShape).toBe("rectangle");
    expect(style.connectorDash).toBe(false);
    expect(style.colors.highlightBorder.g).toBeGreaterThan(style.colors.highlightBorder.r);
  });

  it("partially_complied → cloud highlight", () => {
    const style = getAnnotationStyle("partially_complied");
    expect(style.highlightShape).toBe("cloud");
  });

  it("not_complied → cloud highlight, dashes off", () => {
    const style = getAnnotationStyle("not_complied");
    expect(style.highlightShape).toBe("cloud");
    expect(style.connectorDash).toBe(false);
  });

  it("ambiguous → dashed connector", () => {
    const style = getAnnotationStyle("ambiguous");
    expect(style.connectorDash).toBe(true);
  });

  it("not_proven → dashed connector", () => {
    const style = getAnnotationStyle("not_proven");
    expect(style.connectorDash).toBe(true);
  });

  it("all styles have RGB values between 0–255", () => {
    const statuses: import("@/types/domain").ComplianceStatus[] = [
      "complied", "partially_complied", "not_complied", "ambiguous",
      "not_proven", "exceeds_requirement", "not_applicable", "not_verified"
    ];
    for (const status of statuses) {
      const style = getAnnotationStyle(status);
      for (const [, rgb] of Object.entries(style.colors)) {
        if (typeof rgb === "object" && rgb !== null && "r" in rgb) {
          const { r, g, b } = rgb as { r: number; g: number; b: number };
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
});

// ── Placement engine tests ────────────────────────────────────────────────────

describe("computeAnnotationPlacement", () => {
  const PAGE = { width: 595, height: 842, rotation: 0 as const };
  const CALLOUT = { width: 160, height: 90 };
  const MARGIN  = 12;

  it("places callout to the right by default (mid-page evidence)", () => {
    const evidenceBox: BoundingBox = { x: 200, y: 400, width: 150, height: 20 };
    const result = computeAnnotationPlacement({
      page: PAGE, evidenceBox, callout: CALLOUT, existingCallouts: [], margin: MARGIN
    });
    expect(result.side).toBe("right");
    expect(result.callout.x).toBeGreaterThan(evidenceBox.x + evidenceBox.width);
  });

  it("callout stays within page bounds", () => {
    const evidenceBox: BoundingBox = { x: 500, y: 400, width: 80, height: 20 };
    const result = computeAnnotationPlacement({
      page: PAGE, evidenceBox, callout: CALLOUT, existingCallouts: [], margin: MARGIN
    });
    expect(result.callout.x).toBeGreaterThanOrEqual(0);
    expect(result.callout.x + result.callout.width).toBeLessThanOrEqual(PAGE.width);
    expect(result.callout.y).toBeGreaterThanOrEqual(0);
    expect(result.callout.y + result.callout.height).toBeLessThanOrEqual(PAGE.height);
  });

  it("falls back to left when right side is off page", () => {
    // Evidence near right edge.
    const evidenceBox: BoundingBox = { x: 500, y: 400, width: 50, height: 20 };
    const result = computeAnnotationPlacement({
      page: { ...PAGE, width: 595 }, evidenceBox, callout: CALLOUT, existingCallouts: [], margin: MARGIN
    });
    // Right side would be at x=562, which would push callout to x=562+12=574, but 574+160 > 595 → clipped.
    // Result should be clipped and a warning issued.
    expect(result.callout.x + result.callout.width).toBeLessThanOrEqual(PAGE.width);
    // Some side was chosen.
    expect(["right", "left", "above", "below"]).toContain(result.side);
  });

  it("avoids covering evidence box", () => {
    const evidenceBox: BoundingBox = { x: 100, y: 400, width: 200, height: 30 };
    const result = computeAnnotationPlacement({
      page: PAGE, evidenceBox, callout: CALLOUT, existingCallouts: [], margin: MARGIN
    });
    // Callout should not overlap evidence.
    const overlapX = Math.max(0, Math.min(result.callout.x + result.callout.width, evidenceBox.x + evidenceBox.width) - Math.max(result.callout.x, evidenceBox.x));
    const overlapY = Math.max(0, Math.min(result.callout.y + result.callout.height, evidenceBox.y + evidenceBox.height) - Math.max(result.callout.y, evidenceBox.y));
    const overlap  = overlapX * overlapY;
    // With margin, the callout should not overlap evidence (within floating-point tolerance).
    expect(overlap).toBe(0);
  });

  it("connector start is on the callout boundary", () => {
    const evidenceBox: BoundingBox = { x: 100, y: 400, width: 200, height: 30 };
    const result = computeAnnotationPlacement({
      page: PAGE, evidenceBox, callout: CALLOUT, existingCallouts: [], margin: MARGIN
    });
    const ct = result.callout;
    const cs = result.connectorStart;
    // Start must be on or near the callout boundary.
    const onLeft   = Math.abs(cs.x - ct.x) < 1;
    const onRight  = Math.abs(cs.x - (ct.x + ct.width)) < 1;
    const onTop    = Math.abs(cs.y - (ct.y + ct.height)) < 1;
    const onBottom = Math.abs(cs.y - ct.y) < 1;
    expect(onLeft || onRight || onTop || onBottom).toBe(true);
  });

  it("connector end is at evidence center", () => {
    const evidenceBox: BoundingBox = { x: 100, y: 400, width: 200, height: 30 };
    const result = computeAnnotationPlacement({
      page: PAGE, evidenceBox, callout: CALLOUT, existingCallouts: [], margin: MARGIN
    });
    expect(result.connectorEnd.x).toBeCloseTo(evidenceBox.x + evidenceBox.width / 2, 1);
    expect(result.connectorEnd.y).toBeCloseTo(evidenceBox.y + evidenceBox.height / 2, 1);
  });

  it("minimizes collision with existing callouts", () => {
    // Block the right side.
    const evidenceBox: BoundingBox = { x: 100, y: 400, width: 100, height: 20 };
    const blockingCallout: BoundingBox = { x: 220, y: 380, width: 160, height: 90 };
    const result = computeAnnotationPlacement({
      page: PAGE, evidenceBox, callout: CALLOUT,
      existingCallouts: [blockingCallout], margin: MARGIN
    });
    // Result should avoid the blocking callout by choosing a different side.
    // Left, above, or below would have zero collision.
    expect(result.collisionScore).toBeLessThan(blockingCallout.width * blockingCallout.height);
  });

  it("warns when no unclipped placement is possible", () => {
    // Very large callout on a tiny page.
    const evidenceBox: BoundingBox = { x: 10, y: 10, width: 50, height: 10 };
    const result = computeAnnotationPlacement({
      page: { width: 100, height: 100, rotation: 0 },
      evidenceBox,
      callout: { width: 90, height: 80 },   // Callout takes almost whole page
      existingCallouts: [],
      margin: MARGIN
    });
    // Page is tiny; callout will be clipped.
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("deterministic: same input always produces same output", () => {
    const evidenceBox: BoundingBox = { x: 100, y: 400, width: 200, height: 30 };
    const input = { page: PAGE, evidenceBox, callout: CALLOUT, existingCallouts: [], margin: MARGIN };
    const r1 = computeAnnotationPlacement(input);
    const r2 = computeAnnotationPlacement(input);
    expect(r1.side).toBe(r2.side);
    expect(r1.callout.x).toBe(r2.callout.x);
    expect(r1.callout.y).toBe(r2.callout.y);
  });

  it("handles rotated page (rotation=90)", () => {
    const evidenceBox: BoundingBox = { x: 100, y: 300, width: 100, height: 20 };
    const result = computeAnnotationPlacement({
      page: { width: 842, height: 595, rotation: 90 },
      evidenceBox, callout: CALLOUT, existingCallouts: [], margin: MARGIN
    });
    // Callout should still be within landscape page bounds.
    expect(result.callout.x + result.callout.width).toBeLessThanOrEqual(842);
    expect(result.callout.y + result.callout.height).toBeLessThanOrEqual(595);
  });
});

// ── Golden speaker annotation test ───────────────────────────────────────────

describe("Golden speaker annotation — 2.2.1 A.1(b)", () => {
  const svc = new AnnotationPreparationService();

  const goldenInput = makeInput({
    clauseNumber:         "2.2.1",
    subClauseNumber:      "A.1(b)",
    finalStatus:          "partially_complied",
    approvedReasoning:    "Driver size (3.5 inch) confirmed. Full-range construction and neodymium magnets not proven.",
    approvedMissingInfo:  "Full-range specification and neodymium magnet confirmation missing.",
    approvedContractorAction: "Provide manufacturer confirmation of full-range drivers with neodymium magnets.",
    exactQuote:           "8 × 3.5-inch HQ drivers",
    normalizedBox:        { x: 0.1, y: 0.55, width: 0.45, height: 0.035 }
  });

  it("golden finding passes preparation validation", () => {
    const result = svc.prepare([goldenInput], "review-1", {});
    expect(result.prepared).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("callout contains clause reference", () => {
    const result = svc.prepare([goldenInput], "review-1", {});
    const text = result.prepared[0]!.text;
    expect(text.calloutText).toContain("2.2.1");
    expect(text.calloutText).toContain("A.1(b)");
  });

  it("callout contains PARTIALLY COMPLIED status", () => {
    const result = svc.prepare([goldenInput], "review-1", {});
    const text = result.prepared[0]!.text;
    expect(text.statusLabel).toBe("PARTIALLY COMPLIED");
  });

  it("full reasoning states what is proven and what is missing", () => {
    const result = svc.prepare([goldenInput], "review-1", {});
    const text = result.prepared[0]!.text;
    expect(text.fullReasoning).toContain("3.5 inch");
    expect(text.fullReasoning).toContain("not proven");
    expect(text.fullReasoning).toContain("neodymium");
  });

  it("evidence quote appears in full reasoning", () => {
    const result = svc.prepare([goldenInput], "review-1", {});
    const text = result.prepared[0]!.text;
    expect(text.fullReasoning).toContain("8 × 3.5-inch HQ drivers");
  });

  it("style uses cloud highlight for partially_complied", () => {
    const result = svc.prepare([goldenInput], "review-1", {});
    const style = result.prepared[0]!.style;
    expect(style.highlightShape).toBe("cloud");
    expect(style.connectorDash).toBe(false);
  });

  it("placement keeps callout inside A4 page (595×842 pts)", () => {
    const result = svc.prepare([goldenInput], "review-1", {});
    const ann = result.prepared[0]!;

    // Convert normalized box to PDF points.
    const pageW = 595;
    const pageH = 842;
    const normBox = ann.input.normalizedBox!;
    const evidencePts: BoundingBox = {
      x:      normBox.x * pageW,
      y:      (1 - normBox.y - normBox.height) * pageH,
      width:  normBox.width * pageW,
      height: normBox.height * pageH
    };

    const placement = computeAnnotationPlacement({
      page:            { width: pageW, height: pageH, rotation: 0 },
      evidenceBox:     evidencePts,
      callout:         { width: 160, height: 90 },
      existingCallouts: [],
      margin:          12
    });

    expect(placement.callout.x).toBeGreaterThanOrEqual(0);
    expect(placement.callout.y).toBeGreaterThanOrEqual(0);
    expect(placement.callout.x + placement.callout.width).toBeLessThanOrEqual(pageW);
    expect(placement.callout.y + placement.callout.height).toBeLessThanOrEqual(pageH);
  });
});
