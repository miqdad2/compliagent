import { extractDocumentText } from "@/lib/documents/extraction";
import { chunkPages } from "@/lib/documents/chunking";
import { supportsDirectTextExtraction } from "@/lib/documents/extraction";
import { DocumentExtractionError } from "@/lib/documents/extraction-errors";
import type { SerializedChunk, SerializedPage } from "./types";

export type ExtractionInput = {
  documentId: string;
  mimeType: string;
  extractorVersion: string;
};

export type ExtractionOutput = {
  pages: SerializedPage[];
  chunks: SerializedChunk[];
  pageCount: number;
  ocrRequired: boolean;
  ocrRequiredPageNumbers: number[];
  warnings: string[];
  sourceHash: string;
};

export interface DocumentExtractor {
  /** Returns true if this extractor can handle the given mime type. */
  supports(mimeType: string): boolean;
  /** Extracts pages and chunks from the provided file buffer. */
  extract(input: ExtractionInput, buffer: Buffer): Promise<ExtractionOutput>;
}

export class NativeDocumentExtractor implements DocumentExtractor {
  static readonly VERSION = "native-v1";

  supports(mimeType: string): boolean {
    return supportsDirectTextExtraction(mimeType);
  }

  async extract(input: ExtractionInput, buffer: Buffer): Promise<ExtractionOutput> {
    if (!this.supports(input.mimeType)) {
      throw new DocumentExtractionError({
        code: "unsupported_file_type",
        message: "Native extraction supports PDF, DOCX, XLSX, and PPTX files only.",
        retryable: false
      });
    }

    const extracted = await extractDocumentText(buffer, input.mimeType);
    const textPages = extracted.pages.map((page) => ({ ...page, documentId: input.documentId }));
    const documentChunks = chunkPages(textPages);

    const pages: SerializedPage[] = textPages.map((page) => ({
      pageNumber: page.pageNumber,
      rawText: page.rawText,
      normalizedText: page.normalizedText,
      extractionMethod: page.extractionMethod,
      confidence: page.confidence,
      ocrRecommended: page.ocrRecommended,
      sourceLabel: page.sourceLabel,
      sourceHash: extracted.sourceHash,
      pageWidth: page.pageWidth ?? null,
      pageHeight: page.pageHeight ?? null,
      pageRotation: page.pageRotation ?? null,
      coordinateSystem: page.coordinateSystem ?? null
    }));

    const chunks: SerializedChunk[] = documentChunks.map((chunk) => ({
      pageNumber: chunk.pageNumber,
      clauseNumber: chunk.clauseNumber,
      sectionHeading: chunk.sectionHeading,
      chunkText: chunk.rawText,
      normalizedText: chunk.normalizedText,
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount,
      extractionMethod: chunk.extractionMethod,
      confidence: chunk.confidence,
      sourceLabel: chunk.sourceLabel
    }));

    return {
      pages,
      chunks,
      pageCount: extracted.pageCount,
      ocrRequired: extracted.ocrRequired,
      ocrRequiredPageNumbers: extracted.ocrRequiredPageNumbers,
      warnings: extracted.warnings,
      sourceHash: extracted.sourceHash
    };
  }
}

export const nativeDocumentExtractor = new NativeDocumentExtractor();
