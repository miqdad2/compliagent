import { z } from "zod";
import { complianceStatuses, documentRoles, riskLevels } from "@/types/domain";

const sourceReferenceSchema = z.object({
  documentName: z.string().min(1),
  pageNumber: z.number().int().positive(),
  clauseNumber: z.string().optional(),
  quote: z.string().min(1)
});

export const documentClassificationSchema = z.object({
  documentRoleSuggestion: z.enum(documentRoles),
  documentType: z.string().min(1),
  language: z.string().min(1),
  ocrRequired: z.boolean(),
  containsTables: z.boolean(),
  containsDrawings: z.boolean(),
  containsCertificates: z.boolean(),
  confidence: z.number().min(0).max(1)
});

export const extractedRequirementSchema = z.object({
  clauseNumber: z.string().nullable(),
  subClauseNumber: z.string().nullable(),
  heading: z.string().nullable(),
  requirementText: z.string().min(1),
  mandatoryLevel: z.string().min(1),
  numericValue: z.number().nullable(),
  unit: z.string().nullable(),
  standardReference: z.string().nullable(),
  acceptanceCriteria: z.string().nullable(),
  source: sourceReferenceSchema,
  extractionConfidence: z.number().min(0).max(100)
});

export const extractedEvidenceSchema = z.object({
  evidenceText: z.string().min(1),
  evidenceType: z.string().min(1),
  productModel: z.string().nullable(),
  manufacturer: z.string().nullable(),
  numericValue: z.number().nullable(),
  unit: z.string().nullable(),
  standardReference: z.string().nullable(),
  source: sourceReferenceSchema,
  extractionConfidence: z.number().min(0).max(100)
});

export const complianceFindingSchema = z.object({
  requirementSource: sourceReferenceSchema,
  evidenceSource: sourceReferenceSchema.nullable(),
  status: z.enum(complianceStatuses),
  weightageScore: z.number().min(0).max(10),
  confidenceScore: z.number().min(0).max(100),
  reasoning: z.string().min(1),
  missingInformation: z.string().nullable(),
  contractorAction: z.string().nullable(),
  riskLevel: z.enum(riskLevels),
  requiresHumanReview: z.boolean()
});

export const contractorClarificationSchema = z.object({
  relatedClause: z.string().nullable(),
  issue: z.string().min(1),
  whyItMatters: z.string().min(1),
  requiredAction: z.string().min(1),
  requiredDocument: z.string().min(1),
  priority: z.enum(["Critical", "High", "Medium", "Low"])
});

export type DocumentClassification = z.infer<typeof documentClassificationSchema>;
export type ExtractedRequirement = z.infer<typeof extractedRequirementSchema>;
export type ExtractedEvidence = z.infer<typeof extractedEvidenceSchema>;
export type ComplianceFindingOutput = z.infer<typeof complianceFindingSchema>;
export type ContractorClarificationOutput = z.infer<typeof contractorClarificationSchema>;
