import { createHash } from "node:crypto";
import mammoth from "mammoth";
import { inflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import type { ExtractedTextPage, ExtractionMethod, ExtractedTextBlockInfo } from "./chunking";
import { inferClauseNumber, inferSectionHeading } from "./chunking";
import { DocumentExtractionError, normalizeExtractionError } from "./extraction-errors";
import { assessNativeTextQuality } from "./text-quality";
import type { ExtractedTable } from "./layout-types";
import { normalizeBox } from "./coordinates";

export type ExtractedDocumentText = {
  pages: ExtractedTextPage[];
  pageCount: number;
  extractionMethod: ExtractionMethod;
  ocrRequired: boolean;
  ocrRequiredPageNumbers: number[];
  warnings: string[];
  sourceHash: string;
};

/** Internal result shape before the sourceHash is attached. */
type ExtractedDocumentTextCore = Omit<ExtractedDocumentText, "sourceHash">;

const pdfMimeType = "application/pdf";
const docxMimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const xlsxMimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const pptxMimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const maximumSpreadsheetCells = 100_000;

export function supportsDirectTextExtraction(mimeType: string) {
  return (
    mimeType === pdfMimeType ||
    mimeType === docxMimeType ||
    mimeType === xlsxMimeType ||
    mimeType === pptxMimeType
  );
}

export async function extractDocumentText(buffer: Buffer, mimeType: string): Promise<ExtractedDocumentText> {
  const sourceHash = createHash("sha256").update(buffer).digest("hex");
  try {
    let core: ExtractedDocumentTextCore;

    if (mimeType === pdfMimeType) {
      core = await extractPdfText(buffer);
    } else if (mimeType === docxMimeType) {
      core = await extractDocxText(buffer);
    } else if (mimeType === xlsxMimeType) {
      core = extractXlsxText(buffer);
    } else if (mimeType === pptxMimeType) {
      core = extractPptxText(buffer);
    } else {
      throw new DocumentExtractionError({
        code: "unsupported_file_type",
        message: "Native extraction supports PDF, DOCX, XLSX, and PPTX files only.",
        retryable: false
      });
    }

    return { ...core, sourceHash };
  } catch (error) {
    throw normalizeExtractionError(error);
  }
}

// ============================================================
// PDF extractor
// ============================================================

async function extractPdfText(buffer: Buffer): Promise<ExtractedDocumentTextCore> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    const pagesByNumber = new Map(result.pages.map((page) => [page.num, page.text.trim()]));
    const pages = Array.from({ length: result.total }, (_, index) => {
      const pageNumber = index + 1;
      const rawText = pagesByNumber.get(pageNumber) ?? "";
      // PDF text blocks require pdfjs-direct; coordinates unavailable with pdf-parse.
      // textBlocks is not populated here — callers see coordinateSystem: "pdf_points"
      // and coordinatesAvailable: false on the page record.
      return createExtractedPage(pageNumber, rawText, "pdf_text", `Page ${pageNumber}`, undefined, {
        coordinateSystem: "pdf_points",
        coordinatesAvailable: false
      });
    });

    return finalizeExtraction(pages, result.total, "pdf_text");
  } finally {
    await parser.destroy();
  }
}

// ============================================================
// DOCX extractor — now includes heading levels and table structure
// ============================================================

async function extractDocxText(buffer: Buffer): Promise<ExtractedDocumentTextCore> {
  const result = await mammoth.extractRawText({ buffer });
  const documentXml = readZipEntryAsText(buffer, "word/document.xml");
  const mappedPages = documentXml ? extractDocxPagesFromXml(documentXml) : [];
  const hasExplicitPageMapping = mappedPages.length > 1;
  const pageTexts = hasExplicitPageMapping ? mappedPages : [result.value.trim()];
  const pageCount = getDocxPageCount(buffer);

  // Extract structural blocks (headings, paragraphs, tables) from XML
  const structureBlocks = documentXml ? extractDocxStructureBlocks(documentXml) : [];
  const tables = documentXml ? extractDocxTables(documentXml) : [];

  const pages = pageTexts.map((text, index) => {
    const pageNumber = index + 1;
    const pageBlocks = hasExplicitPageMapping
      ? structureBlocks.filter((b) => b.pageNumber === pageNumber)
      : structureBlocks.map((b) => ({ ...b, pageNumber }));
    return createExtractedPage(
      pageNumber,
      text,
      "docx_text",
      `Page ${pageNumber}`,
      pageBlocks.length > 0 ? pageBlocks : undefined,
      {
        coordinateSystem: "unknown",
        coordinatesAvailable: false,
        tables: tables.length > 0 && pageNumber === 1 ? tables : undefined
      }
    );
  });

  const warnings = result.messages.map((message) => message.message);

  if (!hasExplicitPageMapping && pageCount > 1) {
    warnings.push(
      `The DOCX reports ${pageCount} pages but contains no reliable page-break markers. Text is preserved as logical page 1 until a rendering adapter is available.`
    );
  }

  return finalizeExtraction(pages, pageCount, "docx_text", warnings);
}

