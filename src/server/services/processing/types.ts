import type { Database } from "@/types/database";

export type ProcessingJobRow = Database["public"]["Tables"]["processing_jobs"]["Row"];
export type ProcessingJobInsert = Database["public"]["Tables"]["processing_jobs"]["Insert"];

export type DocumentRow = {
  id: string;
  organization_id: string;
  project_id: string;
  storage_path: string;
  mime_type: string;
  processing_status: string;
};

export type EnqueueJobInput = {
  organizationId: string;
  projectId: string;
  documentId: string;
  storagePath: string;
  mimeType: string;
  priority?: number;
  createdBy: string | null;
};

export type PersistExtractionInput = {
  documentId: string;
  organizationId: string;
  projectId: string;
  jobId: string;
  extractionVersion: string;
  pageCount: number;
  ocrRequired: boolean;
  pages: SerializedPage[];
  chunks: SerializedChunk[];
  createdBy: string | null;
};

export type SerializedPage = {
  pageNumber: number;
  rawText: string;
  normalizedText?: string;
  extractionMethod: string;
  confidence: number;
  ocrRecommended: boolean;
  sourceLabel?: string;
  sourceHash?: string;
  pageWidth?: number | null;
  pageHeight?: number | null;
  pageRotation?: number | null;
  coordinateSystem?: string | null;
};

export type SerializedChunk = {
  pageNumber: number;
  clauseNumber: string | null;
  sectionHeading: string | null;
  chunkText: string;
  normalizedText: string;
  chunkIndex: number;
  tokenCount: number;
  extractionMethod: string;
  confidence: number;
  sourceLabel: string;
};

export type PersistExtractionResult = {
  pageCount: number;
  chunkCount: number;
  idempotent: boolean;
};

export type RetryInput = {
  errorCode: string;
  safeMessage: string;
};

export type FailInput = {
  errorCode: string;
  safeMessage: string;
};

export type ProcessingAuditRecord = {
  organizationId: string;
  projectId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
};

export type JobExecutionResult =
  | { outcome: "completed"; pageCount: number; chunkCount: number; ocrRequired: boolean }
  | { outcome: "retry"; errorCode: string; safeMessage: string; retryAfterSeconds: number }
  | { outcome: "failed"; errorCode: string; safeMessage: string }
  | { outcome: "skipped"; reason: string };
