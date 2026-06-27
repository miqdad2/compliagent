/**
 * Golden-test suite for Unit 9 — Native Document Intelligence.
 *
 * Tests cover:
 *   1. PPTX native extraction (new format added in Unit 9).
 *   2. Source-document hashing (SHA-256 hex, 64 chars).
 *   3. Golden fixtures from the client's line-array speaker project.
 *      These fixtures verify that the extraction layer preserves
 *      enough structure for downstream requirement-discovery and
 *      evidence-retrieval stages (Units 10+) to work correctly.
 *
 * No AI comparison or compliance logic runs here.
 * Fixtures are synthetic in-memory buffers — no real documents are committed.
 *
 * Note on format choices:
 *   - DOCX is used for multiline golden fixtures because mammoth faithfully
 *     extracts paragraph text including blank-line separators, giving the
 *     chunker the blank-line structure it needs for clause detection.
 *   - PDF (simple Tj-based builder) is used only for single-line assertions
 *     and hash tests, where multiline positioning operators are not needed.
 *   - PPTX is used for slide-based golden fixtures.
 */

import { describe, expect, it } from "vitest";
import {
  extractDocumentText,
  supportsDirectTextExtraction
} from "@/lib/documents/extraction";
import { chunkPages, inferClauseNumber, inferSectionHeading } from "@/lib/documents/chunking";

// ============================================================
// MIME types
// ============================================================

const pdfMimeType = "application/pdf";
const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const pptxMimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

// ============================================================
// ZIP and CRC helpers (shared by DOCX and PPTX builders)
// ============================================================

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function createStoredZipBuffer(entries: Array<{ name: string; content: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.from(entry.content, "utf8");
    const crc = crc32(content);

    const localHeader = Buffer.alloc(30 + name.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    name.copy(localHeader, 30);
    localParts.push(localHeader, content);

    const centralHeader = Buffer.alloc(46 + name.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    name.copy(centralHeader, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + content.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectory.length, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);

  return Buffer.concat([...localParts, centralDirectory, endOfCentralDirectory]);
}

function escapeXml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ============================================================
// PDF buffer builder (single-line text only)
//
// This builder encodes all text in a single Tj operator.
// It works reliably for single-line ASCII text but does NOT
// guarantee that multiline content (with newlines) is faithfully
// extracted by pdf-parse, because the library normalises text
// positions from a single Tj into one run without paragraph breaks.
// Use createMultiParaDocxBuffer for multiline golden fixtures.
// ============================================================

function escapePdfText(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function createSingleLinePdfBuffer(pageTexts: string[]): Buffer {
  const fontObjectId = 3 + pageTexts.length * 2;
  const objects = new Map<number, string>();
  const pageObjectIds = pageTexts.map((_, index) => 3 + index * 2);

  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`
  );

  pageTexts.forEach((text, index) => {
    const pageObjectId = pageObjectIds[index]!;
    const contentObjectId = pageObjectId + 1;
    const stream = text ? `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET` : "BT ET";
    objects.set(
      pageObjectId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`
    );
    objects.set(contentObjectId, `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });

  objects.set(fontObjectId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id <= objects.size; id += 1) {
    offsets[id] = Buffer.byteLength(pdf);
    pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.size + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= objects.size; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.size + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "binary");
}

// ============================================================
// DOCX buffer builder — multi-paragraph version
//
// Creates a DOCX where each entry in `lines` is a separate <w:p>.
// Empty strings become empty paragraphs (blank lines).
// mammoth.extractRawText inserts "\n" between paragraphs, so the
// chunker receives blank-line-separated blocks suitable for
// clause detection and section-heading inference.
// ============================================================

function createMultiParaDocxBuffer(lines: string[]): Buffer {
  const paragraphs = lines
    .map((line) =>
      line.trim()
        ? `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`
        : `<w:p/>`
    )
    .join("");

  return createStoredZipBuffer([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    },
    {
      name: "word/document.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs}</w:body>
</w:document>`
    },
    {
      name: "docProps/app.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Pages>1</Pages>
</Properties>`
    }
  ]);
}

// ============================================================
// PPTX buffer builder
// ============================================================

function createPptxBuffer(slideTexts: string[]): Buffer {
  const slideEntries = slideTexts.map((text, index) => {
    const slideNumber = index + 1;
    const paragraphs = text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => `<a:p><a:r><a:t>${escapeXml(line.trim())}</a:t></a:r></a:p>`)
      .join("");

    return {
      name: `ppt/slides/slide${slideNumber}.xml`,
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:spTree>
    <p:sp><p:txBody>
      <a:bodyPr/><a:lstStyle/>
      ${paragraphs}
    </p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`
    };
  });

  const sldIdLst = slideTexts.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join("");

  const presentationRels = slideTexts
    .map(
      (_, i) =>
        `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`
    )
    .join("");

  const contentTypeOverrides = slideTexts
    .map(
      (_, i) =>
        `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
    .join("");

  return createStoredZipBuffer([
    {
      name: "[Content_Types].xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${contentTypeOverrides}
</Types>`
    },
    {
      name: "_rels/.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
    },
    {
      name: "ppt/presentation.xml",
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>${sldIdLst}</p:sldIdLst>
</p:presentation>`
    },
    {
      name: "ppt/_rels/presentation.xml.rels",
      content: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${presentationRels}
</Relationships>`
    },
    ...slideEntries
  ]);
}