// ============================================================
// XLSX extractor — now includes merged ranges
// ============================================================

function extractXlsxText(buffer: Buffer): ExtractedDocumentTextCore {
  const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellText: true });
  if (workbook.SheetNames.length === 0) {
    throw new DocumentExtractionError({
      code: "invalid_file",
      message: "The spreadsheet does not contain any worksheets.",
      retryable: false
    });
  }

  const pages = workbook.SheetNames.map((sheetName, index) => {
    const worksheet = workbook.Sheets[sheetName];
    const { cellText, mergedRanges } = worksheet ? extractWorksheetData(worksheet) : { cellText: "", mergedRanges: [] };
    const rawText = cellText ? `Sheet: ${sheetName}\n${cellText}` : `Sheet: ${sheetName}`;
    const blocks = buildXlsxTextBlocks(worksheet, sheetName, index + 1);
    const extraMeta: PageLayoutMeta = {
      coordinateSystem: "sheet_cells",
      coordinatesAvailable: true,
      mergedRanges
    };
    return createExtractedPage(index + 1, rawText, "xlsx_text", `Sheet: ${sheetName}`, blocks, extraMeta, cellText);
  });

  return finalizeExtraction(pages, workbook.SheetNames.length, "xlsx_text");
}

function extractWorksheetData(worksheet: XLSX.WorkSheet): { cellText: string; mergedRanges: string[] } {
  const cells = Object.keys(worksheet)
    .filter((address) => !address.startsWith("!"))
    .map((address) => ({ address, position: XLSX.utils.decode_cell(address), cell: worksheet[address] }))
    .filter((entry): entry is { address: string; position: XLSX.CellAddress; cell: XLSX.CellObject } => Boolean(entry.cell))
    .sort((left, right) => left.position.r - right.position.r || left.position.c - right.position.c);

  if (cells.length > maximumSpreadsheetCells) {
    throw new DocumentExtractionError({
      code: "invalid_file",
      message: `The spreadsheet contains more than ${maximumSpreadsheetCells.toLocaleString()} populated cells and cannot be processed safely.`,
      retryable: false
    });
  }

  const rows = new Map<number, string[]>();
  for (const { address, position, cell } of cells) {
    const value = XLSX.utils.format_cell(cell).trim();
    if (!value) continue;
    const row = rows.get(position.r) ?? [];
    row.push(`${address}: ${value}`);
    rows.set(position.r, row);
  }

  const cellText = [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, values]) => values.join(" | "))
    .join("\n");

  // Merged cell ranges
  const mergedRanges: string[] = (worksheet["!merges"] ?? []).map((merge: XLSX.Range) => {
    const start = XLSX.utils.encode_cell(merge.s);
    const end = XLSX.utils.encode_cell(merge.e);
    return `${start}:${end}`;
  });

  return { cellText, mergedRanges };
}

function buildXlsxTextBlocks(
  worksheet: XLSX.WorkSheet | undefined,
  sheetName: string,
  pageNumber: number
): ExtractedTextBlockInfo[] {
  if (!worksheet) return [];
  const blocks: ExtractedTextBlockInfo[] = [];
  const cells = Object.keys(worksheet)
    .filter((address) => !address.startsWith("!"))
    .map((address) => ({ address, position: XLSX.utils.decode_cell(address), cell: worksheet[address] }))
    .filter((entry): entry is { address: string; position: XLSX.CellAddress; cell: XLSX.CellObject } => Boolean(entry.cell))
    .sort((l, r) => l.position.r - r.position.r || l.position.c - r.position.c);

  let readingOrder = 0;
  for (const { address, cell } of cells) {
    const value = XLSX.utils.format_cell(cell).trim();
    if (!value) continue;
    blocks.push({
      id: `${pageNumber}:sheet:${address}`,
      text: `${address}: ${value}`,
      blockType: "table_cell",
      readingOrder: readingOrder++,
      confidence: 0.95,
      boundingBox: undefined,
      coordinateSystem: "sheet_cells"
    });
  }
  return blocks;
}

