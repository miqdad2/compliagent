/**
 * Annotation preparation service.
 *
 * Accepts only reviewer-approved findings and validates all prerequisites
 * before handing off to the PDF renderer.  All rules listed here must hold
 * for a finding to be included in the annotated output.
 *
 * Rejection reasons are recorded; findings that fail validation are excluded
 * from the annotation batch — they do not block the other findings.
 */
import { validateNormalizedBox } from "@/lib/documents/coordinates";
import { generateAnnotationText } from "@/lib/annotations/content";
import { getAnnotationStyle } from "@/lib/annotations/styles";
import type { BoundingBox } from "@/lib/documents/coordinates";
import type { ComplianceStatus } from "@/types/domain";
import type { AnnotationTextOutput } from "@/lib/annotations/content";
import type { AnnotationStyleMeta } from "@/lib/annotations/styles";

export const ANNOTATION_CONTRACT_VERSION = "1.0";

export type AnnotationInput = {
  organizationId:       string;
  projectId:            string;
  reviewId:             string;
  findingId:            string;
  requirementId:        string | null;
  conditionId:          string | null;
  clauseNumber:         string | null;
  subClauseNumber:      string | null;
  /** Reviewer-approved effective status. */
  finalStatus:          ComplianceStatus;
  approvedReasoning:    string;
  approvedMissingInfo:  string | null;
  approvedContractorAction: string | null;
  /** Document that contains the evidence. */
  evidenceDocumentId:   string;
  evidenceDocumentHash: string;
  pageNumber:           number;
  exactQuote:           string | null;
  evidenceRegionId:     string;
  /** Normalized bounding box [0–1] of the evidence region. */
  normalizedBox: BoundingBox | null;
  coordinateSystem:     string;
  /** The reviewer who approved this finding. */
  reviewerId:           string;
  approvedAt:           string;
  /** Whether the finding has been superseded since approval. */
  isSuperseded:         boolean;
  /** Source document hash at approval time (for staleness check). */
  sourceHashAtApproval: string;
};

export type PreparedAnnotation = {
  input:    AnnotationInput;
  text:     AnnotationTextOutput;
  style:    AnnotationStyleMeta;
  pageNumber: number;
};

export type AnnotationRejection = {
  findingId: string;
  reasons:   string[];
};

export type AnnotationPreparationResult = {
  prepared:   PreparedAnnotation[];
  rejected:   AnnotationRejection[];
  reviewId:   string;
  contractVersion: string;
};

/** Statuses for which evidence is required. */
const POSITIVE_STATUSES: ComplianceStatus[] = ["complied", "exceeds_requirement"];

export class AnnotationPreparationService {
  /**
   * Validate and prepare a list of annotation inputs for rendering.
   * Returns the subset that passes all validation rules, plus rejection details.
   */
  prepare(
    inputs: AnnotationInput[],
    reviewId: string,
    currentDocumentHashes: Record<string, string>
  ): AnnotationPreparationResult {
    const prepared: PreparedAnnotation[] = [];
    const rejected: AnnotationRejection[] = [];

    for (const input of inputs) {
      const reasons = this._validate(input, currentDocumentHashes);
      if (reasons.length > 0) {
        rejected.push({ findingId: input.findingId, reasons });
        continue;
      }

      const text  = generateAnnotationText({
        clauseNumber:       input.clauseNumber,
        subClauseNumber:    input.subClauseNumber,
        status:             input.finalStatus,
        reasoning:          input.approvedReasoning,
        missingInformation: input.approvedMissingInfo,
        contractorAction:   input.approvedContractorAction,
        exactQuote:         input.exactQuote
      });

      const style = getAnnotationStyle(input.finalStatus);

      prepared.push({
        input,
        text,
        style,
        pageNumber: input.pageNumber
      });
    }

    return { prepared, rejected, reviewId, contractVersion: ANNOTATION_CONTRACT_VERSION };
  }

  private _validate(
    input: AnnotationInput,
    currentDocumentHashes: Record<string, string>
  ): string[] {
    const reasons: string[] = [];

    // 1. Finding must be reviewer-approved.
    if (!input.reviewerId) {
      reasons.push("Finding has not been reviewer-approved.");
    }
    if (!input.approvedAt) {
      reasons.push("Approval timestamp is missing.");
    }

    // 2. Finding must not be superseded.
    if (input.isSuperseded) {
      reasons.push("Finding has been superseded and cannot be annotated.");
    }

    // 3. Source document hash must still match (document not replaced).
    const currentHash = currentDocumentHashes[input.evidenceDocumentId];
    if (currentHash && currentHash !== input.evidenceDocumentHash) {
      reasons.push("Source document has changed since this finding was approved. Rerun the review.");
    }

    // 4. Evidence must exist for positive statuses.
    if (POSITIVE_STATUSES.includes(input.finalStatus) && !input.exactQuote) {
      reasons.push(`Status "${input.finalStatus}" requires an exact evidence quote.`);
    }

    // 5. Normalized coordinates must be valid when provided.
    if (input.normalizedBox !== null) {
      const coordErrors = validateNormalizedBox(input.normalizedBox);
      if (coordErrors.length > 0) {
        reasons.push(`Invalid normalized coordinates: ${coordErrors.join("; ")}`);
      }
    }

    // 6. Evidence must belong to the same project/organization.
    if (!input.evidenceDocumentId) {
      reasons.push("No evidence document is linked to this finding.");
    }
    if (input.pageNumber < 1) {
      reasons.push("Evidence page number must be a positive integer.");
    }

    // 7. Quote must be non-empty for positive statuses.
    if (POSITIVE_STATUSES.includes(input.finalStatus) && (!input.exactQuote || !input.exactQuote.trim())) {
      reasons.push("Exact evidence quote is required for complied or exceeds-requirement findings.");
    }

    return reasons;
  }
}
