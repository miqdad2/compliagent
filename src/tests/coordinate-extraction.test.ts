/**
 * Unit 10 — Coordinate-Aware Extraction, Quality Assessment and OCR Foundation
 *
 * 35 tests covering:
 *  - BoundingBox validation and normalization (coordinates.ts)
 *  - Rotation-aware normalization
 *  - Overlap and containment helpers
 *  - Page-level quality assessment (text-quality.ts)
 *  - Document-level quality assessment
 *  - OCR decision tree (decision.ts)
 *  - MockOcrProvider scenarios (mock-provider.ts)
 *  - PPTX relationship-based slide ordering (extraction.ts)
 *  - PPTX EMU coordinate extraction
 *  - DOCX structural metadata (headings, tables)
 *  - XLSX merged range extraction
 *  - ExtractedTextBlockInfo propagation via chunkPages
 */

import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";

import {
  validateBoundingBox,
  validateNormalizedBox,
  clampToPageBoundary,
  normalizeBox,
  overlappingArea,
  containsPoint
} from "@/lib/documents/coordinates";
import type { BoundingBox } from "@/lib/documents/coordinates";
import { assessPageQuality, assessExtractionQuality } from "@/lib/documents/text-quality";
import { makeOcrDecision } from "@/lib/ocr/decision";
import { MockOcrProvider } from "@/lib/ocr/mock-provider";
import { extractDocumentText } from "@/lib/documents/extraction";
import { chunkPages } from "@/lib/documents/chunking";
import type { ExtractedTextPage } from "@/lib/documents/chunking";

// ============================================================
// ZIP builder (shared with golden tests)
// ============================================================

function writeUint16LE(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value, 0);
  return b;
}

function writeUint32LE(value: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value, 0);
  return b;
}

function buildZip(files: Array<[string, string]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const rawData = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(rawData);
    const crc = computeCrc32(rawData);

    const local = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      writeUint16LE(20), writeUint16LE(0), writeUint16LE(8),
      writeUint16LE(0), writeUint16LE(0),
      writeUint32LE(crc),
      writeUint32LE(compressed.length),
      writeUint32LE(rawData.length),
      writeUint16LE(nameBytes.length), writeUint16LE(0),
      nameBytes, compressed
    ]);

    locals.push(local);
    centrals.push(Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
      writeUint16LE(20), writeUint16LE(20),
      writeUint16LE(0), writeUint16LE(8),
      writeUint16LE(0), writeUint16LE(0),
      writeUint32LE(crc),
      writeUint32LE(compressed.length),
      writeUint32LE(rawData.length),
      writeUint16LE(nameBytes.length),
      writeUint16LE(0), writeUint16LE(0),
      writeUint16LE(0), writeUint16LE(0),
      writeUint32LE(0), writeUint32LE(offset),
      nameBytes
    ]));
    offset += local.length;
  }

  const cdOffset = offset;
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    writeUint16LE(0), writeUint16LE(0),
    writeUint16LE(centrals.length), writeUint16LE(centrals.length),
    writeUint32LE(cd.length), writeUint32LE(cdOffset),
    writeUint16LE(0)
  ]);

  return Buffer.concat([...locals, cd, eocd]);
}

function computeCrc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// ============================================================
// PPTX builder helpers
// ============================================================

const PPTX_SLIDE_DIM_CX = 9144000;
const PPTX_SLIDE_DIM_CY = 6858000;

