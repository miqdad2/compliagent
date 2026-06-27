export const extractionMethods = ["pdf_text", "docx_text", "xlsx_text", "pptx_text", "ocr", "manual"] as const;

export type ExtractionMethod = (typeof extractionMethods)[number];

// ============================================================
// Text block info — structural metadata per extracted text block
// ============================================================

export type TextBlockType =
  | "heading"
  | "paragraph"
  | "list_item"
  | "table_cell"
  | "caption"
  | "header"
  | "footer"
  | "unknown";

export interface ExtractedTextBlockInfo {
  id: string;
  text: string;
  blockType: TextBlockType;
  readingOrder: number;
  headingLevel?: number;
  clauseNumber?: string;
  sectionHeading?: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
  normalizedBoundingBox?: { x: number; y: number; width: number; height: number };
  coordinateSystem?: string;
  confidence: number;
}

// ============================================================
// Extracted pages
// ============================================================

export type ExtractedTextPage = {
  pageNumber: number;
  rawText: string;
  normalizedText: string;
  extractionMethod: ExtractionMethod;
  confidence: number;
  sourceLabel: string;
  ocrRecommended: boolean;
  /** Present when the format exposes per-block structure or spatial data. */
  textBlocks?: ExtractedTextBlockInfo[];
  /** Page width in the native coordinate system (e.g. EMU for PPTX, points for PDF). */
  pageWidth?: number;
  /** Page height in the native coordinate system. */
  pageHeight?: number;
  /** Page rotation in degrees (0, 90, 180, or 270). */
  pageRotation?: number;
  /** Coordinate system used by any boundingBox values. */
  coordinateSystem?: string;
};

export type TextPage = ExtractedTextPage & {
  documentId: string;
};

// ============================================================
// Document chunks
// ============================================================

export type DocumentChunk = {
  documentId: string;
  pageNumber: number;
  sectionHeading: string | null;
  clauseNumber: string | null;
  rawText: string;
  normalizedText: string;
  chunkIndex: number;
  tokenCount: number;
  extractionMethod: ExtractionMethod;
  confidence: number;
  sourceLabel: string;
  /** IDs of the ExtractedTextBlockInfo entries contributing to this chunk. */
  blockIds?: string[];
};

const clausePattern = /^\s*((?:\d{1,4}(?:\.\d+)*(?:\([a-z0-9]+\))?)|(?:[A-Z]\.\d+(?:\.\d+)*(?:\([a-z0-9]+\))?)|(?:\([a-z0-9]+\)))(?=\s|[.)-])/;
const requirementLanguagePattern = /\b(?:shall|must|should|will|may|required|requirement)\b/i;

export function normalizeDocumentText(text: string) {
  return text.replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

export function inferClauseNumber(text: string) {
  return text.match(clausePattern)?.[1] ?? null;
}

export function inferSectionHeading(text: string) {
  const normalized = normalizeDocumentText(text);
  if (!normalized || normalized.length > 140 || requirementLanguagePattern.test(normalized)) {
    return null;
  }

  const clauseNumber = inferClauseNumber(normalized);
  const withoutClause = clauseNumber
    ? normalized.slice(normalized.indexOf(clauseNumber) + clauseNumber.length).replace(/^[.)\s-]+/, "").trim()
    : normalized;
  const words = withoutClause.split(/\s+/).filter(Boolean);

  if (!withoutClause || words.length > 14 || /[.!?;]$/.test(withoutClause)) {
    return null;
  }

  const letters = withoutClause.replace(/[^A-Za-z]/g, "");
  const isUppercase = letters.length >= 3 && letters === letters.toUpperCase();
  const titleCaseWords = words.filter((word) => /^[A-Z][A-Za-z0-9/&()-]*$/.test(word)).length;
  const isTitleCase = words.length >= 2 && titleCaseWords / words.length >= 0.7;

  if (clauseNumber || isUppercase || isTitleCase || normalized.endsWith(":")) {
    return withoutClause.replace(/:$/, "").trim();
  }

  return null;
}

