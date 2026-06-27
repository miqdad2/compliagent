import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { extractDocumentText, supportsDirectTextExtraction } from "@/lib/documents/extraction";
import { createDocumentChunkRows, createDocumentPageRows } from "@/lib/documents/persistence";
import { runDocumentProcessingFromBuffer } from "@/lib/documents/processing-pipeline";

const pdfMimeType = "application/pdf";
const xlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const documentId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";

function processingInput(mimeType: string, fileName: string) {
  return {
    documentId,
    projectId,
    storagePath: `organizations/org/projects/project/documents/doc/original/${fileName}`,
    mimeType
  };
}

function createWorkbookBuffer() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Clause", "Requirement"],
    ["1.1", "The contractor shall submit certificates."]
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Requirements");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function createDocxBuffer(pageTexts: string[], reportedPageCount = pageTexts.length) {
  const body = pageTexts
    .map(
      (text, index) => `${index > 0 ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : ""}
        <w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`
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
        <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
    },
    {
      name: "docProps/app.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
          <Pages>${reportedPageCount}</Pages>
        </Properties>`
    }
  ]);
}

function createPdfBuffer(pageTexts: string[]) {
  const fontObjectId = 3 + pageTexts.length * 2;
  const objects = new Map<number, string>();
  const pageObjectIds = pageTexts.map((_, index) => 3 + index * 2);

  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(2, `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageTexts.length} >>`);
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

function escapePdfText(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function escapeXml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function createStoredZipBuffer(entries: Array<{ name: string; content: string }>) {
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

function crc32(buffer: Buffer) {
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

describe("document extraction", () => {
  it("routes native text extraction MIME types", () => {
    expect(supportsDirectTextExtraction(pdfMimeType)).toBe(true);
    expect(supportsDirectTextExtraction(docxMimeType)).toBe(true);
    expect(supportsDirectTextExtraction(xlsxMimeType)).toBe(true);
    expect(supportsDirectTextExtraction("image/png")).toBe(false);
  });

  it("extracts PDF text and preserves physical page numbers", async () => {
    const result = await extractDocumentText(
      createPdfBuffer(["1.1 First page selectable requirement text.", "2.1 Second page selectable evidence text."]),
      pdfMimeType
    );

    expect(result.pageCount).toBe(2);
    expect(result.pages.map((page) => page.pageNumber)).toEqual([1, 2]);
    expect(result.pages[0]?.rawText).toContain("First page");
    expect(result.pages[1]?.sourceLabel).toBe("Page 2");
    expect(result.ocrRequired).toBe(false);
  });

  it("marks PDF pages without sufficient selectable text for OCR", async () => {
    const result = await extractDocumentText(createPdfBuffer(["", "2.1 Selectable requirement text is available on this page."]), pdfMimeType);

    expect(result.ocrRequired).toBe(true);
    expect(result.ocrRequiredPageNumbers).toEqual([1]);
    expect(result.pages[0]?.confidence).toBe(0);
  });

  it("extracts DOCX pages separated by explicit page breaks", async () => {
    const result = await extractDocumentText(
      createDocxBuffer(["1 General Requirements", "2.1 The contractor shall submit certificates."]),
      docxMimeType
    );

    expect(result.extractionMethod).toBe("docx_text");
    expect(result.pageCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.pages[0]?.rawText).toContain("General Requirements");
    expect(result.pages[1]?.rawText).toContain("shall submit certificates");
  });

  it("does not invent DOCX page mappings when only metadata has a page count", async () => {
    const result = await extractDocumentText(createDocxBuffer(["The contractor shall submit certificates."], 15), docxMimeType);

    expect(result.pageCount).toBe(15);
    expect(result.pages).toHaveLength(1);
    expect(result.warnings.some((warning) => warning.includes("no reliable page-break markers"))).toBe(true);
  });

  it("extracts XLSX sheets with cell-address traceability", async () => {
    const result = await extractDocumentText(createWorkbookBuffer(), xlsxMimeType);

    expect(result.extractionMethod).toBe("xlsx_text");
    expect(result.pageCount).toBe(1);
    expect(result.pages[0]?.sourceLabel).toBe("Sheet: Requirements");
    expect(result.pages[0]?.rawText).toContain("A2: 1.1");
    expect(result.pages[0]?.rawText).toContain("B2: The contractor shall submit certificates.");
  });

  it("preserves extraction metadata in page and chunk database rows", async () => {
    const result = await runDocumentProcessingFromBuffer(processingInput(xlsxMimeType, "test.xlsx"), createWorkbookBuffer());
    const pageRows = createDocumentPageRows(result, projectId);
    const chunkRows = createDocumentChunkRows(result, projectId);

    expect(result.status).toBe("completed");
    expect(pageRows[0]).toMatchObject({
      document_id: documentId,
      page_number: 1,
      extraction_method: "xlsx_text",
      confidence: 0.95
    });
    expect(chunkRows[0]).toMatchObject({
      document_id: documentId,
      page_number: 1,
      chunk_text: expect.stringContaining("Sheet: Requirements"),
      normalized_text: expect.stringContaining("A2: 1.1")
    });
    expect(chunkRows[0]?.metadata).toMatchObject({ extractionMethod: "xlsx_text", sourceLabel: "Sheet: Requirements" });
  });

  it("returns a clear non-retryable error for unsupported native types", async () => {
    await expect(extractDocumentText(Buffer.from("image"), "image/png")).rejects.toMatchObject({
      code: "unsupported_file_type",
      retryable: false
    });
  });
});
