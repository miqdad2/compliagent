import { describe, expect, it } from "vitest";
import { chunkPages, inferClauseNumber, normalizeDocumentText } from "@/lib/documents/chunking";

describe("document chunking", () => {
  it("normalizes document text", () => {
    expect(normalizeDocumentText("A\n\n  B\tC")).toBe("A B C");
  });

  it("infers leading clause numbers", () => {
    expect(inferClauseNumber("2.3.1 The equipment shall be certified.")).toBe("2.3.1");
  });

  it("preserves page number and extraction method in chunks", () => {
    const chunks = chunkPages(
      [
        {
          pageNumber: 7,
          text: "1.1 The contractor shall submit evidence.\n\n1.2 Certificates shall be provided."
        }
      ],
      "pdf_text",
      45
    );

    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.pageNumber).toBe(7);
    expect(chunks[0]?.extractionMethod).toBe("pdf_text");
    expect(chunks[0]?.clauseNumber).toBe("1.1");
  });
});
