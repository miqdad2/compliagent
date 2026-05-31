import { z } from "zod";

export const jobStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled"]);
export const jobTypeSchema = z.enum([
  "document_extraction",
  "ocr",
  "table_extraction",
  "embedding_generation",
  "requirement_extraction",
  "evidence_extraction",
  "standards_applicability",
  "compliance_review",
  "reviewer_check",
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
