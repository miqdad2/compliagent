import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { extractDocumentText, supportsDirectTextExtraction } from "@/lib/documents/extraction";
import { runDocumentProcessingFromBuffer } from "@/lib/documents/processing-pipeline";

const xlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function createWorkbookBuffer() {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["Clause", "Requirement"],
    ["1.1", "The contractor shall submit certificates."]
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Requirements");

  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function createDocxBuffer(pageCount: number) {
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
          <w:body>
            <w:p>
              <w:r><w:t>The contractor shall submit certificates.</w:t></w:r>
            </w:p>
          </w:body>
        </w:document>`
    },
    {
      name: "docProps/app.xml",
      content: `<?xml version="1.0" encoding="UTF-8"?>
        <Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
          <Pages>${pageCount}</Pages>
        </Properties>`
    }
  ]);
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
  it("routes Phase 1 text extraction MIME types", () => {
    expect(supportsDirectTextExtraction("application/pdf")).toBe(true);
    expect(supportsDirectTextExtraction(xlsxMimeType)).toBe(true);
    expect(supportsDirectTextExtraction("image/png")).toBe(false);
  });

  it("extracts spreadsheet sheets as source pages", async () => {
    const result = await extractDocumentText(createWorkbookBuffer(), xlsxMimeType);

    expect(result.extractionMethod).toBe("xlsx_text");
    expect(result.pageCount).toBe(1);
    expect(result.pages[0]?.pageNumber).toBe(1);
    expect(result.pages[0]?.text).toContain("Sheet: Requirements");
    expect(result.pages[0]?.text).toContain("shall submit certificates");
  });

  it("reads saved DOCX page count from extended document properties", async () => {
    const result = await extractDocumentText(createDocxBuffer(15), docxMimeType);

    expect(result.extractionMethod).toBe("docx_text");
    expect(result.pageCount).toBe(15);
    expect(result.pages[0]?.pageNumber).toBe(1);
    expect(result.pages[0]?.text).toContain("shall submit certificates");
  });

  it("chunks extracted spreadsheet text for persistence", async () => {
    const result = await runDocumentProcessingFromBuffer(
      {
        documentId: "11111111-1111-4111-8111-111111111111",
        projectId: "22222222-2222-4222-8222-222222222222",
        storagePath: "organizations/org/projects/project/documents/doc/original/test.xlsx",
        mimeType: xlsxMimeType
      },
      createWorkbookBuffer()
    );

    expect(result.status).toBe("completed");
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]?.extractionMethod).toBe("xlsx_text");
  });
});