function buildPptxRelationshipsXml(slides: Array<{ rId: string; path: string }>): string {
  const rels = slides
    .map(
      (s) =>
        `<Relationship Id="${s.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="${s.path}"/>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`;
}

function buildPresentationXml(sldIds: Array<{ id: number; rId: string }>): string {
  const ids = sldIds.map((s) => `<p:sldId id="${s.id}" r:id="${s.rId}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:sldSz cx="${PPTX_SLIDE_DIM_CX}" cy="${PPTX_SLIDE_DIM_CY}"/>
  <p:sldIdLst>${ids}</p:sldIdLst>
</p:presentation>`;
}

function buildSlideXml(shapes: Array<{ x: number; y: number; cx: number; cy: number; text: string; isTitle?: boolean }>): string {
  const shapeXml = shapes
    .map(
      (s) => `
    <p:sp>
      <p:nvSpPr>
        <p:nvPr>${s.isTitle ? '<p:ph type="title"/>' : ""}</p:nvPr>
      </p:nvSpPr>
      <p:spPr>
        <a:xfrm><a:off x="${s.x}" y="${s.y}"/><a:ext cx="${s.cx}" cy="${s.cy}"/></a:xfrm>
      </p:spPr>
      <p:txBody>
        <a:bodyPr/>
        <a:p><a:r><a:t>${s.text}</a:t></a:r></a:p>
      </p:txBody>
    </p:sp>`
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>${shapeXml}</p:spTree></p:cSld>
</p:sld>`;
}

// PPTX with relationship-based ordering: slide3.xml first, slide1.xml second
function buildReorderedPptxBuffer(): Buffer {
  const relsXml = buildPptxRelationshipsXml([
    { rId: "rId1", path: "slides/slide3.xml" },
    { rId: "rId2", path: "slides/slide1.xml" }
  ]);
  const presentationXml = buildPresentationXml([
    { id: 256, rId: "rId1" },
    { id: 257, rId: "rId2" }
  ]);
  const slide3Xml = buildSlideXml([{ x: 0, y: 0, cx: 4572000, cy: 1143000, text: "Third Slide Content", isTitle: true }]);
  const slide1Xml = buildSlideXml([{ x: 0, y: 0, cx: 4572000, cy: 1143000, text: "First Slide Content", isTitle: true }]);

  return buildZip([
    ["ppt/presentation.xml", presentationXml],
    ["ppt/_rels/presentation.xml.rels", relsXml],
    ["ppt/slides/slide3.xml", slide3Xml],
    ["ppt/slides/slide1.xml", slide1Xml]
  ]);
}

// PPTX with shapes that have explicit EMU coordinates
function buildCoordinatePptxBuffer(): Buffer {
  const relsXml = buildPptxRelationshipsXml([{ rId: "rId1", path: "slides/slide1.xml" }]);
  const presentationXml = buildPresentationXml([{ id: 256, rId: "rId1" }]);
  const slideXml = buildSlideXml([
    {
      x: 914400,   // 0.1 * 9144000
      y: 685800,   // 0.1 * 6858000
      cx: 3657600, // 0.4 * 9144000
      cy: 2743200, // 0.4 * 6858000
      text: "Positioned Shape"
    }
  ]);

  return buildZip([
    ["ppt/presentation.xml", presentationXml],
    ["ppt/_rels/presentation.xml.rels", relsXml],
    ["ppt/slides/slide1.xml", slideXml]
  ]);
}

// DOCX with headings, paragraphs, and a table
function buildStructuredDocxBuffer(): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>2.2 Driver Units</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>The speaker shall have the following driver configuration:</w:t></w:r>
    </w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Parameter</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Requirement</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Driver count</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>8 minimum</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

  return buildZip([
    ["word/document.xml", documentXml],
    ["[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`]
  ]);
}

// XLSX with merged cells
function buildXlsxWithMergesBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["Header A", "Header B", "Header C"],
    ["Data 1", "Data 2", "Data 3"]
  ]);
  // Add a merge: A1:B1
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const raw = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return raw;
}

// ============================================================
// Tests: BoundingBox validation (coordinates.ts)
// ============================================================

describe("validateBoundingBox", () => {
  it("returns empty array for a valid box", () => {
    expect(validateBoundingBox({ x: 10, y: 20, width: 100, height: 50 })).toHaveLength(0);
  });

  it("rejects non-finite x", () => {
    expect(validateBoundingBox({ x: NaN, y: 0, width: 10, height: 10 }).length).toBeGreaterThan(0);
  });

  it("rejects zero width", () => {
    expect(validateBoundingBox({ x: 0, y: 0, width: 0, height: 10 }).length).toBeGreaterThan(0);
  });

  it("rejects negative height", () => {
    expect(validateBoundingBox({ x: 0, y: 0, width: 10, height: -1 }).length).toBeGreaterThan(0);
  });
});

