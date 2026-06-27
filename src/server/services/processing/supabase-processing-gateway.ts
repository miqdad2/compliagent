import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { ProcessingJobGateway } from "./gateway";
import type {
  DocumentRow,
  EnqueueJobInput,
  FailInput,
  PersistExtractionInput,
  PersistExtractionResult,
  ProcessingAuditRecord,
  ProcessingJobRow,
  RetryInput
} from "./types";
import { calculateBackoffSeconds } from "./retry-policy";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export class SupabaseProcessingGateway implements ProcessingJobGateway {
  constructor(
    private readonly client: AdminClient,
    private readonly bucketName: string = process.env.SUPABASE_STORAGE_BUCKET_DOCUMENTS ?? "documents"
  ) {}

  async enqueue(input: EnqueueJobInput): Promise<ProcessingJobRow> {
    const { data, error } = await this.client
      .from("processing_jobs")
      .insert({
        organization_id: input.organizationId,
        project_id: input.projectId,
        document_id: input.documentId,
        job_type: "document_extraction",
        status: "queued",
        progress: 0,
        priority: input.priority ?? 5,
        available_at: new Date().toISOString(),
        created_by: input.createdBy ?? undefined,
        metadata: { storagePath: input.storagePath, mimeType: input.mimeType }
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`Failed to enqueue document processing job: ${error?.message ?? "unknown"}`);
    }
    return data as ProcessingJobRow;
  }

  async claimJob(workerId: string, jobType: string): Promise<ProcessingJobRow | null> {
    const { data, error } = await this.client.rpc("claim_processing_job", {
      p_worker_id: workerId,
      p_job_type: jobType
    });

    if (error) {
      throw new Error(`Failed to claim processing job: ${error.message}`);
    }
    if (!data) return null;

    const { data: job, error: jobError } = await this.client
      .from("processing_jobs")
      .select("*")
      .eq("id", data as string)
      .single();

    if (jobError || !job) return null;
    return job as ProcessingJobRow;
  }

  async heartbeat(jobId: string, _workerId: string): Promise<void> {
    await this.client
      .from("processing_jobs")
      .update({ heartbeat_at: new Date().toISOString(), status: "running" })
      .eq("id", jobId);
  }

  async persistExtraction(input: PersistExtractionInput): Promise<PersistExtractionResult> {
    const { data, error } = await this.client.rpc("replace_document_extraction_transactionally", {
      p_document_id: input.documentId,
      p_organization_id: input.organizationId,
      p_project_id: input.projectId,
      p_job_id: input.jobId,
      p_extraction_version: input.extractionVersion,
      p_page_count: input.pageCount,
      p_ocr_required: input.ocrRequired,
      p_pages: input.pages,
      p_chunks: input.chunks,
      p_created_by: input.createdBy ?? null
    });

    if (error) {
      throw new Error(`Extraction persistence failed: ${error.message}`);
    }

    const result = data as { pageCount: number; chunkCount: number; idempotent: boolean };
    return {
      pageCount: result.pageCount,
      chunkCount: result.chunkCount,
      idempotent: result.idempotent
    };
  }

  async failJob(jobId: string, _workerId: string, error: FailInput): Promise<void> {
    await this.client.from("processing_jobs").update({
      status: "failed",
      failed_at: new Date().toISOString(),
      last_error_code: error.errorCode,
      safe_error_message: error.safeMessage,
      error_message: error.safeMessage
    }).eq("id", jobId);
  }

  async scheduleRetry(jobId: string, _workerId: string, attempt: number, error: RetryInput): Promise<void> {
    const backoffSeconds = calculateBackoffSeconds(attempt);
    const availableAt = new Date(Date.now() + backoffSeconds * 1000).toISOString();

    await this.client.from("processing_jobs").update({
      status: "retry_wait",
      locked_at: null,
      locked_by: null,
      available_at: availableAt,
      last_error_code: error.errorCode,
      safe_error_message: error.safeMessage
    }).eq("id", jobId);
  }

  async recoverAbandonedJobs(heartbeatThresholdMinutes: number, workerId: string): Promise<number> {
    const { data, error } = await this.client.rpc("recover_abandoned_processing_jobs", {
      p_heartbeat_threshold_minutes: heartbeatThresholdMinutes,
      p_worker_id: workerId
    });

    if (error) {
      throw new Error(`Failed to recover abandoned jobs: ${error.message}`);
    }
    return (data as number) ?? 0;
  }

  async getJobById(jobId: string, _organizationId: string): Promise<ProcessingJobRow | null> {
    const { data, error } = await this.client
      .from("processing_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load job: ${error.message}`);
    return (data as ProcessingJobRow) ?? null;
  }

  async getDocumentById(documentId: string, organizationId: string): Promise<DocumentRow | null> {
    const { data, error } = await this.client
      .from("documents")
      .select("id, organization_id, project_id, storage_path, mime_type, processing_status")
      .eq("id", documentId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    if (error) throw new Error(`Failed to load document: ${error.message}`);
    if (!data) return null;
    return {
      id: data.id,
      organization_id: data.organization_id,
      project_id: data.project_id,
      storage_path: data.storage_path,
      mime_type: data.mime_type,
      processing_status: data.processing_status
    };
  }

  async downloadFile(storagePath: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(this.bucketName).download(storagePath);
    if (error || !data) {
      throw new Error(`Failed to download file from storage: ${error?.message ?? "unknown"}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  async updateDocumentStatus(documentId: string, status: string): Promise<void> {
    await this.client.from("documents").update({ processing_status: status as never }).eq("id", documentId);
  }

  async writeAudit(records: ProcessingAuditRecord[]): Promise<void> {
    if (records.length === 0) return;
    await this.client.from("audit_logs").insert(
      records.map((r) => ({
        organization_id: r.organizationId,
        project_id: r.projectId ?? null,
        user_id: r.userId ?? null,
        action: r.action,
        entity_type: r.entityType,
        entity_id: r.entityId ?? null,
        metadata: r.metadata
      }))
    );
  }
}
