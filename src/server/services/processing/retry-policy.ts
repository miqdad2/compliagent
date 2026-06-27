import { DocumentExtractionError } from "@/lib/documents/extraction-errors";

export const DEFAULT_MAX_ATTEMPTS = 4;

/** Exponential backoff in seconds: attempt 1→60s, 2→300s, 3→900s, 4→3600s */
export function calculateBackoffSeconds(attempt: number): number {
  const schedule = [60, 300, 900, 3600];
  return schedule[Math.min(attempt - 1, schedule.length - 1)] ?? 3600;
}

export type ErrorClassification = {
  retryable: boolean;
  errorCode: string;
  safeMessage: string;
};

/**
 * Classifies an extraction-related error as retryable or non-retryable.
 * Non-retryable errors are caused by the document itself (bad file, unsupported
 * type, encryption). Retryable errors are caused by transient infrastructure issues.
 */
export function classifyError(error: unknown): ErrorClassification {
  if (error instanceof DocumentExtractionError) {
    return {
      retryable: error.retryable,
      errorCode: error.code,
      safeMessage: error.message
    };
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (/timeout|timed out|econnreset|socket/i.test(message)) {
      return {
        retryable: true,
        errorCode: "transient_io_error",
        safeMessage: "A transient I/O error occurred during document processing. Retry is scheduled."
      };
    }

    if (/memory|heap|out of/i.test(message)) {
      return {
        retryable: true,
        errorCode: "resource_exhaustion",
        safeMessage: "Processing failed due to resource exhaustion. Retry is scheduled."
      };
    }
  }

  return {
    retryable: true,
    errorCode: "native_extraction_failed",
    safeMessage: "Native text extraction failed. Retry is scheduled; if failure persists, verify the source file."
  };
}

/** Returns true if a job should be retried based on the error and attempt count. */
export function shouldRetry(errorClassification: ErrorClassification, attempts: number, maximumAttempts: number): boolean {
  return errorClassification.retryable && attempts < maximumAttempts;
}