// ============================================================
// PPTX extractor — relationship-based slide ordering + EMU coordinates
// ============================================================

function extractPptxText(buffer: Buffer): ExtractedDocumentTextCore {
  // Use relationship file to get actual ordered slide paths
  const slidePaths = getPptxSlidePathsInOrder(buffer);

  if (slidePaths.length === 0) {
    // Fall back to counting via sldId and sequential naming
    const slideCount = getPptxSlideCountFallback(buffer);
    if (slideCount === 0) {
      throw new DocumentExtractionError({
        code: "invalid_file",
        message: "The presentation does not contain any slides.",
        retryable: false
      });
    }
    return extractPptxFromSequentialPaths(buffer, slideCount);
  }

  const slideDimensions = getPptxSlideDimensions(buffer);
  const pages: ExtractedTextPage[] = [];

  for (const [index, slidePath] of slidePaths.entries()) {
    const slideNumber = index + 1;
    const slideXml = readZipEntryAsText(buffer, `ppt/${slidePath}`);
    if (!slideXml) continue;

    const { text: slideText, blocks } = extractPptxSlideBlocks(slideXml, slideNumber, slideDimensions);
    const rawText = `Slide ${slideNumber}${slideText ? `\n${slideText}` : ""}`;

    pages.push(
      createExtractedPage(
        slideNumber,
        rawText,
        "pptx_text",
        `Slide ${slideNumber}`,
        blocks.length > 0 ? blocks : undefined,
        {
          coordinateSystem: "normalized",
          coordinatesAvailable: slideDimensions !== null && blocks.some((b) => b.boundingBox !== undefined),
          pageWidth: slideDimensions?.widthEmu,
          pageHeight: slideDimensions?.heightEmu
        },
        slideText
      )
    );
  }

  if (pages.length === 0) {
    throw new DocumentExtractionError({
      code: "invalid_file",
      message: "No readable slides were found in the presentation.",
      retryable: false
    });
  }

  return finalizeExtraction(pages, slidePaths.length, "pptx_text");
}

/** Reads ppt/_rels/presentation.xml.rels and ppt/presentation.xml to get ordered slide paths. */
function getPptxSlidePathsInOrder(buffer: Buffer): string[] {
  const presentationXml = readZipEntryAsText(buffer, "ppt/presentation.xml");
  const relsXml = readZipEntryAsText(buffer, "ppt/_rels/presentation.xml.rels");

  if (!presentationXml || !relsXml) return [];

  // Map rId → relative Target path (e.g. "slides/slide1.xml")
  const rIdToTarget = new Map<string, string>();
  const relPattern = /<Relationship\b[^>]*\bId="([^"]+)"[^>]*\bType="[^"]*\/slide"[^>]*\bTarget="([^"]+)"[^>]*/g;
  for (const match of relsXml.matchAll(relPattern)) {
    const rId = match[1];
    const target = match[2];
    if (rId && target) rIdToTarget.set(rId, target);
  }

  // Extract ordered rIds from sldIdLst
  const sldIdPattern = /<p:sldId\b[^>]*\br:id="([^"]+)"[^>]*/g;
  const orderedPaths: string[] = [];
  for (const match of presentationXml.matchAll(sldIdPattern)) {
    const rId = match[1];
    if (rId) {
      const target = rIdToTarget.get(rId);
      if (target) orderedPaths.push(target);
    }
  }

  return orderedPaths;
}

/** Fallback: count slides via <p:sldId> elements (no coordinate or relationship support). */
function getPptxSlideCountFallback(buffer: Buffer): number {
  const presentationXml = readZipEntryAsText(buffer, "ppt/presentation.xml");
  if (!presentationXml) return 0;
  const matches = presentationXml.match(/<p:sldId\b/g);
  return matches?.length ?? 0;
}

