import type {
  AnnotationApproval,
  AnnotationApprovalStatus,
  AnnotationRevision,
  AnnotationType,
  CoordinateSystem,
  DocumentAnnotation,
  EvidenceRegion,
  EvidenceRegionType,
  FindingEvidenceRelationshipType
} from "./schemas";
import type { ComplianceStatus } from "@/types/domain";

export type AnnotationScope = {
  organizationId: string;
  projectId: string;
};

export type EvidenceRegionMappingInput = AnnotationScope & {
  documentId: string;
  findingId: string;
  relationshipType: FindingEvidenceRelationshipType;
  pageNumber?: number;
  slideNumber?: number;
  sheetName?: string;
  cellRange?: string;
  regionType: EvidenceRegionType;
  coordinateSystem: CoordinateSystem;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  extractedText?: string;
  extractionConfidence: number;
  sourceHash: string;
};

export interface EvidenceRegionMappingService {
  mapEvidenceRegion(input: EvidenceRegionMappingInput): Promise<EvidenceRegion>;
}

export type AnnotationCreationInput = AnnotationScope & {
  reviewId: string;
  findingId: string;
  documentId: string;
  evidenceRegionId: string;
  sourceRequirementDocumentId?: string;
  requirementConditionId?: string;
  conditionEvaluationId?: string;
  pageNumber: number;
  annotationType: AnnotationType;
  sourceReference: string;
  clauseNumber?: string;
  subClauseNumber?: string;
  complianceStatus: ComplianceStatus;
  matchedCondition?: string;
  exactEvidenceText?: string;
  conciseResult?: string;
  label: string;
  comment?: string;
  reasoning: string;
  missingInformation?: string;
  contractorAction?: string;
  coordinateSystem: CoordinateSystem;
  x: number;
  y: number;
  width: number;
  height: number;
  connectorTargetRegionId?: string;
  styleMetadata?: Record<string, unknown>;
  isAiGenerated: boolean;
  createdBy: string;
};

export type ConditionAnnotationCreationInput = AnnotationCreationInput & {
  sourceRequirementDocumentId: string;
  requirementConditionId: string;
  conditionEvaluationId: string;
  matchedCondition: string;
  exactEvidenceText: string;
  conciseResult: string;
};

export interface AnnotationCreationService {
  createDraftAnnotation(input: AnnotationCreationInput): Promise<DocumentAnnotation>;
  reviseAnnotation(annotationId: string, revision: AnnotationRevision): Promise<DocumentAnnotation>;
}

export type AnnotationApprovalInput = AnnotationScope & {
  annotationId: string;
  approvalStatus: Exclude<AnnotationApprovalStatus, "pending">;
  reviewerId: string;
  reviewerComment?: string;
};

export interface AnnotationApprovalService {
  recordDecision(input: AnnotationApprovalInput): Promise<AnnotationApproval>;
}

export type AnnotationRenderInput = AnnotationScope & {
  reviewId: string;
  documentId: string;
  approvedAnnotationIds: string[];
};

export type AnnotationRenderResult = {
  storagePath: string;
  contentType: "application/pdf";
  sourceDocumentId: string;
};

/** Future adapter boundary. Implementations must render a new artifact and never overwrite the source document. */
export interface AnnotationRenderingService {
  renderApprovedAnnotations(input: AnnotationRenderInput): Promise<AnnotationRenderResult>;
}