export function chunkPages(pages: TextPage[], maxCharacters = 1800): DocumentChunk[] {
  if (maxCharacters < 100) {
    throw new Error("Document chunk size must be at least 100 characters.");
  }

  const chunks: DocumentChunk[] = [];
  let currentSection: string | null = null;

  for (const page of pages) {
    const blocks = splitIntoSourceBlocks(page.rawText);
    let buffer = "";
    let bufferClause: string | null = null;
    let bufferSection = currentSection;
    let bufferBlockIds: string[] = [];

    const flush = () => {
      if (!buffer.trim()) {
        return;
      }

      const rawText = buffer.trim();
      const normalizedText = normalizeDocumentText(rawText);
      chunks.push({
        documentId: page.documentId,
        pageNumber: page.pageNumber,
        sectionHeading: bufferSection,
        clauseNumber: bufferClause,
        rawText,
        normalizedText,
        chunkIndex: chunks.length,
        tokenCount: Math.ceil(normalizedText.length / 4),
        extractionMethod: page.extractionMethod,
        confidence: page.confidence,
        sourceLabel: page.sourceLabel,
        blockIds: bufferBlockIds.length > 0 ? [...bufferBlockIds] : undefined
      });
      buffer = "";
      bufferClause = null;
      bufferSection = currentSection;
      bufferBlockIds = [];
    };

    for (const [blockIndex, block] of blocks.entries()) {
      const clauseNumber = inferClauseNumber(block);
      const sectionHeading = inferSectionHeading(block);
      const startsNewSourceUnit = clauseNumber !== null || sectionHeading !== null;

      if (startsNewSourceUnit) {
        flush();
      }

      if (sectionHeading) {
        currentSection = sectionHeading;
      }

      // Collect block IDs from the page's textBlocks if available
      if (page.textBlocks) {
        const matchingBlocks = page.textBlocks
          .filter((tb) => tb.text && block.includes(tb.text))
          .map((tb) => tb.id);
        for (const id of matchingBlocks) {
          if (!bufferBlockIds.includes(id)) {
            bufferBlockIds.push(id);
          }
        }
      } else {
        // Use positional block ID when no textBlocks are available
        bufferBlockIds.push(`${page.pageNumber}:${blockIndex}`);
      }

      const segments = splitOversizedBlock(block, maxCharacters);
      for (const [segmentIndex, segment] of segments.entries()) {
        if (segmentIndex > 0) {
          flush();
          if (page.textBlocks) {
            const matchingBlocks = page.textBlocks
              .filter((tb) => tb.text && segment.includes(tb.text))
              .map((tb) => tb.id);
            for (const id of matchingBlocks) {
              if (!bufferBlockIds.includes(id)) bufferBlockIds.push(id);
            }
          }
        }

        if (!buffer) {
          bufferClause = clauseNumber;
          bufferSection = sectionHeading ?? currentSection;
        }

        if (buffer && buffer.length + 2 + segment.length > maxCharacters) {
          flush();
          bufferClause = clauseNumber;
          bufferSection = sectionHeading ?? currentSection;
        }

        buffer = buffer ? `${buffer}\n\n${segment}` : segment;
      }
    }

    flush();
  }

  return chunks;
}

function splitIntoSourceBlocks(text: string) {
  const blocks: string[] = [];
  let lines: string[] = [];

  const flush = () => {
    const block = lines.join("\n").trim();
    if (block) {
      blocks.push(block);
    }
    lines = [];
  };

  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      flush();
      continue;
    }

    if (lines.length > 0 && (inferClauseNumber(line) || inferSectionHeading(line))) {
      flush();
    }

    lines.push(line);

    if (inferSectionHeading(line)) {
      flush();
    }
  }

  flush();
  return blocks;
}

function splitOversizedBlock(text: string, maxCharacters: number) {
  const segments: string[] = [];
  let remaining = text.trim();

  while (remaining.length > maxCharacters) {
    const candidate = remaining.slice(0, maxCharacters + 1);
    const sentenceBoundary = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("; "), candidate.lastIndexOf(": "));
    const lineBoundary = candidate.lastIndexOf("\n");
    const wordBoundary = candidate.lastIndexOf(" ");
    const splitAt = Math.max(sentenceBoundary > 0 ? sentenceBoundary + 1 : 0, lineBoundary, wordBoundary);
    const safeSplitAt = splitAt >= Math.floor(maxCharacters * 0.6) ? splitAt : maxCharacters;

    segments.push(remaining.slice(0, safeSplitAt).trim());
    remaining = remaining.slice(safeSplitAt).trim();
  }

  if (remaining) {
    segments.push(remaining);
  }

  return segments;
}
