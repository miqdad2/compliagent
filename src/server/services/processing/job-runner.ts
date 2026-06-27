import type { DocumentExtractor } from "./document-extractor";
import type { ProcessingJobGateway } from "./gateway";
import type { JobExecutionResult } from "./types";
import {
  calculateBackoffSeconds,
  classifyError,
  DEFAULT_MAX_ATTEMPTS,
  shouldRetry
} from "./retry-policy";
import { NativeDocumentExtractor } from "./document-extractor";

const EXTRACTION_VERSION_PREFIX = NativeDocumentExtractor.VERSION;

export class DocumentExtractionJobRunner {
  constructor(
    private readonly gateway: ProcessingJobGateway,
    private readonly extractor: DocumentExtractor
  ) {}

  async executeJob(jobId: string, workerId: string): Promise<JobExecutionResult> {
    // 1. Load the job (validate it's still claimable by this worker).
    // In production the worker always calls claimJob first; this re-fetches to get fresh data.
    // We load by org from the job's own organization_id.
    const rawJob = await this.gateway.getJobById(jobId, "any");
    if (!rawJob) {
      return { outcome: "skipped", reason: "Job not found." };
    }
    if (rawJob.status !== "claimed" || rawJob.worker_id !== workerId) {
      return { outcome: "skipped", reason: "Job is no longer claimed by this worker." };
    }

    const documentId = rawJob.document_id;
    if (!documentId) {
      await this.gateway.failJob(jobId, workerId, {
        errorCode: "no_document_id",
        safeMessage: "The job has no associated document."
      });
      return { outcome: "failed", errorCode: "no_document_id", safeMessage: "The job has no associated document." };
    }

    // 2. Mark the job as running.
    await this.gateway.writeAudit([
      {
        organizationId: rawJob.organization_id,
        projectId: rawJob.project_id,
        userId: rawJob.created_by,
        action: "document.processing_started",
        entityType: "processing_jobs",
        entityId: jobId,
        metadata: { documentId, workerId, attempt: rawJob.attempts }
      }
    ]);

    // 3. Load the document.
    const document = await this.gateway.getDocumentById(documentId, rawJob.organization_id);
    if (!document) {
      await this.gateway.failJob(jobId, workerId, {
        errorCode: "document_not_found",
        safeMessage: "The associated document was not found."
      });
      return { outcome: "failed", errorCode: "document_not_found", safeMessage: "The associated document was not found." };
    }

    // 4. Check extractor support.
    if (!this.extractor.supports(document.mime_type)) {
      await this.gateway.failJob(jobId, workerId, {
        errorCode: "unsupported_file_type",
        safeMessage: "Native extraction supports PDF, DOCX, XLSX, and PPTX files only."
      });
      await this.gateway.updateDocumentStatus(documentId, "failed");
      await this.gateway.writeAudit([
        {
          organizationId: rawJob.organization_id,
          projectId: rawJob.project_id,
          userId: rawJob.created_by,
          action: "document.unsupported_type_detected",
          entityType: "documents",
          entityId: documentId,
          metadata: { mimeType: document.mime_type }
        }
      ]);
      return { outcome: "failed", errorCode: "unsupported_file_type", safeMessage: "Native extraction supports PDF, DOCX, XLSX, and PPTX files only." };
    }

    // 5. Download the source file.
    let buffer: Buffer;
    try {
      buffer = await this.gateway.downloadFile(document.storage_path);
    } catch (error) {
      const classification = classifyError(error);
      const attempt = rawJob.attempts;
      const maxAttempts = rawJob.maximum_attempts ?? DEFAULT_MAX_ATTEMPTS;
      if (shouldRetry(classification, attempt, maxAttempts)) {
        const backoffSeconds = calculateBackoffSeconds(attempt);
        await this.gateway.scheduleRetry(jobId, workerId, attempt, {
          errorCode: classification.errorCode,
          safeMessage: classification.safeMessage
        });
        return { outcome: "retry", errorCode: classification.errorCode, safeMessage: classification.safeMessage, retryAfterSeconds: backoffSeconds };
      }
      await this.gateway.failJob(jobId, workerId, classification);
      return { outcome: "failed", errorCode: classification.errorCode, safeMessage: classification.safeMessage };
    }

    // 6. Update heartbeat before extraction (which may be slow for large files).
    await this.gateway.heartbeat(jobId, workerId);

    // 7. Run extraction.
    const extractionVersion = `${EXTRACTION_VERSION_PREFIX}:${jobId}`;
    let extractionOutput;
    try {
      extractionOutput = await this.extractor.extract(
        { documentId, mimeType: document.mime_type, extractorVersion: EXTRACTION_VERSION_PREFIX },
        buffer
      );
    } catch (error) {
      const classification = classifyError(error);
      const attempt = rawJob.attempts;
      const maxAttempts = rawJob.maximum_attempts ?? DEFAULT_MAX_ATTEMPTS;
      if (shouldRetry(classification, attempt, maxAttempts)) {
        const backoffSeconds = calculateBackoffSeconds(attempt);
        await this.gateway.scheduleRetry(jobId, workerId, attempt, {
          errorCode: classification.errorCode,
          safeMessage: classification.safeMessage
        });
        return { outcome: "retry", errorCode: classification.errorCode, safeMessage: classification.safeMessage, retryAfterSeconds: backoffSeconds };
      }
      await this.gateway.failJob(jobId, workerId, classification);
      await this.gateway.updateDocumentStatus(documentId, "failed");
      if (classification.errorCode === "unsupported_file_type") {
        await this.gateway.writeAudit([
          {
            organizationId: rawJob.organization_id,
            projectId: rawJob.project_id,
            userId: rawJob.created_by,
            action: "document.unsupported_type_detected",
            entityType: "documents",
            entityId: documentId,
            metadata: { mimeType: document.mime_type }
          }
        ]);
      }
      return { outcome: "failed", errorCode: classification.errorCode, safeMessage: classification.safeMessage };
    }

    // 8. Update heartbeat after extraction.
    await this.gateway.heartbeat(jobId, workerId);

    // 9. Handle OCR required.
    if (extractionOutput.ocrRequired) {
      await this.gateway.failJob(jobId, workerId, {
        errorCode: "ocr_required",
        safeMessage: "Native extraction was incomplete. OCR is required for identified pages."
      });
      await this.gateway.updateDocumentStatus(documentId, "failed");
      await this.gateway.writeAudit([
        {
          organizationId: rawJob.organization_id,
          projectId: rawJob.project_id,
          userId: rawJob.created_by,
          action: "document.ocr_required_detected",
          entityType: "documents",
          entityId: documentId,
          metadata: {
            ocrRequiredPageNumbers: extractionOutput.ocrRequiredPageNumbers,
            pageCount: extractionOutput.pageCount
          }
        }
      ]);
      return {
        outcome: "completed",
        pageCount: extractionOutput.pageCount,
        chunkCount: extractionOutput.chunks.length,
        ocrRequired: true
      };
    }

    // 10. Atomically persist pages and chunks.
    let persistResult;
    try {
      persistResult = await this.gateway.persistExtraction({
        documentId,
        organizationId: rawJob.organization_id,
        projectId: rawJob.project_id!,
        jobId,
        extractionVersion,
        pageCount: extractionOutput.pageCount,
        ocrRequired: extractionOutput.ocrRequired,
        pages: extractionOutput.pages,
        chunks: extractionOutput.chunks,
        createdBy: rawJob.created_by
      });
    } catch (persistError) {
      const classification = classifyError(persistError);
      await this.gateway.failJob(jobId, workerId, {
        errorCode: classification.errorCode,
        safeMessage: classification.safeMessage
      });
      await this.gateway.updateDocumentStatus(documentId, "failed");
      return { outcome: "failed", errorCode: classification.errorCode, safeMessage: classification.safeMessage };
    }

    // 11. Write completion audit event (best-effort — persist already succeeded above).
    try {
      await this.gateway.writeAudit([
        {
          organizationId: rawJob.organization_id,
          projectId: rawJob.project_id,
          userId: rawJob.created_by,
          action: "document.processing_completed",
          entityType: "processing_jobs",
          entityId: jobId,
          metadata: {
            documentId,
            extractionVersion,
            pageCount: persistResult.pageCount,
            chunkCount: persistResult.chunkCount,
            idempotent: persistResult.idempotent,
            warnings: extractionOutput.warnings
          }
        }
      ]);
    } catch {
      // The extraction was already persisted; audit failure must not roll back success.
    }

    return {
      outcome: "completed",
      pageCount: persistResult.pageCount,
      chunkCount: persistResult.chunkCount,
      ocrRequired: false
    };
  }
}
