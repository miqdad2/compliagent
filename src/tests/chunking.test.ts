import { describe, expect, it } from "vitest";
import {
  chunkPages,
  inferClauseNumber,
  inferSectionHeading,
  normalizeDocumentText,
  type TextPage
} from "@/lib/documents/chunking";

const documentId = "11111111-1111-4111-8111-111111111111";

function page(pageNumber: number, rawText: string): TextPage {
  return {
    documentId,
    pageNumber,
    rawText,
    normalizedText: normalizeDocumentText(rawText),
    extractionMethod: "pdf_text",
    confidence: 0.95,
    sourceLabel: `Page ${pageNumber}`,
    ocrRecommended: false
  };
}

describe("document chunking", () => {
  it("normalizes document text", () => {
    expect(normalizeDocumentText("A\n\n  B\tC")).toBe("A B C");
  });

  it("infers common clause-number formats", () => {
    expect(inferClauseNumber("2.3.1 The equipment shall be certified.")).toBe("2.3.1");
    expect(inferClauseNumber("A.4.2 Inspection requirements")).toBe("A.4.2");
    expect(inferClauseNumber("(b) Provide the test certificate.")).toBe("(b)");
  });

  it("detects numbered, title-case, and uppercase section headings", () => {
    expect(inferSectionHeading("2 General Requirements")).toBe("General Requirements");
    expect(inferSectionHeading("Testing And Commissioning")).toBe("Testing And Commissioning");
    expect(inferSectionHeading("INSTALLATION REQUIREMENTS")).toBe("INSTALLATION REQUIREMENTS");
    expect(inferSectionHeading("2.1 The contractor shall submit evidence.")).toBeNull();
  });

  it("preserves document, page, section, clause, method, and source label", () => {
    const chunks = chunkPages([
      page(
        7,
        "2 General Requirements\n\n2.1 The contractor shall submit evidence.\nSupporting records shall identify the tested equipment.\n\n2.2 Certificates shall be provided."
      )
    ]);

    expect(chunks).toHaveLength(3);
    expect(chunks[1]).toMatchObject({
      documentId,
      pageNumber: 7,
      sectionHeading: "General Requirements",
      clauseNumber: "2.1",
      extractionMethod: "pdf_text",
      sourceLabel: "Page 7"
    });
    expect(chunks[1]?.rawText).toContain("Supporting records");
    expect(chunks[2]?.clauseNumber).toBe("2.2");
  });

  it("never combines text across page boundaries", () => {
    const chunks = chunkPages([page(1, "1.1 First-page requirement text."), page(2, "1.2 Second-page requirement text.")]);

    expect(chunks).toHaveLength(2);
    expect(chunks.map((chunk) => chunk.pageNumber)).toEqual([1, 2]);
  });

  it("splits oversized source blocks without losing normalized text", () => {
    const sourceText = `1.1 ${"The equipment shall retain traceable test evidence. ".repeat(12)}`.trim();
    const chunks = chunkPages([page(1, sourceText)], 180);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.rawText.length <= 180)).toBe(true);
    expect(normalizeDocumentText(chunks.map((chunk) => chunk.rawText).join(" "))).toBe(normalizeDocumentText(sourceText));
  });
});