// ============================================================
// Golden content (domain-neutral — do not reference
// production AI logic or hardcode expected compliance findings).
// ============================================================

/**
 * Lines of the golden specification document.
 * Represents a real-world requirement clause the system must discover,
 * decompose, and compare against submission evidence in later units.
 *
 * Blank strings become blank lines (paragraph separators) in the DOCX
 * builder, preserving the block structure the chunker needs.
 */
const GOLDEN_SPEC_LINES = [
  "2. LOUDSPEAKER SYSTEM",
  "",
  "2.1 General",
  "",
  "The line-array system shall comply with the following requirements.",
  "",
  "2.2 Driver Specification",
  "",
  "2.2.1 Driver Units",
  "",
  "Drivers must be high-quality full-range units from 3.5 inches to 4 inches with neodymium magnets."
];

/**
 * Lines of the golden submission document.
 * Contains partial evidence: driver size and quality designation are
 * stated; full-range construction and neodymium magnet type are
 * implied by "HQ" but not directly confirmed.
 */
const GOLDEN_SUBMISSION_LINES = [
  "Technical Submission - Line Array Speaker System",
  "",
  "Model: LAS-350HQ Line Array Speaker",
  "",
  "Product Features",
  "8 x 3.5-inch HQ drivers"
];

// ============================================================
// 1. PPTX format support
// ============================================================

describe("PPTX extraction", () => {
  it("supportsDirectTextExtraction returns true for PPTX MIME type", () => {
    expect(supportsDirectTextExtraction(pptxMimeType)).toBe(true);
  });

  it("extracts text from a single-slide PPTX", async () => {
    const buffer = createPptxBuffer(["Slide one title\nSlide one body text."]);
    const result = await extractDocumentText(buffer, pptxMimeType);

    expect(result.pageCount).toBe(1);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.pageNumber).toBe(1);
    expect(result.pages[0]?.extractionMethod).toBe("pptx_text");
    expect(result.pages[0]?.rawText).toContain("Slide one title");
    expect(result.pages[0]?.rawText).toContain("Slide one body text.");
    expect(result.pages[0]?.sourceLabel).toBe("Slide 1");
  });

  it("extracts text from multiple slides and assigns sequential page numbers", async () => {
    const buffer = createPptxBuffer([
      "First slide heading\nFirst slide content.",
      "Second slide heading\nSecond slide content."
    ]);
    const result = await extractDocumentText(buffer, pptxMimeType);

    expect(result.pageCount).toBe(2);
    expect(result.pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(result.pages[0]?.rawText).toContain("First slide");
    expect(result.pages[1]?.rawText).toContain("Second slide");
    expect(result.pages[1]?.sourceLabel).toBe("Slide 2");
  });

  it("marks a PPTX slide with no text for OCR", async () => {
    const buffer = createPptxBuffer(["", "Second slide with content."]);
    const result = await extractDocumentText(buffer, pptxMimeType);

    expect(result.ocrRequired).toBe(true);
    expect(result.ocrRequiredPageNumbers).toContain(1);
    expect(result.pages[0]?.confidence).toBe(0);
    expect(result.pages[1]?.ocrRecommended).toBe(false);
  });

  it("throws a clear error for an empty presentation (zero slides)", async () => {
    const buffer = createPptxBuffer([]);
    await expect(extractDocumentText(buffer, pptxMimeType)).rejects.toMatchObject({
      code: "invalid_file"
    });
  });

  it("preserves multi-paragraph slide text joined by newlines", async () => {
    const buffer = createPptxBuffer(["Line one\nLine two\nLine three"]);
    const result = await extractDocumentText(buffer, pptxMimeType);
    const rawText = result.pages[0]?.rawText ?? "";

    expect(rawText).toContain("Line one");
    expect(rawText).toContain("Line two");
    expect(rawText).toContain("Line three");
  });
});

