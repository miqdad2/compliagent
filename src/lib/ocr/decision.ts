/**
 * Deterministic OCR decision service.
 *
 * Decides whether OCR should run and at what scope without executing
 * any I/O or consulting an AI provider. External transmission requires
 * explicit organization consent and configured provider availability.
 */

export type OcrDecisionAction =
  | "USE_NATIVE"
  | "OCR_PAGE"
  | "OCR_DOCUMENT"
  | "OCR_NOT_ALLOWED"
  | "OCR_PROVIDER_UNAVAILABLE"
  | "MANUAL_REVIEW_REQUIRED";

export type OcrDecision =
  | { action: "USE_NATIVE"; reason: string }
  | { action: "OCR_PAGE"; pageNumbers: number[]; reason: string }
  | { action: "OCR_DOCUMENT"; reason: string }
  | { action: "OCR_NOT_ALLOWED"; reason: string }
  | { action: "OCR_PROVIDER_UNAVAILABLE"; reason: string }
  | { action: "MANUAL_REVIEW_REQUIRED"; reason: string };

export interface OcrDecisionInput {
  mimeType: string;
  pageCount: number;
  ocrRequiredPageNumbers: number[];
  hasCoordinates: boolean;
  hasPageImages: boolean;
  /** undefined means "not checked" — treated as no restriction. */
  organizationOcrEnabled?: boolean;
  externalTransmissionAllowed?: boolean;
  providerAvailable?: boolean;
}

/** Threshold above which we OCR the whole document rather than specific pages. */
const DOCUMENT_OCR_RATIO_THRESHOLD = 0.5;

export function makeOcrDecision(input: OcrDecisionInput): OcrDecision {
  // 1. No weak pages → native extraction is sufficient.
  if (input.ocrRequiredPageNumbers.length === 0) {
    return {
      action: "USE_NATIVE",
      reason: "Native extraction quality is sufficient for all pages."
    };
  }

  // 2. Organization has explicitly disabled OCR.
  if (input.organizationOcrEnabled === false) {
    return {
      action: "OCR_NOT_ALLOWED",
      reason: "OCR is disabled in organization settings."
    };
  }

  // 3. No provider is configured or available.
  if (input.providerAvailable === false) {
    return {
      action: "OCR_PROVIDER_UNAVAILABLE",
      reason: "No OCR provider is configured for this organization."
    };
  }

  // 4. Page images are not available — cannot OCR without them.
  if (!input.hasPageImages) {
    return {
      action: "MANUAL_REVIEW_REQUIRED",
      reason: "Page images are not available. Manual review is required."
    };
  }

  // 5. External transmission is explicitly blocked.
  if (input.externalTransmissionAllowed === false) {
    return {
      action: "OCR_NOT_ALLOWED",
      reason: "External document transmission is not permitted by organization settings."
    };
  }

  // 6. Decide scope: page-level vs. document-level.
  const ocrRatio = input.ocrRequiredPageNumbers.length / Math.max(1, input.pageCount);

  if (ocrRatio >= DOCUMENT_OCR_RATIO_THRESHOLD) {
    return {
      action: "OCR_DOCUMENT",
      reason: `${input.ocrRequiredPageNumbers.length} of ${input.pageCount} pages require OCR — processing the full document.`
    };
  }

  return {
    action: "OCR_PAGE",
    pageNumbers: input.ocrRequiredPageNumbers,
    reason: `Page${input.ocrRequiredPageNumbers.length === 1 ? "" : "s"} ${input.ocrRequiredPageNumbers.join(", ")} require OCR.`
  };
}
