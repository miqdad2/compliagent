import { z } from "zod";
import { chunkPages, type DocumentChunk, type TextPage } from "./chunking";
import { extractDocumentText } from "./extraction";
import { normalizeExtractionError, type ExtractionErrorCode } from "./extraction-errors";

export const processingJobSchema = z.object({
  documentId: z.string().uuid(),
  projectId: z.string().uuid(),
  storagePath: z.string().min(1),
  mimeType: z.string().min(1)
});

export type ProcessingJobInput = z.infer<typeof processingJobSchema>;

export type ProcessingResult = {
  status: "queued" | "running" | "completed" | "failed";
  pages: TextPage[];
  chunks: DocumentChunk[];
  pageCount: number;
  ocrRequired: boolean;
  ocrRequiredPageNumbers: number[];
  errorCode: ExtractionErrorCode | "ocr_required" | null;
  retryable: boolean;
  message: string;
  warnings: string[];
  sourceHash: string;
};

export async function enqueueDocumentProcessing(input: ProcessingJobInput) {
  const job = processingJobSchema.parse(input);
  return {
    jobType: "document_extraction" as const,
    status: "queued" as const,
    documentId: job.documentId,
    projectId: job.projectId
  };
}

export async function runDocumentProcessingFromBuffer(input: ProcessingJobInput, buffer: Buffer): Promise<ProcessingResult> {
  const job = processingJobSchema.parse(input);
  try {
    const extracted = await extractDocumentText(buffer, job.mimeType);
    const pages = extracted.pages.map((page) => ({ ...page, documentId: job.documentId }));
    const chunks = chunkPages(pages);

    return {
      status: extracted.ocrRequired ? "failed" : "completed",
      pages,
      chunks,
      pageCount: extracted.pageCount,
      ocrRequired: extracted.ocrRequired,
      ocrRequiredPageNumbers: extracted.ocrRequiredPageNumbers,
      errorCode: extracted.ocrRequired ? "ocr_required" : null,
      retryable: false,
      message: extracted.ocrRequired
        ? "Native extraction was incomplete. OCR is required for the identified pages before review can continue."
        : `Extracted ${chunks.length} source-preserving chunk${chunks.length === 1 ? "" : "s"} from ${extracted.pageCount} page${extracted.pageCount === 1 ? "" : "s"}.`,
      warnings: extracted.warnings,
      sourceHash: extracted.sourceHash
    };
  } catch (error) {
    throw normalizeExtractionError(error);
  }
}
