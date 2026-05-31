import { z } from "zod";
import { chunkPages, type DocumentChunk, type TextPage } from "./chunking";
import { extractDocumentText } from "./extraction";

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
  message: string;
  warnings: string[];
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
  const extracted = await extractDocumentText(buffer, job.mimeType);
  const chunks = chunkPages(extracted.pages, extracted.extractionMethod);

  return {
    status: extracted.ocrRequired ? "failed" : "completed",
    pages: extracted.pages,
    chunks,
    pageCount: extracted.pageCount,
    ocrRequired: extracted.ocrRequired,
    message: extracted.ocrRequired
      ? "No reliable selectable text was found. OCR processing is required before review can continue."
      : `Extracted ${chunks.length} source-preserving chunk${chunks.length === 1 ? "" : "s"} from ${extracted.pageCount} page${extracted.pageCount === 1 ? "" : "s"}.`,
    warnings: extracted.warnings
  };
}
