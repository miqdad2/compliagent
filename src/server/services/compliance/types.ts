export const serviceErrorCodes = [
  "REQUIREMENT_NOT_FOUND",
  "CONDITION_NOT_FOUND",
  "EVALUATION_NOT_FOUND",
  "FINDING_NOT_FOUND",
  "EVIDENCE_REGION_NOT_FOUND",
  "ORGANIZATION_ACCESS_DENIED",
  "PROJECT_ACCESS_DENIED",
  "REVIEW_ACCESS_DENIED",
  "CROSS_PROJECT_LINK_DENIED",
  "CROSS_ORGANIZATION_LINK_DENIED",
  "HUMAN_APPROVAL_PROTECTED",
  "DUPLICATE_CONDITION",
  "DUPLICATE_EVIDENCE_LINK",
  "INVALID_CONDITION",
  "INVALID_EVALUATION",
  "TRANSACTION_FAILED"
] as const;

export type ServiceErrorCode = (typeof serviceErrorCodes)[number];

export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; errorCode: ServiceErrorCode; message: string; retryable: boolean };

export function ok<T>(data: T): ServiceResult<T> {
  return { success: true, data };
}

export function fail<T>(
  errorCode: ServiceErrorCode,
  message: string,
  retryable = false
): ServiceResult<T> {
  return { success: false, errorCode, message, retryable };
}
