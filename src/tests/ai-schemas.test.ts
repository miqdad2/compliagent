import { describe, expect, it } from "vitest";
import { complianceFindingSchema, documentClassificationSchema } from "@/lib/agents/schemas";

describe("AI output schemas", () => {
  it("validates document classification JSON", () => {
    const parsed = documentClassificationSchema.parse({
      documentRoleSuggestion: "main_specification",
      documentType: "Technical specification",
      language: "en",
      ocrRequired: false,
      containsTables: true,
      containsDrawings: false,
      containsCertificates: false,
      confidence: 0.91
    });

    expect(parsed.documentRoleSuggestion).toBe("main_specification");
  });

  it("rejects compliance findings without valid source quotes", () => {
    const result = complianceFindingSchema.safeParse({
      requirementSource: {
        documentName: "Spec.pdf",
        pageNumber: 1,
        quote: ""
      },
      evidenceSource: null,
      status: "ambiguous_not_proven",
      weightageScore: 2,
      confidenceScore: 20,
      reasoning: "Evidence was not found.",
      missingInformation: "Submit datasheet.",
      contractorAction: "Provide supporting evidence.",
      riskLevel: "medium",
      requiresHumanReview: true
    });

    expect(result.success).toBe(false);
  });
});