/** Fallback for PPTX files without a readable relationships file. */
function extractPptxFromSequentialPaths(buffer: Buffer, slideCount: number): ExtractedDocumentTextCore {
  const pages: ExtractedTextPage[] = [];
  for (let slideNumber = 1; slideNumber <= slideCount; slideNumber++) {
    const slideXml = readZipEntryAsText(buffer, `ppt/slides/slide${slideNumber}.xml`);
    if (!slideXml) continue;
    const { text: slideText } = extractPptxSlideBlocks(slideXml, slideNumber, null);
    const rawText = `Slide ${slideNumber}${slideText ? `\n${slideText}` : ""}`;
    pages.push(createExtractedPage(slideNumber, rawText, "pptx_text", `Slide ${slideNumber}`, undefined, {
      coordinateSystem: "slide_emu",
      coordinatesAvailable: false
    }, slideText));
  }
  if (pages.length === 0) {
    throw new DocumentExtractionError({
      code: "invalid_file",
      message: "No readable slides were found in the presentation.",
      retryable: false
    });
  }
  return finalizeExtraction(pages, slideCount, "pptx_text");
}

interface PptxSlideDimensions {
  widthEmu: number;
  heightEmu: number;
}

function getPptxSlideDimensions(buffer: Buffer): PptxSlideDimensions | null {
  const presentationXml = readZipEntryAsText(buffer, "ppt/presentation.xml");
  if (!presentationXml) return null;
  const match = presentationXml.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  if (!match) return null;
  const widthEmu = parseInt(match[1] ?? "0", 10);
  const heightEmu = parseInt(match[2] ?? "0", 10);
  if (widthEmu <= 0 || heightEmu <= 0) return null;
  return { widthEmu, heightEmu };
}

interface PptxSlideExtraction {
  text: string;
  blocks: ExtractedTextBlockInfo[];
}

