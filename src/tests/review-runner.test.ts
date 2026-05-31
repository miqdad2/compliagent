import { describe, expect, it } from "vitest";
import { generateTechnicalReview } from "@/lib/compliance/review-runner";

describe("generateTechnicalReview", () => {
  it("builds generic source-backed findings from document roles", () => {
    const review = generateTechnicalReview([
      {
        id: "spec",
        fileName: "Mechanical Specification.pdf",
        documentRole: "main_specification",
        chunks: [
          {
            pageNumber: 7,
            clauseNumber: "4.2",
            chunkText: "4.2 The pump shall provide stainless steel casing and IP55 motor protection.",
            normalizedText: "4.2 the pump shall provide stainless steel casing and ip55 motor protection."
          }
        ]
      },
      {
        id: "datasheet",
        fileName: "Pump Datasheet.pdf",
        documentRole: "product_datasheet",
        chunks: [
          {
            pageNumber: 2,
            clauseNumber: null,
            chunkText: "Casing material: stainless steel. Motor protection: IP55.",
            normalizedText: "casing material stainless steel motor protection ip55."
          }
        ]
      }
    ]);

    expect(review.findings).toHaveLength(1);
    expect(review.findings[0]?.requirementText).toContain("Mechanical Specification.pdf");
    expect(review.findings[0]?.evidenceText).toContain("Pump Datasheet.pdf");
    expect(review.findings[0]?.status).toBe("complied");
  });

  it("fails clearly when evidence documents are missing", () => {
    expect(() =>
      generateTechnicalReview([
        {
          id: "spec",
          fileName: "Civil Specification.pdf",
          documentRole: "main_specification",
          chunks: [
            {
              pageNumber: 1,
              clauseNumber: "1.1",
              chunkText: "1.1 The contractor shall submit test certificates.",
              normalizedText: "1.1 the contractor shall submit test certificates."
            }
          ]
        }
      ])
    ).toThrow("At least one proposed product");
  });

  it("recognizes the client Doc. 1-4 package even when uploaded roles are generic", () => {
    const review = generateTechnicalReview([
      {
        id: "doc1",
        fileName: "Doc.-1-Specifications.docx",
        documentRole: "main_specification",
        chunks: [
          {
            pageNumber: 1,
            clauseNumber: "2.1",
            chunkText: "2.1 The active speaker shall support monitored power supply and fault reporting.",
            normalizedText: "2.1 the active speaker shall support monitored power supply and fault reporting."
          }
        ]
      },
      {
        id: "doc2",
        fileName: "Doc.-2-BS-5839-8-2008.pdf",
        documentRole: "main_specification",
        chunks: [
          {
            pageNumber: 5,
            clauseNumber: "8.2",
            chunkText: "8.2 Voice alarm loudspeakers shall support evacuation message audibility.",
            normalizedText: "8.2 voice alarm loudspeakers shall support evacuation message audibility."
          }
        ]
      },
      {
        id: "doc3",
        fileName: "Doc.-3-BS-EN-54-4-1998.pdf",
        documentRole: "main_specification",
        chunks: [
          {
            pageNumber: 10,
            clauseNumber: "5.1",
            chunkText: "5.1 The power supply shall report faults and provide standby battery operation.",
            normalizedText: "5.1 the power supply shall report faults and provide standby battery operation."
          }
        ]
      },
      {
        id: "doc4",
        fileName: "Doc.-4-Proposed-Speaker.pdf",
        documentRole: "main_specification",
        chunks: [
          {
            pageNumber: 2,
            clauseNumber: null,
            chunkText: "The proposed active speaker supports monitored power supply, fault reporting, and evacuation message audibility.",
            normalizedText:
              "the proposed active speaker supports monitored power supply fault reporting and evacuation message audibility."
          }
        ]
      }
    ]);

    expect(review.title).toContain("Doc. 4 proposed speaker");
    expect(review.scope).toContain("Client minimum assessment");
    expect(review.findings.length).toBeGreaterThanOrEqual(3);
    expect(review.findings[0]?.requirementText).toContain("Assessment: Doc. 4 vs Doc.");
  });

  it("matches Doc. 4 evidence against long specification chunks using salient technical terms", () => {
    const review = generateTechnicalReview([
      {
        id: "doc1",
        fileName: "Doc.-1-Specifications.docx",
        documentRole: "main_specification",
        chunks: [
          {
            pageNumber: 1,
            clauseNumber: "2.2",
            chunkText:
              "2.2 Detailed requirements for materials. The list of equipment, accessories and its functional requirement stipulated below shall be read in conjunction with other relevant specification sections and in compliance to PAVA standards. Active line-arrays shall support beam steering, voice alarm use, power supply monitoring, and fault reporting.",
            normalizedText:
              "2.2 detailed requirements for materials the list of equipment accessories and its functional requirement stipulated below shall be read in conjunction with other relevant specification sections and in compliance to pava standards active line arrays shall support beam steering voice alarm use power supply monitoring and fault reporting."
          }
        ]
      },
      {
        id: "doc2",
        fileName: "Doc.-2-BS-5839-8-2008.pdf",
        documentRole: "main_specification",
        chunks: [
          {
            pageNumber: 1,
            clauseNumber: "1",
            chunkText: "1 Voice alarm systems shall be reviewed for loudspeaker audibility.",
            normalizedText: "1 voice alarm systems shall be reviewed for loudspeaker audibility."
          }
        ]
      },
      {
        id: "doc3",
        fileName: "Doc.-3-BS-EN-54-4-1998.pdf",
        documentRole: "main_specification",
        chunks: [
          {
            pageNumber: 1,
            clauseNumber: "1",
            chunkText: "1 Power supply equipment shall report faults.",
            normalizedText: "1 power supply equipment shall report faults."
          }
        ]
      },
      {
        id: "doc4",
        fileName: "Doc.-4-Proposed-Speaker.pdf",
        documentRole: "main_specification",
        chunks: [
          {
            pageNumber: 4,
            clauseNumber: null,
            chunkText:
              "The proposed active line array speaker provides beam steering, voice alarm integration, monitored power supply, and fault reporting.",
            normalizedText:
              "the proposed active line array speaker provides beam steering voice alarm integration monitored power supply and fault reporting."
          }
        ]
      }
    ]);

    const clause22 = review.findings.find((finding) => finding.clauseNumber === "2.2");
    expect(clause22?.evidenceText).toContain("Doc.-4-Proposed-Speaker.pdf");
    expect(clause22?.status).not.toBe("not_verified");
  });

  it("only applies relevant Doc. 2 active-speaker standard clauses in the client package", () => {
    const review = generateTechnicalReview([
      {
        id: "doc1",
        fileName: "Doc. 1 Specifications.pdf",
        documentRole: "main_specification",
        chunks: [
          {
            pageNumber: 1,
            clauseNumber: "1.1",
            chunkText: "1.1 The speaker shall support voice alarm operation.",
            normalizedText: "1.1 the speaker shall support voice alarm operation."
          }
        ]
      },
      {
        id: "doc2",
        fileName: "Doc. 2 Standard.pdf",
        documentRole: "reference_standard",
        chunks: [
          {
            pageNumber: 3,
            clauseNumber: "4.1",
            chunkText: "4.1 Loudspeaker circuits shall provide fault monitoring.",
            normalizedText: "4.1 loudspeaker circuits shall provide fault monitoring."
          },
          {
            pageNumber: 6,
            clauseNumber: "9.9",
            chunkText: "9.9 Control room furniture shall be labelled.",
            normalizedText: "9.9 control room furniture shall be labelled."
          }
        ]
      },
      {
        id: "doc3",
        fileName: "Doc. 3 Power Supply Standard.pdf",
        documentRole: "reference_standard",
        chunks: [
          {
            pageNumber: 4,
            clauseNumber: "5.1",
            chunkText: "5.1 Power supply equipment shall report faults.",
            normalizedText: "5.1 power supply equipment shall report faults."
          }
        ]
      },
      {
        id: "doc4",
        fileName: "Doc. 4 Proposed Speaker.pdf",
        documentRole: "proposed_product",
        chunks: [
          {
            pageNumber: 2,
            clauseNumber: null,
            chunkText: "The proposed speaker supports voice alarm operation and fault monitoring.",
            normalizedText: "the proposed speaker supports voice alarm operation and fault monitoring."
          }
        ]
      }
    ]);

    const scopes = review.findings.map((finding) => finding.requirementText);
    expect(scopes.some((text) => text.includes("Clause: 4.1"))).toBe(true);
    expect(scopes.some((text) => text.includes("Clause: 9.9"))).toBe(false);
  });

  it("marks lower proposed IP ratings as not complied", () => {
    const review = generateTechnicalReview([
      {
        id: "spec",
        fileName: "Electrical Specification.pdf",
        documentRole: "main_specification",
        chunks: [
          {
            pageNumber: 7,
            clauseNumber: "6.2",
            chunkText: "6.2 Outdoor equipment shall provide IP55 enclosure protection.",
            normalizedText: "6.2 outdoor equipment shall provide ip55 enclosure protection."
          }
        ]
      },
      {
        id: "datasheet",
        fileName: "Speaker Datasheet.pdf",
        documentRole: "product_datasheet",
        chunks: [
          {
            pageNumber: 2,
            clauseNumber: null,
            chunkText: "Enclosure protection: IP54.",
            normalizedText: "enclosure protection ip54."
          }
        ]
      }
    ]);

    expect(review.findings[0]?.status).toBe("not_complied");
  });
});