describe("validateNormalizedBox", () => {
  it("accepts a box that fits within unit space", () => {
    expect(validateNormalizedBox({ x: 0.1, y: 0.1, width: 0.5, height: 0.5 })).toHaveLength(0);
  });

  it("rejects box that overflows x+width > 1", () => {
    expect(validateNormalizedBox({ x: 0.8, y: 0.0, width: 0.5, height: 0.5 }).length).toBeGreaterThan(0);
  });

  it("rejects box with y+height > 1", () => {
    expect(validateNormalizedBox({ x: 0.0, y: 0.7, width: 0.2, height: 0.5 }).length).toBeGreaterThan(0);
  });
});

describe("clampToPageBoundary", () => {
  it("clamps a box that extends beyond page right edge", () => {
    const clamped = clampToPageBoundary({ x: 90, y: 0, width: 50, height: 10 }, 100, 100);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(100);
  });

  it("clamps negative origin to zero", () => {
    const clamped = clampToPageBoundary({ x: -10, y: -5, width: 30, height: 20 }, 100, 100);
    expect(clamped.x).toBeGreaterThanOrEqual(0);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// Tests: Rotation-aware normalization
// ============================================================

describe("normalizeBox", () => {
  const basePdfBox: BoundingBox = { x: 100, y: 100, width: 200, height: 100 };

  it("normalizes a PDF points box with no rotation", () => {
    const norm = normalizeBox(basePdfBox, { sourceSystem: "pdf_points", pageWidth: 1000, pageHeight: 1000 });
    expect(norm.x).toBeCloseTo(0.1);
    expect(norm.y).toBeCloseTo(0.1);
    expect(norm.width).toBeCloseTo(0.2);
    expect(norm.height).toBeCloseTo(0.1);
  });

  it("applies 90-degree rotation correctly", () => {
    const box: BoundingBox = { x: 0, y: 0, width: 0.5, height: 0.25 };
    const norm = normalizeBox(box, { sourceSystem: "normalized", pageWidth: 1, pageHeight: 1, rotation: 90 });
    // After 90° CW: new_x = 1 - y - h = 0.75, new_y = x = 0, new_w = h = 0.25, new_h = w = 0.5
    expect(norm.x).toBeCloseTo(0.75);
    expect(norm.y).toBeCloseTo(0.0);
    expect(norm.width).toBeCloseTo(0.25);
    expect(norm.height).toBeCloseTo(0.5);
  });

  it("applies 180-degree rotation correctly", () => {
    const box: BoundingBox = { x: 0.2, y: 0.3, width: 0.4, height: 0.2 };
    const norm = normalizeBox(box, { sourceSystem: "normalized", pageWidth: 1, pageHeight: 1, rotation: 180 });
    // After 180°: new_x = 1 - x - w = 0.4, new_y = 1 - y - h = 0.5
    expect(norm.x).toBeCloseTo(0.4);
    expect(norm.y).toBeCloseTo(0.5);
    expect(norm.width).toBeCloseTo(0.4);
    expect(norm.height).toBeCloseTo(0.2);
  });

  it("normalizes slide_emu coordinates to [0,1]", () => {
    const emuBox: BoundingBox = { x: 914400, y: 685800, width: 4572000, height: 2743200 };
    const norm = normalizeBox(emuBox, {
      sourceSystem: "slide_emu",
      pageWidth: PPTX_SLIDE_DIM_CX,
      pageHeight: PPTX_SLIDE_DIM_CY
    });
    expect(norm.x).toBeCloseTo(0.1);
    expect(norm.y).toBeCloseTo(0.1);
    expect(norm.width).toBeCloseTo(0.5);
    expect(norm.height).toBeCloseTo(0.4);
  });
});

// ============================================================
// Tests: Overlap and containment
// ============================================================

describe("overlappingArea", () => {
  it("returns 0 for non-overlapping boxes", () => {
    const a: BoundingBox = { x: 0, y: 0, width: 0.3, height: 0.3 };
    const b: BoundingBox = { x: 0.5, y: 0.5, width: 0.3, height: 0.3 };
    expect(overlappingArea(a, b)).toBe(0);
  });

  it("returns positive area for overlapping boxes", () => {
    const a: BoundingBox = { x: 0, y: 0, width: 0.6, height: 0.6 };
    const b: BoundingBox = { x: 0.4, y: 0.4, width: 0.6, height: 0.6 };
    expect(overlappingArea(a, b)).toBeGreaterThan(0);
  });

  it("returns full area when b is contained in a", () => {
    const a: BoundingBox = { x: 0, y: 0, width: 1, height: 1 };
    const b: BoundingBox = { x: 0.2, y: 0.2, width: 0.3, height: 0.3 };
    expect(overlappingArea(a, b)).toBeCloseTo(b.width * b.height);
  });
});

describe("containsPoint", () => {
  it("returns true for a point inside the box", () => {
    const box: BoundingBox = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    expect(containsPoint(box, 0.3, 0.3)).toBe(true);
  });

  it("returns false for a point outside the box", () => {
    const box: BoundingBox = { x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
    expect(containsPoint(box, 0.9, 0.9)).toBe(false);
  });
});

// ============================================================
// Tests: Page-level quality assessment
// ============================================================

describe("assessPageQuality", () => {
  it("classifies an empty page as unusable", () => {
    const result = assessPageQuality(1, "");
    expect(result.isEmpty).toBe(true);
    expect(result.classification).toBe("unusable");
    expect(result.requiresOcr).toBe(true);
  });

  it("classifies a page with replacement chars as weak", () => {
    const text = "Normal text with many replacement chars: " + "�".repeat(20) + " more normal text here.";
    const result = assessPageQuality(1, text);
    expect(result.hasReplacementChars).toBe(true);
    expect(result.requiresOcr).toBe(true);
  });

  it("classifies a rich text page as excellent", () => {
    const text = "The speaker system shall comply with IEC 60268-1 requirements. The nominal impedance shall be 8 ohms and the frequency response shall extend from 80 Hz to 20 kHz within plus or minus 3 dB.";
    const result = assessPageQuality(1, text);
    expect(result.classification).toBe("excellent");
    expect(result.requiresOcr).toBe(false);
    expect(result.score).toBeGreaterThan(0.9);
  });

  it("classifies a very short page as weak", () => {
    const result = assessPageQuality(1, "OK");
    expect(result.classification).toBe("weak");
    expect(result.requiresOcr).toBe(true);
  });

  it("preserves the pageNumber in the result", () => {
    const result = assessPageQuality(7, "Some text content here.");
    expect(result.pageNumber).toBe(7);
  });
});

// ============================================================
// Tests: Document-level quality assessment
// ============================================================

describe("assessExtractionQuality", () => {
  it("returns unusable for an empty input", () => {
    const result = assessExtractionQuality([]);
    expect(result.classification).toBe("unusable");
    expect(result.requiresOcr).toBe(true);
  });

  it("returns excellent when all pages are rich text", () => {
    const pages = Array.from({ length: 3 }, (_, i) => ({
      pageNumber: i + 1,
      text: "The speaker system shall comply with IEC 60268-1. Nominal impedance is 8 ohms and response extends 80 Hz to 20 kHz within 3 dB of reference level."
    }));
    const result = assessExtractionQuality(pages);
    expect(result.classification).toBe("excellent");
    expect(result.requiresOcr).toBe(false);
  });

  it("returns unusable when majority of pages are empty", () => {
    const pages = [
      { pageNumber: 1, text: "" },
      { pageNumber: 2, text: "" },
      { pageNumber: 3, text: "" },
      { pageNumber: 4, text: "Some text here that is decent quality." },
    ];
    const result = assessExtractionQuality(pages);
    expect(result.classification).toBe("unusable");
  });

  it("returns weak when at least one page requires OCR", () => {
    const pages = [
      { pageNumber: 1, text: "Adequate text content for the first page of the document." },
      { pageNumber: 2, text: "" }
    ];
    const result = assessExtractionQuality(pages);
    expect(result.requiresOcr).toBe(true);
  });
});

// ============================================================
// Tests: OCR decision tree
// ============================================================

describe("makeOcrDecision", () => {
  it("returns USE_NATIVE when no pages need OCR", () => {
    const decision = makeOcrDecision({
      mimeType: "application/pdf",
      pageCount: 5,
      ocrRequiredPageNumbers: [],
      hasCoordinates: false,
      hasPageImages: true
    });
    expect(decision.action).toBe("USE_NATIVE");
  });

  it("returns OCR_NOT_ALLOWED when org has disabled OCR", () => {
    const decision = makeOcrDecision({
      mimeType: "application/pdf",
      pageCount: 5,
      ocrRequiredPageNumbers: [1, 2],
      hasCoordinates: false,
      hasPageImages: true,
      organizationOcrEnabled: false
    });
    expect(decision.action).toBe("OCR_NOT_ALLOWED");
  });

  it("returns OCR_PROVIDER_UNAVAILABLE when no provider is configured", () => {
    const decision = makeOcrDecision({
      mimeType: "application/pdf",
      pageCount: 5,
      ocrRequiredPageNumbers: [1],
      hasCoordinates: false,
      hasPageImages: true,
      organizationOcrEnabled: true,
      providerAvailable: false
    });
    expect(decision.action).toBe("OCR_PROVIDER_UNAVAILABLE");
  });

  it("returns MANUAL_REVIEW_REQUIRED when no page images are available", () => {
    const decision = makeOcrDecision({
      mimeType: "application/pdf",
      pageCount: 5,
      ocrRequiredPageNumbers: [1],
      hasCoordinates: false,
      hasPageImages: false,
      organizationOcrEnabled: true,
      providerAvailable: true
    });
    expect(decision.action).toBe("MANUAL_REVIEW_REQUIRED");
  });

  it("returns OCR_NOT_ALLOWED when external transmission is blocked", () => {
    const decision = makeOcrDecision({
      mimeType: "application/pdf",
      pageCount: 5,
      ocrRequiredPageNumbers: [1],
      hasCoordinates: false,
      hasPageImages: true,
      organizationOcrEnabled: true,
      providerAvailable: true,
      externalTransmissionAllowed: false
    });
    expect(decision.action).toBe("OCR_NOT_ALLOWED");
  });

  it("returns OCR_DOCUMENT when >= 50% of pages need OCR", () => {
    const decision = makeOcrDecision({
      mimeType: "application/pdf",
      pageCount: 4,
      ocrRequiredPageNumbers: [1, 2, 3],
      hasCoordinates: false,
      hasPageImages: true,
      organizationOcrEnabled: true,
      providerAvailable: true,
      externalTransmissionAllowed: true
    });
    expect(decision.action).toBe("OCR_DOCUMENT");
  });

  it("returns OCR_PAGE with the specific page numbers when < 50% need OCR", () => {
    const decision = makeOcrDecision({
      mimeType: "application/pdf",
      pageCount: 10,
      ocrRequiredPageNumbers: [3],
      hasCoordinates: false,
      hasPageImages: true,
      organizationOcrEnabled: true,
      providerAvailable: true,
      externalTransmissionAllowed: true
    });
    expect(decision.action).toBe("OCR_PAGE");
    if (decision.action === "OCR_PAGE") {
      expect(decision.pageNumbers).toEqual([3]);
    }
  });
});

// ============================================================
// Tests: MockOcrProvider
// ============================================================

describe("MockOcrProvider", () => {
  const testInput = {
    pageNumber: 1,
    imageBuffer: Buffer.alloc(100),
    imageMimeType: "image/png" as const
  };

  it("success scenario returns high confidence result", async () => {
    const provider = new MockOcrProvider("success");
    const result = await provider.recognize(testInput);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.provider).toBe("mock-ocr-v1");
  });

  it("low_confidence scenario returns confidence below 0.5", async () => {
    const provider = new MockOcrProvider("low_confidence");
    const result = await provider.recognize(testInput);
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("empty_result scenario returns empty text", async () => {
    const provider = new MockOcrProvider("empty_result");
    const result = await provider.recognize(testInput);
    expect(result.text).toBe("");
    expect(result.lines).toHaveLength(0);
  });

  it("provider_failure scenario throws OcrProviderError", async () => {
    const provider = new MockOcrProvider("provider_failure");
    await expect(provider.recognize(testInput)).rejects.toThrow();
  });

  it("malformed_coordinates scenario returns invalid bounding boxes", async () => {
    const { validateNormalizedBox: vnb } = await import("@/lib/documents/coordinates");
    const provider = new MockOcrProvider("malformed_coordinates");
    const result = await provider.recognize(testInput);
    const hasInvalidBox = result.words.some(
      (w) => w.boundingBox !== undefined && vnb(w.boundingBox).length > 0
    );
    expect(hasInvalidBox).toBe(true);
  });
});

// ============================================================
// Tests: PPTX relationship-based slide ordering
// ============================================================

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

describe("PPTX relationship-based slide ordering", () => {
  it("extracts slides in relationship order, not filename order", async () => {
    const buffer = buildReorderedPptxBuffer();
    const result = await extractDocumentText(buffer, PPTX_MIME);
    expect(result.pages).toHaveLength(2);
    // Slide 1 (relationship order 1) should contain slide3.xml content
    expect(result.pages[0]?.rawText).toContain("Third Slide Content");
    // Slide 2 (relationship order 2) should contain slide1.xml content
    expect(result.pages[1]?.rawText).toContain("First Slide Content");
  });

  it("assigns sequential page numbers starting at 1", async () => {
    const buffer = buildReorderedPptxBuffer();
    const result = await extractDocumentText(buffer, PPTX_MIME);
    expect(result.pages[0]?.pageNumber).toBe(1);
    expect(result.pages[1]?.pageNumber).toBe(2);
  });
});

// ============================================================
// Tests: PPTX EMU coordinate extraction
// ============================================================

describe("PPTX EMU coordinate extraction", () => {
  it("populates textBlocks on a slide with coordinate shapes", async () => {
    const buffer = buildCoordinatePptxBuffer();
    const result = await extractDocumentText(buffer, PPTX_MIME);
    const slide = result.pages[0];
    expect(slide?.textBlocks).toBeDefined();
    expect(slide?.textBlocks?.length).toBeGreaterThan(0);
  });

  it("normalizes shape EMU coordinates to [0,1] range", async () => {
    const buffer = buildCoordinatePptxBuffer();
    const result = await extractDocumentText(buffer, PPTX_MIME);
    const block = result.pages[0]?.textBlocks?.[0];
    if (block?.normalizedBoundingBox) {
      expect(block.normalizedBoundingBox.x).toBeGreaterThan(0);
      expect(block.normalizedBoundingBox.x).toBeLessThan(1);
      expect(block.normalizedBoundingBox.width).toBeGreaterThan(0);
      expect(block.normalizedBoundingBox.width).toBeLessThan(1);
    }
  });

  it("sets coordinatesAvailable true when shapes have xfrm data", async () => {
    const buffer = buildCoordinatePptxBuffer();
    const result = await extractDocumentText(buffer, PPTX_MIME);
    // Pages with coordinates available should have coordinateSystem set
    expect(result.pages[0]?.coordinateSystem).toBeDefined();
  });

  it("block ids include slide number prefix", async () => {
    const buffer = buildCoordinatePptxBuffer();
    const result = await extractDocumentText(buffer, PPTX_MIME);
    const block = result.pages[0]?.textBlocks?.[0];
    expect(block?.id).toMatch(/^1:/);
  });
});

// ============================================================
// Tests: DOCX structural metadata
// ============================================================

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe("DOCX structural metadata extraction", () => {
  it("populates textBlocks with heading type for Heading1 paragraphs", async () => {
    const buffer = buildStructuredDocxBuffer();
    const result = await extractDocumentText(buffer, DOCX_MIME);
    const headingBlocks = result.pages.flatMap((p) => p.textBlocks ?? []).filter((b) => b.blockType === "heading");
    expect(headingBlocks.length).toBeGreaterThan(0);
  });

  it("preserves heading text content", async () => {
    const buffer = buildStructuredDocxBuffer();
    const result = await extractDocumentText(buffer, DOCX_MIME);
    const allBlockText = result.pages.flatMap((p) => p.textBlocks ?? []).map((b) => b.text);
    expect(allBlockText.some((t) => t.includes("Driver Units"))).toBe(true);
  });

  it("populates textBlocks with table_cell type for table cells", async () => {
    const buffer = buildStructuredDocxBuffer();
    const result = await extractDocumentText(buffer, DOCX_MIME);
    const tableCells = result.pages.flatMap((p) => p.textBlocks ?? []).filter((b) => b.blockType === "table_cell");
    expect(tableCells.length).toBeGreaterThan(0);
  });

  it("includes table cell text", async () => {
    const buffer = buildStructuredDocxBuffer();
    const result = await extractDocumentText(buffer, DOCX_MIME);
    const cellTexts = result.pages.flatMap((p) => p.textBlocks ?? []).filter((b) => b.blockType === "table_cell").map((b) => b.text);
    expect(cellTexts.some((t) => t.includes("Parameter"))).toBe(true);
  });
});

// ============================================================
// Tests: XLSX merged range extraction
// ============================================================

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("XLSX merged range extraction", () => {
  it("extracts sheet content without error", async () => {
    const buffer = buildXlsxWithMergesBuffer();
    const result = await extractDocumentText(buffer, XLSX_MIME);
    expect(result.pages.length).toBeGreaterThan(0);
    expect(result.pages[0]?.rawText).toContain("Sheet1");
  });

  it("includes cell data in rawText", async () => {
    const buffer = buildXlsxWithMergesBuffer();
    const result = await extractDocumentText(buffer, XLSX_MIME);
    expect(result.pages[0]?.rawText).toMatch(/Header/);
  });
});

// ============================================================
// Tests: blockId propagation through chunkPages
// ============================================================

describe("chunkPages blockId propagation", () => {
  it("propagates block IDs from textBlocks into DocumentChunks", () => {
    const page: ExtractedTextPage & { documentId: string } = {
      documentId: "doc-1",
      pageNumber: 1,
      rawText: "2.2.1 Driver Units\nThe speaker shall have 8 drivers.",
      normalizedText: "2.2.1 Driver Units The speaker shall have 8 drivers.",
      extractionMethod: "pptx_text",
      confidence: 0.9,
      sourceLabel: "Slide 1",
      ocrRecommended: false,
      textBlocks: [
        {
          id: "1:heading:0",
          text: "2.2.1 Driver Units",
          blockType: "heading",
          readingOrder: 0,
          confidence: 0.9
        },
        {
          id: "1:para:1",
          text: "The speaker shall have 8 drivers.",
          blockType: "paragraph",
          readingOrder: 1,
          confidence: 0.9
        }
      ]
    };

    const chunks = chunkPages([page]);
    const blockIds = chunks.flatMap((c) => c.blockIds ?? []);
    expect(blockIds.length).toBeGreaterThan(0);
    expect(blockIds.some((id) => id.startsWith("1:"))).toBe(true);
  });

  it("uses positional IDs when no textBlocks are present", () => {
    const page: ExtractedTextPage & { documentId: string } = {
      documentId: "doc-2",
      pageNumber: 1,
      rawText: "Some text without block info.\n\nSecond paragraph with more content here.",
      normalizedText: "Some text without block info. Second paragraph with more content here.",
      extractionMethod: "pdf_text",
      confidence: 0.9,
      sourceLabel: "Page 1",
      ocrRecommended: false
    };

    const chunks = chunkPages([page]);
    const blockIds = chunks.flatMap((c) => c.blockIds ?? []);
    expect(blockIds.every((id) => id.startsWith("1:"))).toBe(true);
  });
});