function extractPptxSlideBlocks(
  slideXml: string,
  slideNumber: number,
  dimensions: PptxSlideDimensions | null
): PptxSlideExtraction {
  const blocks: ExtractedTextBlockInfo[] = [];
  let readingOrder = 0;

  // Iterate over shape elements (<p:sp>) to extract text + coordinates
  const shapePattern = /<p:sp\b[\s\S]*?<\/p:sp>/g;
  for (const shapeMatch of slideXml.matchAll(shapePattern)) {
    const shapeXml = shapeMatch[0];

    // Extract shape transform (position + size in EMU)
    const xfrmMatch = shapeXml.match(/<a:xfrm\b[^>]*>[\s\S]*?<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"[\s\S]*?<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
    let boundingBox: ExtractedTextBlockInfo["boundingBox"] | undefined;
    let normalizedBoundingBox: ExtractedTextBlockInfo["normalizedBoundingBox"] | undefined;

    if (xfrmMatch && dimensions) {
      const offX = parseInt(xfrmMatch[1] ?? "0", 10);
      const offY = parseInt(xfrmMatch[2] ?? "0", 10);
      const extCx = parseInt(xfrmMatch[3] ?? "0", 10);
      const extCy = parseInt(xfrmMatch[4] ?? "0", 10);
      boundingBox = { x: offX, y: offY, width: extCx, height: extCy };
      // Convert to normalized [0,1] using slide dimensions
      const normalized = normalizeBox(
        { x: offX, y: offY, width: extCx, height: extCy },
        { sourceSystem: "slide_emu", pageWidth: dimensions.widthEmu, pageHeight: dimensions.heightEmu }
      );
      normalizedBoundingBox = normalized;
    }

    // Extract paragraph text from shape
    const paragraphs = extractPptxParagraphsFromShape(shapeXml);
    if (paragraphs.length === 0) continue;

    const blockText = paragraphs.join("\n");
    const blockType = detectPptxBlockType(shapeXml, paragraphs);

    blocks.push({
      id: `${slideNumber}:${readingOrder}`,
      text: blockText,
      blockType,
      readingOrder: readingOrder++,
      clauseNumber: inferClauseNumber(paragraphs[0] ?? "") ?? undefined,
      sectionHeading: inferSectionHeading(paragraphs[0] ?? "") ?? undefined,
      boundingBox,
      normalizedBoundingBox,
      coordinateSystem: dimensions ? "normalized" : "slide_emu",
      confidence: 0.9
    });
  }

  // If no shapes matched (unusual PPTX), fall back to raw paragraph extraction
  if (blocks.length === 0) {
    const paragraphPattern = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
    for (const paragraphMatch of slideXml.matchAll(paragraphPattern)) {
      const paragraphContent = paragraphMatch[1] ?? "";
      const textPattern = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
      let paragraphText = "";
      for (const textMatch of paragraphContent.matchAll(textPattern)) {
        paragraphText += decodeXmlText(textMatch[1] ?? "");
      }
      const trimmed = paragraphText.trim();
      if (!trimmed) continue;
      blocks.push({
        id: `${slideNumber}:${readingOrder}`,
        text: trimmed,
        blockType: "paragraph",
        readingOrder: readingOrder++,
        confidence: 0.85
      });
    }
  }

  const text = blocks.map((b) => b.text).join("\n").trim();
  return { text, blocks };
}

function extractPptxParagraphsFromShape(shapeXml: string): string[] {
  const paragraphs: string[] = [];
  const txBodyMatch = shapeXml.match(/<p:txBody\b[\s\S]*?<\/p:txBody>/);
  if (!txBodyMatch) return paragraphs;

  const txBodyXml = txBodyMatch[0];
  const paragraphPattern = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  for (const match of txBodyXml.matchAll(paragraphPattern)) {
    const paragraphContent = match[1] ?? "";
    const textPattern = /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g;
    let text = "";
    for (const textMatch of paragraphContent.matchAll(textPattern)) {
      text += decodeXmlText(textMatch[1] ?? "");
    }
    const trimmed = text.trim();
    if (trimmed) paragraphs.push(trimmed);
  }
  return paragraphs;
}

function detectPptxBlockType(shapeXml: string, paragraphs: string[]): ExtractedTextBlockInfo["blockType"] {
  // Title placeholder indicators
  if (/<p:ph\b[^>]*\btype="(?:title|ctrTitle)"/i.test(shapeXml)) return "heading";
  if (/<p:ph\b[^>]*\btype="(?:body|obj)"/i.test(shapeXml)) return "paragraph";
  // Table cells are in <a:tc> elements, handled separately
  const firstLine = paragraphs[0] ?? "";
  if (inferClauseNumber(firstLine) || inferSectionHeading(firstLine)) return "heading";
  return "paragraph";
}

// ============================================================
// DOCX structure helpers
// ============================================================

type DocxStructureBlock = ExtractedTextBlockInfo & { pageNumber: number };

function extractDocxStructureBlocks(documentXml: string): DocxStructureBlock[] {
  const blocks: DocxStructureBlock[] = [];
  let readingOrder = 0;
  let pageNumber = 1;

  // Process paragraphs and tables at the top level
  const elementPattern = /<w:p\b[\s\S]*?<\/w:p>|<w:tbl\b[\s\S]*?<\/w:tbl>|<w:lastRenderedPageBreak\b[^>]*\/?>|<w:br\b[^>]*w:type=["']page["'][^>]*\/?>/g;

  for (const match of documentXml.matchAll(elementPattern)) {
    const element = match[0];

    if (/^<w:(?:lastRenderedPageBreak|br\b[^>]*w:type=["']page)/i.test(element)) {
      pageNumber++;
      continue;
    }

    if (/^<w:tbl\b/i.test(element)) {
      // Table: mark each cell as table_cell block
      const cellPattern = /<w:tc\b[\s\S]*?<\/w:tc>/g;
      for (const cellMatch of element.matchAll(cellPattern)) {
        const cellText = extractRawTextFromXml(cellMatch[0]);
        if (cellText.trim()) {
          blocks.push({
            id: `p${pageNumber}:${readingOrder}`,
            pageNumber,
            text: cellText.trim(),
            blockType: "table_cell",
            readingOrder: readingOrder++,
            confidence: 0.9
          });
        }
      }
      continue;
    }

    // Paragraph
    const styleMatch = element.match(/<w:pStyle\b[^>]*\bw:val="([^"]+)"/i);
    const styleName = styleMatch?.[1]?.toLowerCase() ?? "";
    const headingMatch = styleName.match(/heading(\d)/);
    const headingLevel = headingMatch ? parseInt(headingMatch[1] ?? "1", 10) : undefined;

    const paraText = extractRawTextFromXml(element);
    if (!paraText.trim()) continue;

    let blockType: ExtractedTextBlockInfo["blockType"] = "paragraph";
    if (headingLevel !== undefined) blockType = "heading";
    else if (/^<w:p\b[^>]*>.*<w:pStyle\b[^>]*\bw:val="ListParagraph"/is.test(element)) blockType = "list_item";

    blocks.push({
      id: `p${pageNumber}:${readingOrder}`,
      pageNumber,
      text: paraText.trim(),
      blockType,
      headingLevel,
      readingOrder: readingOrder++,
      confidence: headingLevel !== undefined ? 0.95 : 0.9
    });
  }

  return blocks;
}

function extractDocxTables(documentXml: string): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  let tableIndex = 0;

  const tablePattern = /<w:tbl\b[\s\S]*?<\/w:tbl>/g;
  for (const tableMatch of documentXml.matchAll(tablePattern)) {
    const tableXml = tableMatch[0];
    const rows: ExtractedTable["rows"] = [];
    let rowIndex = 0;

    const rowPattern = /<w:tr\b[\s\S]*?<\/w:tr>/g;
    for (const rowMatch of tableXml.matchAll(rowPattern)) {
      const rowXml = rowMatch[0];
      const cells: ExtractedTable["rows"][number]["cells"] = [];
      let colIndex = 0;

      const cellPattern = /<w:tc\b[\s\S]*?<\/w:tc>/g;
      for (const cellMatch of rowXml.matchAll(cellPattern)) {
        const cellXml = cellMatch[0];
        const cellText = extractRawTextFromXml(cellXml).trim();
        // Check for vertical span (gridSpan for col, vMerge for row)
        const gridSpanMatch = cellXml.match(/<w:gridSpan\b[^>]*\bw:val="(\d+)"/i);
        const colSpan = gridSpanMatch ? parseInt(gridSpanMatch[1] ?? "1", 10) : 1;
        cells.push({ row: rowIndex, col: colIndex, rowSpan: 1, colSpan, text: cellText });
        colIndex += colSpan;
      }

      rows.push({ rowIndex, cells });
      rowIndex++;
    }

    tables.push({ pageNumber: 1, tableIndex: tableIndex++, rows });
  }

  return tables;
}

function extractRawTextFromXml(xml: string): string {
  let text = "";
  const tokenPattern = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<\/w:p>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>(?![^>]*w:type)/g;
  for (const match of xml.matchAll(tokenPattern)) {
    const token = match[0];
    if (/^<w:t\b/i.test(token)) {
      text += decodeXmlText(match[1] ?? "");
    } else if (/^<\/w:p/i.test(token)) {
      text += "\n";
    } else if (/^<w:tab\b/i.test(token)) {
      text += "\t";
    } else if (/^<w:br\b/i.test(token)) {
      text += "\n";
    }
  }
  return text;
}

// ============================================================
// Shared helpers
// ============================================================

interface PageLayoutMeta {
  coordinateSystem: string;
  coordinatesAvailable: boolean;
  pageWidth?: number;
  pageHeight?: number;
  tables?: ExtractedTable[];
  mergedRanges?: string[];
}

function createExtractedPage(
  pageNumber: number,
  rawText: string,
  extractionMethod: ExtractionMethod,
  sourceLabel: string,
  textBlocks?: ExtractedTextBlockInfo[],
  layoutMeta?: PageLayoutMeta,
  qualityText = rawText
): ExtractedTextPage {
  const quality = assessNativeTextQuality(qualityText);
  const page: ExtractedTextPage = {
    pageNumber,
    rawText: rawText.trim(),
    normalizedText: qualityText === rawText ? quality.normalizedText : assessNativeTextQuality(rawText).normalizedText,
    extractionMethod,
    confidence: quality.confidence,
    sourceLabel,
    ocrRecommended: !quality.sufficient
  };

  if (textBlocks !== undefined) {
    page.textBlocks = textBlocks;
  }
  if (layoutMeta) {
    if (layoutMeta.coordinateSystem) page.coordinateSystem = layoutMeta.coordinateSystem;
    if (layoutMeta.pageWidth !== undefined) page.pageWidth = layoutMeta.pageWidth;
    if (layoutMeta.pageHeight !== undefined) page.pageHeight = layoutMeta.pageHeight;
  }

  return page;
}

function finalizeExtraction(
  pages: ExtractedTextPage[],
  pageCount: number,
  extractionMethod: ExtractionMethod,
  initialWarnings: string[] = []
): ExtractedDocumentTextCore {
  const ocrRequiredPageNumbers = pages.filter((page) => page.ocrRecommended).map((page) => page.pageNumber);
  const warnings = [...initialWarnings];

  if (pages.length === 0) {
    warnings.push("Native extraction did not return any source pages. OCR is required.");
  }

  if (ocrRequiredPageNumbers.length > 0) {
    warnings.push(
      `Native text was insufficient on ${formatSourceList(
        pages.filter((page) => page.ocrRecommended).map((page) => page.sourceLabel)
      )}. OCR is required for complete extraction.`
    );
  }

  return {
    pages,
    pageCount,
    extractionMethod,
    ocrRequired: pages.length === 0 || ocrRequiredPageNumbers.length > 0,
    ocrRequiredPageNumbers,
    warnings
  };
}

function formatSourceList(labels: string[]) {
  if (labels.length <= 3) {
    return labels.join(", ");
  }
  return `${labels.slice(0, 3).join(", ")} and ${labels.length - 3} more`;
}

// ============================================================
// DOCX helpers
// ============================================================

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
  if (!documentXml) return undefined;
  const renderedPageBreaks = documentXml.match(/<w:lastRenderedPageBreak\b/g)?.length ?? 0;
  const explicitPageBreaks = documentXml.match(/<w:br\b[^>]*w:type=["']page["'][^>]*\/?>/g)?.length ?? 0;
  const pageBreaks = Math.max(renderedPageBreaks, explicitPageBreaks);
  return pageBreaks > 0 ? pageBreaks + 1 : undefined;
}

function extractDocxPagesFromXml(documentXml: string) {
  const pages: string[] = [];
  let currentPage = "";
  const tokenPattern =
    /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:lastRenderedPageBreak\b[^>]*\/?>|<w:br\b[^>]*w:type=["']page["'][^>]*\/?>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>|<\/w:p>/gi;

  for (const match of documentXml.matchAll(tokenPattern)) {
    const token = match[0];
    if (/^<w:t\b/i.test(token)) {
      currentPage += decodeXmlText(match[1] ?? "");
    } else if (/^<w:(?:lastRenderedPageBreak|br\b[^>]*w:type=["']page)/i.test(token)) {
      pages.push(currentPage.trim());
      currentPage = "";
    } else if (/^<w:tab\b/i.test(token)) {
      currentPage += "\t";
    } else if (/^<w:br\b/i.test(token)) {
      currentPage += "\n";
    } else if (/^<\/w:p/i.test(token)) {
      currentPage += "\n\n";
    }
  }

  pages.push(currentPage.trim());
  return pages;
}

function decodeXmlText(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ============================================================
// ZIP reader (shared by DOCX and PPTX)
// ============================================================

function readZipEntryAsText(buffer: Buffer, entryName: string) {
  const entry = readZipEntry(buffer, entryName);
  return entry?.toString("utf8");
}

function readZipEntry(buffer: Buffer, entryName: string) {
  const endOfCentralDirectoryOffset = findEndOfCentralDirectory(buffer);
  if (endOfCentralDirectoryOffset === -1 || endOfCentralDirectoryOffset + 20 > buffer.length) {
    return undefined;
  }

  const centralDirectorySize = buffer.readUInt32LE(endOfCentralDirectoryOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(endOfCentralDirectoryOffset + 16);
  let offset = centralDirectoryOffset;
  const centralDirectoryEnd = Math.min(buffer.length, centralDirectoryOffset + centralDirectorySize);

  while (offset + 46 <= centralDirectoryEnd && buffer.readUInt32LE(offset) === 0x02014b50) {
    const flags = buffer.readUInt16LE(offset + 8);
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const fileCommentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    if (fileName === entryName && (flags & 1) === 0 && localHeaderOffset + 30 <= buffer.length) {
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
  if (buffer.length < 22) {
    return -1;
  }

  const minimumOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  return -1;
}