// ============================================================
// 2. Source document hash
// ============================================================

describe("source document hash", () => {
  it("attaches a 64-character SHA-256 hex sourceHash to a PDF extraction result", async () => {
    const buffer = createSingleLinePdfBuffer(["Any content."]);
    const result = await extractDocumentText(buffer, pdfMimeType);

    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash for identical buffers", async () => {
    const buffer = createSingleLinePdfBuffer(["Identical content."]);
    const [result1, result2] = await Promise.all([
      extractDocumentText(buffer, pdfMimeType),
      extractDocumentText(buffer, pdfMimeType)
    ]);

    expect(result1.sourceHash).toBe(result2.sourceHash);
  });

  it("produces different hashes for different buffers", async () => {
    const bufferA = createSingleLinePdfBuffer(["Content A."]);
    const bufferB = createSingleLinePdfBuffer(["Content B."]);
    const [resultA, resultB] = await Promise.all([
      extractDocumentText(bufferA, pdfMimeType),
      extractDocumentText(bufferB, pdfMimeType)
    ]);

    expect(resultA.sourceHash).not.toBe(resultB.sourceHash);
  });

  it("attaches a sourceHash to PPTX extraction results", async () => {
    const buffer = createPptxBuffer(["Slide content."]);
    const result = await extractDocumentText(buffer, pptxMimeType);

    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("attaches a sourceHash to DOCX extraction results", async () => {
    const buffer = createMultiParaDocxBuffer(["Specification content."]);
    const result = await extractDocumentText(buffer, docxMimeType);

    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ============================================================
// 3. Golden fixture — specification document (DOCX)
//
// DOCX is used here because the multi-paragraph builder preserves
// blank-line separators that the chunker needs for clause detection.
// ============================================================

describe("golden fixture — specification extraction (DOCX)", () => {
  it("preserves the full requirement text from a DOCX specification", async () => {
    const buffer = createMultiParaDocxBuffer(GOLDEN_SPEC_LINES);
    const result = await extractDocumentText(buffer, docxMimeType);

    const pageText = result.pages[0]?.rawText ?? "";
    expect(pageText).toContain("Drivers must be high-quality full-range units");
    expect(pageText).toContain("3.5 inches to 4 inches");
    expect(pageText).toContain("neodymium magnets");
  });

  it("detects clause 2.2.1 heading in the chunked specification", async () => {
    const buffer = createMultiParaDocxBuffer(GOLDEN_SPEC_LINES);
    const result = await extractDocumentText(buffer, docxMimeType);
    const pages = result.pages.map((p) => ({ ...p, documentId: "golden-spec" }));
    const chunks = chunkPages(pages);

    const clauseNumbers = chunks.map((c) => c.clauseNumber).filter(Boolean);
    expect(clauseNumbers).toContain("2.2.1");
  });

  it("chunks the specification so the requirement text is findable", async () => {
    const buffer = createMultiParaDocxBuffer(GOLDEN_SPEC_LINES);
    const result = await extractDocumentText(buffer, docxMimeType);
    const pages = result.pages.map((p) => ({ ...p, documentId: "golden-spec" }));
    const chunks = chunkPages(pages);

    expect(chunks.length).toBeGreaterThan(0);

    const requirementChunk = chunks.find((c) => c.rawText.includes("high-quality full-range"));
    expect(requirementChunk).toBeDefined();
    expect(requirementChunk?.pageNumber).toBe(1);
  });

  it("detects section headings from specification clause lines", () => {
    expect(inferSectionHeading("2.2 Driver Specification")).toBe("Driver Specification");
    expect(inferSectionHeading("2.2.1 Driver Units")).toBe("Driver Units");
    expect(inferSectionHeading("2. LOUDSPEAKER SYSTEM")).toBe("LOUDSPEAKER SYSTEM");
  });

  it("detects clause numbers at the paragraph level", () => {
    expect(inferClauseNumber("2.2.1 Driver Units")).toBe("2.2.1");
    expect(inferClauseNumber("2.2 Driver Specification")).toBe("2.2");
    expect(inferClauseNumber("2. LOUDSPEAKER SYSTEM")).toBe("2");
  });

  it("computes a stable sourceHash for the specification document", async () => {
    const buffer = createMultiParaDocxBuffer(GOLDEN_SPEC_LINES);
    const result = await extractDocumentText(buffer, docxMimeType);

    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ============================================================
// 4. Golden fixture — submission document (DOCX)
// ============================================================

describe("golden fixture — submission extraction (DOCX)", () => {
  it("preserves the evidence text from the submission", async () => {
    const buffer = createMultiParaDocxBuffer(GOLDEN_SUBMISSION_LINES);
    const result = await extractDocumentText(buffer, docxMimeType);

    const pageText = result.pages[0]?.rawText ?? "";
    expect(pageText).toContain("3.5-inch HQ drivers");
    expect(pageText).toContain("LAS-350HQ");
  });

  it("chunks the submission so the evidence text is findable in a single chunk", async () => {
    const buffer = createMultiParaDocxBuffer(GOLDEN_SUBMISSION_LINES);
    const result = await extractDocumentText(buffer, docxMimeType);
    const pages = result.pages.map((p) => ({ ...p, documentId: "golden-submission" }));
    const chunks = chunkPages(pages);

    const evidenceChunk = chunks.find((c) => c.rawText.includes("3.5-inch HQ drivers"));
    expect(evidenceChunk).toBeDefined();
    expect(evidenceChunk?.pageNumber).toBe(1);
  });

  it("preserves the model identifier for traceability", async () => {
    const buffer = createMultiParaDocxBuffer(GOLDEN_SUBMISSION_LINES);
    const result = await extractDocumentText(buffer, docxMimeType);
    const pages = result.pages.map((p) => ({ ...p, documentId: "golden-submission" }));
    const chunks = chunkPages(pages);

    const modelChunk = chunks.find((c) => c.rawText.includes("LAS-350HQ"));
    expect(modelChunk).toBeDefined();
  });

  it("computes a stable sourceHash for the submission document", async () => {
    const buffer = createMultiParaDocxBuffer(GOLDEN_SUBMISSION_LINES);
    const result = await extractDocumentText(buffer, docxMimeType);

    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ============================================================
// 5. Golden fixture — PPTX specification slides
// ============================================================

describe("golden fixture — PPTX specification", () => {
  it("extracts the requirement clause from a PPTX specification slide", async () => {
    const buffer = createPptxBuffer([
      "2.2.1 Driver Units",
      "Drivers must be high-quality full-range units from 3.5 inches to 4 inches with neodymium magnets."
    ]);
    const result = await extractDocumentText(buffer, pptxMimeType);

    expect(result.pageCount).toBe(2);

    const slide1Text = result.pages[0]?.rawText ?? "";
    const slide2Text = result.pages[1]?.rawText ?? "";

    expect(slide1Text).toContain("2.2.1 Driver Units");
    expect(slide2Text).toContain("high-quality full-range units");
    expect(slide2Text).toContain("neodymium magnets");
  });

  it("chunks PPTX slides and detects the clause 2.2.1 number", async () => {
    const buffer = createPptxBuffer([
      "2.2.1 Driver Units\nDrivers must be high-quality full-range units from 3.5 inches to 4 inches with neodymium magnets."
    ]);
    const result = await extractDocumentText(buffer, pptxMimeType);
    const pages = result.pages.map((p) => ({ ...p, documentId: "golden-pptx-spec" }));
    const chunks = chunkPages(pages);

    const clauseNumbers = chunks.map((c) => c.clauseNumber).filter(Boolean);
    expect(clauseNumbers).toContain("2.2.1");

    const requirementChunk = chunks.find((c) => c.rawText.includes("high-quality full-range"));
    expect(requirementChunk).toBeDefined();
  });

  it("extracts submission evidence text from a PPTX slide", async () => {
    const buffer = createPptxBuffer([
      "Technical Submission\n8 x 3.5-inch HQ drivers"
    ]);
    const result = await extractDocumentText(buffer, pptxMimeType);

    const slideText = result.pages[0]?.rawText ?? "";
    expect(slideText).toContain("3.5-inch HQ drivers");
  });
});
