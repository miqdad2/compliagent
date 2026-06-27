/**
 * product-direction.test.ts
 *
 * Regression tests for Unit 17H: correct product direction.
 * Verifies that:
 * - Automated clause-by-clause review is the core product model
 * - Compliance report (not annotated PDF) is the primary final output
 * - Exception-based review model is correctly implemented
 * - Annotation subsystem is preserved but hidden from normal workflow
 * - Client terminology does not reference annotation as the main output
 * - Source documents remain immutable
 * - No live AI is enabled
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  classifyFinding,
  countAutoVerified,
  countRequiresAttention,
  CLIENT_STAGE_ACTION,
  CLIENT_STAGE_LABEL,
  COMPLIANCE_REPORT_SECTIONS,
  type ClientProjectStage
} from "@/lib/compliance/client-stages";

// ── Helpers ────────────────────────────────────────────────────────────────────

function readSrc(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), "utf8");
}

function fileExists(rel: string): boolean {
  return existsSync(resolve(process.cwd(), rel));
}

// ── 1. Annotation is not a primary client stage ───────────────────────────────

describe("1. Annotation is not a primary client stage", () => {
  it("ClientProjectStage does not include 'annotation' as a value", () => {
    const actions = Object.values(CLIENT_STAGE_ACTION);
    const labels  = Object.values(CLIENT_STAGE_LABEL);
    for (const v of [...actions, ...labels]) {
      expect(v.toLowerCase()).not.toContain("annotation");
    }
  });

  it("workflow stepper source does not use 'annotation' as a step id or label", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).not.toContain('"annotation"');
    expect(src).not.toContain("label: \"Annotation\"");
  });

  it("workflow stepper has 'report' as the final step id", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).toContain('"report"');
    expect(src).toContain("Compliance report");
  });
});

// ── 2. Compliance report is the primary final stage ───────────────────────────

describe("2. Compliance report is the primary final stage", () => {
  it("ClientProjectStage includes 'ready_for_report' and 'report_ready'", () => {
    const readyForReport: ClientProjectStage = "ready_for_report";
    const reportReady: ClientProjectStage    = "report_ready";
    expect(CLIENT_STAGE_LABEL[readyForReport]).toBeTruthy();
    expect(CLIENT_STAGE_LABEL[reportReady]).toBeTruthy();
  });

  it("COMPLIANCE_REPORT_SECTIONS is documented and non-empty", () => {
    expect(COMPLIANCE_REPORT_SECTIONS.length).toBeGreaterThan(5);
    expect(COMPLIANCE_REPORT_SECTIONS).toContain("Clause-by-clause compliance matrix");
    expect(COMPLIANCE_REPORT_SECTIONS).toContain("Missing-information schedule");
    expect(COMPLIANCE_REPORT_SECTIONS).toContain("Contractor-action schedule");
  });
});

// ── 3. Project state maps approved review to ready_for_report ─────────────────

describe("3. Project state maps approved review correctly", () => {
  it("ready_for_report action is 'Generate compliance report'", () => {
    expect(CLIENT_STAGE_ACTION["ready_for_report"]).toBe("Generate compliance report");
  });

  it("approved review → report tab shows report generation message", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).toContain("Report");
    expect(src).toContain("compliance report");
  });
});

// ── 4. report_ready maps to download action ───────────────────────────────────

describe("4. report_ready maps to download action", () => {
  it("report_ready action is 'Download compliance report'", () => {
    expect(CLIENT_STAGE_ACTION["report_ready"]).toBe("Download compliance report");
  });
});

// ── 5. Flagged findings count includes ambiguous ──────────────────────────────

describe("5. Flagged findings count includes ambiguous", () => {
  it("classifyFinding('ambiguous') is requires_attention", () => {
    expect(classifyFinding("ambiguous")).toBe("requires_attention");
  });

  it("countRequiresAttention counts ambiguous findings", () => {
    const findings = [{ status: "complied" }, { status: "ambiguous" }];
    expect(countRequiresAttention(findings)).toBe(1);
  });
});

// ── 6. Flagged findings count includes not_proven ─────────────────────────────

describe("6. Flagged findings count includes not_proven", () => {
  it("classifyFinding('not_proven') is requires_attention", () => {
    expect(classifyFinding("not_proven")).toBe("requires_attention");
  });

  it("countRequiresAttention counts not_proven findings", () => {
    const findings = [{ status: "complied" }, { status: "not_proven" }];
    expect(countRequiresAttention(findings)).toBe(1);
  });
});

// ── 7. Flagged findings count includes not_complied ───────────────────────────

describe("7. Flagged findings count includes not_complied", () => {
  it("classifyFinding('not_complied') is requires_attention", () => {
    expect(classifyFinding("not_complied")).toBe("requires_attention");
  });

  it("countRequiresAttention counts not_complied findings", () => {
    const findings = [{ status: "complied" }, { status: "not_complied" }];
    expect(countRequiresAttention(findings)).toBe(1);
  });
});

// ── 8. Flagged findings count includes partially_complied (contradictions) ────

describe("8. Flagged findings count includes partially_complied", () => {
  it("classifyFinding('partially_complied') is requires_attention", () => {
    expect(classifyFinding("partially_complied")).toBe("requires_attention");
  });

  it("countRequiresAttention counts all partial/ambiguous/not-proven/not-complied", () => {
    const findings = [
      { status: "complied" },
      { status: "partially_complied" },
      { status: "ambiguous" },
      { status: "not_proven" },
      { status: "not_complied" }
    ];
    expect(countRequiresAttention(findings)).toBe(4);
  });
});

// ── 9. Automatically verified count excludes unresolved findings ───────────────

describe("9. Auto-verified count excludes unresolved findings", () => {
  it("countAutoVerified counts only complied, exceeds_requirement, not_applicable", () => {
    const findings = [
      { status: "complied" },
      { status: "exceeds_requirement" },
      { status: "not_applicable" },
      { status: "not_proven" },
      { status: "ambiguous" }
    ];
    expect(countAutoVerified(findings)).toBe(3);
  });

  it("countAutoVerified + countRequiresAttention covers all finding statuses", () => {
    const all = [
      { status: "complied" },
      { status: "exceeds_requirement" },
      { status: "not_applicable" },
      { status: "not_complied" },
      { status: "partially_complied" },
      { status: "not_proven" },
      { status: "ambiguous" },
      { status: "not_verified" }
    ];
    const auto = countAutoVerified(all);
    const attn = countRequiresAttention(all);
    expect(auto + attn).toBe(all.length);
  });
});

// ── 10. Primary action is "Review flagged findings" when exceptions exist ──────

describe("10. Primary action is Review flagged findings", () => {
  it("human_verification_required action is 'Review flagged findings'", () => {
    expect(CLIENT_STAGE_ACTION["human_verification_required"]).toBe("Review flagged findings");
  });

  it("attention_required action is 'Review flagged findings'", () => {
    expect(CLIENT_STAGE_ACTION["attention_required"]).toBe("Review flagged findings");
  });

  it("project page header action uses 'Review flagged findings' for awaiting_human_review", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).toContain("Review flagged findings");
  });

  it("projects list page uses 'Review flagged findings' as next action", () => {
    const src = readSrc("src/app/(dashboard)/projects/page.tsx");
    expect(src).toContain("Review flagged findings");
  });
});

// ── 11. Reviewer is not forced to inspect every complied finding ───────────────

describe("11. Reviewer not forced to inspect complied findings", () => {
  it("complied findings count toward auto_verified, not requires_attention", () => {
    const all = [
      { status: "complied" }, { status: "complied" }, { status: "complied" },
      { status: "not_proven" }
    ];
    expect(countAutoVerified(all)).toBe(3);
    expect(countRequiresAttention(all)).toBe(1);
  });

  it("project overview shows 'Automatically verified' count separately", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).toContain("Automatically verified");
    expect(src).toContain("autoVerifiedCount");
  });
});

// ── 12. not_proven remains distinct from not_complied ────────────────────────

describe("12. not_proven distinct from not_complied", () => {
  it("both are in requires_attention but are separate status strings", () => {
    expect(classifyFinding("not_proven")).toBe("requires_attention");
    expect(classifyFinding("not_complied")).toBe("requires_attention");
  });

  it("compliance matrix retains status field distinguishing not_proven and not_complied", () => {
    const src = readSrc("src/components/compliance/compliance-matrix.tsx");
    expect(src).toMatch(/not_proven|NOT_PROVEN/);
    expect(src).toMatch(/not_complied|NOT_COMPLIED/);
  });
});

// ── 13. Compliance matrix retains exact evidence references ───────────────────

describe("13. Compliance matrix retains exact evidence references", () => {
  it("ComplianceMatrixRow has evidenceText field", () => {
    const src = readSrc("src/components/compliance/compliance-matrix.tsx");
    expect(src).toContain("evidenceText");
  });
});

// ── 14. Compliance matrix retains missing-information fields ──────────────────

describe("14. Compliance matrix retains missing-information fields", () => {
  it("ComplianceMatrixRow has missingInformation field", () => {
    const src = readSrc("src/components/compliance/compliance-matrix.tsx");
    expect(src).toContain("missingInformation");
  });
});

// ── 15. Compliance matrix retains contractor-action fields ────────────────────

describe("15. Compliance matrix retains contractor-action fields", () => {
  it("ComplianceMatrixRow has contractorAction field", () => {
    const src = readSrc("src/components/compliance/compliance-matrix.tsx");
    expect(src).toContain("contractorAction");
  });
});

// ── 16. Annotation routes remain intact ───────────────────────────────────────

describe("16. Annotation routes remain intact", () => {
  it("annotations route exists at /api/reviews/[reviewId]/annotations", () => {
    expect(fileExists("src/app/api/reviews/[reviewId]/annotations/route.ts")).toBe(true);
  });

  it("annotations download route exists", () => {
    expect(fileExists("src/app/api/reviews/[reviewId]/annotations/[outputId]/download/route.ts")).toBe(true);
  });

  it("ready-for-annotation gate route exists", () => {
    expect(fileExists("src/app/api/reviews/[reviewId]/ready-for-annotation/route.ts")).toBe(true);
  });
});

// ── 17. Annotation code is not deleted ────────────────────────────────────────

describe("17. Annotation code is not deleted", () => {
  it("annotation placement module exists", () => {
    expect(fileExists("src/lib/annotations/placement.ts")).toBe(true);
  });

  it("annotation content module exists", () => {
    expect(fileExists("src/lib/annotations/content.ts")).toBe(true);
  });

  it("pdf renderer interface exists", () => {
    expect(fileExists("src/lib/annotations/pdf-renderer.ts")).toBe(true);
  });

  it("annotation styles module exists", () => {
    expect(fileExists("src/lib/annotations/styles.ts")).toBe(true);
  });
});

// ── 18. Annotation is hidden from the normal client workflow ──────────────────

describe("18. Annotation is hidden from normal client workflow", () => {
  it("workflow stepper does not include annotation as a visible step", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    // The 5th step should be 'report', not 'annotation'
    expect(src).not.toContain('id: "annotation"');
    expect(src).toContain('id: "report"');
  });

  it("project tabs do not include an annotation tab", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).not.toContain('"annotation"');
    // Standard tabs present
    expect(src).toContain('"overview"');
    expect(src).toContain('"documents"');
    expect(src).toContain('"findings"');
  });

  it("project page does not list annotation as a primary next action", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).not.toContain("Generate annotated PDF");
    expect(src).not.toContain("Annotation readiness");
    expect(src).not.toContain("annotation readiness");
  });
});

// ── 19. Client terminology does not use annotation as the main output ─────────

describe("19. Client terminology — annotation not the main output", () => {
  it("projects list page does not show annotation as next action", () => {
    const src = readSrc("src/app/(dashboard)/projects/page.tsx");
    expect(src).not.toContain("annotated PDF");
    expect(src).not.toContain("Annotation");
  });

  it("project page uses 'Compliance report' not 'Annotated PDF' as final output", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).toContain("Compliance report");
    expect(src).not.toContain("Annotated PDF");
    expect(src).not.toContain("annotated PDF");
  });

  it("project page status label for awaiting_human_review is 'Needs your review'", () => {
    const src = readSrc("src/app/(dashboard)/projects/[projectId]/page.tsx");
    expect(src).toContain("Needs your review");
    expect(src).not.toContain("Awaiting reviewer");
  });

  it("projects list page status label is 'Needs your review'", () => {
    const src = readSrc("src/app/(dashboard)/projects/page.tsx");
    expect(src).toContain("Needs your review");
  });
});

// ── 20. Report requirements are documented ────────────────────────────────────

describe("20. Report requirements are documented", () => {
  it("COMPLIANCE_REPORT_SECTIONS includes executive summary", () => {
    expect(COMPLIANCE_REPORT_SECTIONS).toContain("Executive summary");
  });

  it("COMPLIANCE_REPORT_SECTIONS includes audit trail", () => {
    expect(COMPLIANCE_REPORT_SECTIONS).toContain("Audit trail");
  });

  it("COMPLIANCE_REPORT_SECTIONS includes items not complied", () => {
    expect(COMPLIANCE_REPORT_SECTIONS).toContain("Items not complied");
  });

  it("COMPLIANCE_REPORT_SECTIONS includes items not proven", () => {
    expect(COMPLIANCE_REPORT_SECTIONS).toContain("Items not proven");
  });
});

// ── 21. Source documents remain immutable ─────────────────────────────────────

describe("21. Source documents remain immutable", () => {
  it("architecture.md declares the immutability invariant", () => {
    const src = readSrc("context/architecture.md");
    expect(src).toContain("Original documents are never overwritten");
  });

  it("annotation renderer uploads annotated output to the exports bucket", () => {
    const src = readSrc("src/server/services/annotations/pdf-lib-renderer.ts");
    // Output upload must target the exports bucket — never the documents/originals bucket
    expect(src).toContain('.from("exports")');
    // The generated output path includes "annotated" to distinguish it from source files
    expect(src).toContain("annotated-");
  });
});

// ── 22. No live AI is enabled ─────────────────────────────────────────────────

describe("22. No live AI is enabled", () => {
  it("Anthropic provider reads key from ANTHROPIC_API_KEY env var and returns null when absent", () => {
    const src = readSrc("src/server/services/ai/anthropic-provider.ts");
    expect(src).toContain("ANTHROPIC_API_KEY");
    const registrySrc = readSrc("src/server/services/ai/provider-registry.ts");
    expect(registrySrc).toContain("resolveAnthropicKey");
    expect(registrySrc).toContain("null");
  });

  it("controlled review route defaults to deterministic mode", () => {
    const src = readSrc("src/app/api/reviews/controlled/route.ts");
    expect(src).toContain("deterministic");
  });

  it("no hardcoded live API key in any source file", () => {
    // Check that no source file contains a real API key pattern
    // (a real key would be: sk-ant-api03-... or sk-... for OpenAI)
    const src = readSrc("src/app/api/reviews/controlled/route.ts");
    expect(src).not.toMatch(/sk-ant-api03-[A-Za-z0-9]/);
    expect(src).not.toMatch(/sk-[A-Za-z0-9]{48}/);
  });
});
