import { runDocumentProcessingFromBuffer, type ProcessingJobInput } from "@/lib/documents/processing-pipeline";

export async function processDocumentJob(input: ProcessingJobInput, buffer: Buffer) {
  return runDocumentProcessingFromBuffer(input, buffer);
}
