import { z } from "zod";

export const jobStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export const jobTypeSchema = z.enum([
  "document_extraction",
  "ocr",
  "page_rendering",
  "table_extraction",
  "image_region_detection",
  "embedding_generation",
  "requirement_extraction",
  "requirement_decomposition",
  "evidence_extraction",
  "condition_evidence_retrieval",
  "condition_evaluation",
  "parent_finding_derivation",
  "standards_applicability",
  "compliance_review",
  "reviewer_check",
  "evidence_region_mapping",
  "annotation_generation",
  "annotation_comment_generation",
  "report_generation"
]);

export type JobStatus = z.infer<typeof jobStatusSchema>;
export type JobType = z.infer<typeof jobTypeSchema>;

export type BackgroundJob = {
  id: string;
  jobType: JobType;
  status: JobStatus;
  progress: number;
  projectId?: string;
  documentId?: string;
  reviewId?: string;
};
