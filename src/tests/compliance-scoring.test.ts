import { describe, expect, it } from "vitest";
import { confidenceBand, decideCompliance } from "@/lib/compliance/scoring";
import type { SourceReference } from "@/types/domain";

const requirementSource: SourceReference = {
  documentName: "Specification.pdf",
  pageNumber: 4,
  clauseNumber: "2.1",
  quote: "The submitted product shall comply with the stated technical requirement."
};

const evidenceSource: SourceReference = {
  documentName: "Datasheet.pdf",
  pageNumber: 2,
  clauseNumber: "Table 1",
  quote: "The product provides the stated technical feature."
};

describe("decideCompliance", () => {
  it("marks direct supported evidence as complied", () => {
    const decision = decideCompliance({
      requirementSource,
      evidenceSource,
      directMatch: true,
      contradictionFound: false,
      missingEvidence: false,
      partiallySupported: false,
      notApplicable: false,
      confidenceScore: 94
    });

    expect(decision.status).toBe("complied");
    expect(decision.weightageScore).toBe(10);
    expect(decision.requiresHumanReview).toBe(false);
  });

  it("marks missing source references as not verified", () => {
    const decision = decideCompliance({
      requirementSource,
      evidenceSource: null,
      directMatch: false,
      contradictionFound: false,
      missingEvidence: true,
      partiallySupported: false,
      notApplicable: false,
      confidenceScore: 20
    });

    expect(decision.status).toBe("not_verified");
    expect(decision.requiresHumanReview).toBe(true);
  });

  it("keeps low confidence partial evidence conservative", () => {
    const decision = decideCompliance({
      requirementSource,
      evidenceSource,
      directMatch: false,
      contradictionFound: false,
      missingEvidence: false,
      partiallySupported: true,
      notApplicable: false,
      confidenceScore: 48,
      criticality: "critical"
    });

    expect(decision.status).toBe("partially_complied");
    expect(decision.weightageScore).toBeLessThanOrEqual(6);
    expect(decision.requiresHumanReview).toBe(true);
  });
});

describe("confidenceBand", () => {
  it("classifies confidence scores", () => {
    expect(confidenceBand(95)).toBe("direct");
    expect(confidenceBand(75)).toBe("strong");
    expect(confidenceBand(55)).toBe("partial");
    expect(confidenceBand(35)).toBe("weak");
    expect(confidenceBand(10)).toBe("insufficient");
  });
});
