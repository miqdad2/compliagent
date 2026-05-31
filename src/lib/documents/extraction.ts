import mammoth from "mammoth";
import { inflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import type { DocumentChunk, TextPage } from "./chunking";

export type ExtractedDocumentText = {
  pages: TextPage[];
  pageCount: number;
  extractionMethod: DocumentChunk["extractionMethod"];
  ocrRequired: boolean;
  warnings: string[];
};

const pdfMimeType = "application/pdf";
const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const xlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function supportsDirectTextExtraction(mimeType: string) {
  return mimeType === pdfMimeType || mimeType === docxMimeType || mimeType === xlsxMimeType;
}

export async function extractDocumentText(buffer: Buffer, mimeType: string): Promise<ExtractedDocumentText> {
  if (mimeType === pdfMimeType) {
    return extractPdfText(buffer);
  }

  if (mimeType === docxMimeType) {
    return extractDocxText(buffer);
  }

  if (mimeType === xlsxMimeType) {
    return extractXlsxText(buffer);
  }

  throw new Error("This file type requires an OCR or presentation extraction adapter that is not enabled in Phase 1.");
}

async function extractPdfText(buffer: Buffer): Promise<ExtractedDocumentText> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    const pages = result.pages
      .map((page) => ({
        pageNumber: page.num,
        text: page.text.trim()
      }))
      .filter((page) => page.text.length > 0);

    return {
      pages,
      pageCount: result.total,
      extractionMethod: "pdf_text",
      ocrRequired: pages.length === 0 || pages.every((page) => page.text.length < 20),
      warnings: pages.length === 0 ? ["No selectable PDF text was found. OCR is required."] : []
    };
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer: Buffer): Promise<ExtractedDocumentText> {
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  const pageCount = getDocxPageCount(buffer);

  return {
    pages: text ? [{ pageNumber: 1, text }] : [],
    pageCount,
    extractionMethod: "docx_text",
    ocrRequired: false,
    warnings: result.messages.map((message) => message.message)
  };
}

function getDocxPageCount(buffer: Buffer) {
  const appXmlPageCount = readDocxAppXmlPageCount(buffer);
  const documentXmlPageCount = readDocxDocumentXmlPageCount(buffer);
  const pageCount = Math.max(appXmlPageCount ?? 0, documentXmlPageCount ?? 0);

  return pageCount > 0 ? pageCount : 1;
}

function readDocxAppXmlPageCount(buffer: Buffer) {
  const appXml = readZipEntryAsText(buffer, "docProps/app.xml");
  const pagesMatch = appXml?.match(/<(?:\w+:)?Pages>(\d+)<\/(?:\w+:)?Pages>/i);
  const pageCount = pagesMatch ? Number.parseInt(pagesMatch[1] ?? "", 10) : 0;

  return Number.isInteger(pageCount) && pageCount > 0 ? pageCount : undefined;
}

function readDocxDocumentXmlPageCount(buffer: Buffer) {
  const documentXml = readZipEntryAsText(buffer, "word/document.xml");

  if (!documentXml) {
    return undefined;
  }

  const renderedPageBreaks = documentXml.match(/<w:lastRenderedPageBreak\b/g)?.length ?? 0;
  const explicitPageBreaks = documentXml.match(/<w:br\b[^>]*w:type=["']page["'][^>]*\/?>/g)?.length ?? 0;
  const pageBreaks = Math.max(renderedPageBreaks, explicitPageBreaks);

  return pageBreaks > 0 ? pageBreaks + 1 : undefined;
}

function readZipEntryAsText(buffer: Buffer, entryName: string) {
  const entry = readZipEntry(buffer, entryName);
  return entry?.toString("utf8");
}

function readZipEntry(buffer: Buffer, entryName: string) {
  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(buffer);

  if (endOfCentralDirectoryOffset === -1) {
    return undefined;
  }

  const centralDirectorySize = buffer.readUInt32LE(endOfCentralDirectoryOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endOfCentralDirectoryOffset + 16);
  let offset = centralDirectoryOffset;
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  while (offset < centralDirectoryEnd && buffer.readUInt32LE(offset) === 0x02014b50) {
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    if (fileName === entryName && (flags & 1) === 0) {
      const localFileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraFieldLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraFieldLength;
      const compressedData = buffer.subarray(dataOffset, dataOffset + compressedSize);

      if (compressionMethod === 0) {
        return compressedData;
      }

      if (compressionMethod === 8) {
        return inflateRawSync(compressedData);
      }

      return undefined;
    }

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return undefined;
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const minimumOffset = Math.max(0, buffer.length - 0xffff - 22);

  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  return -1;
}

function extractXlsxText(buffer: Buffer): ExtractedDocumentText {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const pages = workbook.SheetNames.map((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName];
    const csv = worksheet ? XLSX.utils.sheet_to_csv(worksheet, { blankrows: false }).trim() : "";

    return {
      pageNumber: index + 1,
      text: csv ? `Sheet: ${sheetName}\n${csv}` : `Sheet: ${sheetName}`
    };
  }).filter((page) => page.text.trim().length > 0);

  return {
    pages,
    pageCount: workbook.SheetNames.length,
    extractionMethod: "xlsx_text",
    ocrRequired: false,
    warnings: []
  };
}
