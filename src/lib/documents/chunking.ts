export type TextPage = {
  pageNumber: number;
  text: string;
};

export type DocumentChunk = {
  pageNumber: number;
  sectionHeading: string | null;
  clauseNumber: string | null;
  rawText: string;
  normalizedText: string;
  chunkIndex: number;
  tokenCount: number;
  extractionMethod: "pdf_text" | "docx_text" | "xlsx_text" | "ocr" | "manual";
  confidence: number;
};

const clausePattern = /^(\d+(?:\.\d+)*|[A-Z]\.\d+(?:\.\d+)*)(?:\s+|-)/;

export function normalizeDocumentText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function inferClauseNumber(text: string) {
  return text.match(clausePattern)?.[1] ?? null;
}

export function chunkPages(
  pages: TextPage[],
  extractionMethod: DocumentChunk["extractionMethod"],
  maxCharacters = 1800
): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];

  for (const page of pages) {
    const paragraphs = page.text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    let buffer = "";

    const flush = () => {
      if (!buffer.trim()) {
        return;
      }

      const rawText = buffer.trim();
      const normalizedText = normalizeDocumentText(rawText);
      chunks.push({
        pageNumber: page.pageNumber,
        sectionHeading: null,
        clauseNumber: inferClauseNumber(rawText),
        rawText,
        normalizedText,
        chunkIndex: chunks.length,
        tokenCount: Math.ceil(normalizedText.length / 4),
        extractionMethod,
        confidence: extractionMethod === "ocr" ? 0.75 : 0.9
      });
      buffer = "";
    };

    for (const paragraph of paragraphs) {
      if (buffer.length + paragraph.length > maxCharacters) {
        flush();
      }
      buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    }

    flush();
  }

  return chunks;
}
