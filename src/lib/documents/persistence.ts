import type { ProcessingJobInput, ProcessingResult } from "./processing-pipeline";

export function createDocumentPageRows(result: ProcessingResult, projectId: string) {
  return result.pages.map((page) => ({
    document_id: page.documentId,
    project_id: projectId,
    page_number: page.pageNumber,
    extracted_text: page.rawText,
    extraction_method: page.extractionMethod,
    confidence: page.confidence
  }));
}

export function createDocumentChunkRows(result: ProcessingResult, projectId: string) {
  return result.chunks.map((chunk) => ({
    document_id: chunk.documentId,
    project_id: projectId,
    page_number: chunk.pageNumber,
    clause_number: chunk.clauseNumber,
    section_heading: chunk.sectionHeading,
    chunk_text: chunk.rawText,
    normalized_text: chunk.normalizedText,
    metadata: {
      chunkIndex: chunk.chunkIndex,
      tokenCount: chunk.tokenCount,
      extractionMethod: chunk.extractionMethod,
      confidence: chunk.confidence,
      sourceLabel: chunk.sourceLabel
    }
  }));
}

export function createProcessingJobMetadata(input: ProcessingJobInput, result?: ProcessingResult) {
  if (!result) {
    return {
      storagePath: input.storagePath,
      mimeType: input.mimeType,
      retryable: true
    };
  }

  return {
    storagePath: input.storagePath,
    mimeType: input.mimeType,
    pageCount: result.pageCount,
    chunkCount: result.chunks.length,
    ocrRequired: result.ocrRequired,
    ocrRequiredPageNumbers: result.ocrRequiredPageNumbers,
    errorCode: result.errorCode,
    retryable: result.retryable,
    warnings: result.warnings
  };
}
