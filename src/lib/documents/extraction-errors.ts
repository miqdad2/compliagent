export const extractionErrorCodes = [
  "unsupported_file_type",
  "invalid_file",
  "encrypted_pdf",
  "native_extraction_failed"
] as const;

export type ExtractionErrorCode = (typeof extractionErrorCodes)[number];

export class DocumentExtractionError extends Error {
  readonly code: ExtractionErrorCode;
  readonly retryable: boolean;

  constructor(input: { code: ExtractionErrorCode; message: string; retryable: boolean; cause?: unknown }) {
    super(input.message, { cause: input.cause });
    this.name = "DocumentExtractionError";
    this.code = input.code;
    this.retryable = input.retryable;
  }
}

export function normalizeExtractionError(error: unknown) {
  if (error instanceof DocumentExtractionError) {
    return error;
  }

  const technicalMessage = error instanceof Error ? error.message : "Unknown extraction error";

  if (/password|encrypted|encryption/i.test(technicalMessage)) {
    return new DocumentExtractionError({
      code: "encrypted_pdf",
      message: "The PDF is encrypted. Upload an unlocked copy and retry extraction.",
      retryable: false,
      cause: error
    });
  }

  if (/invalid|corrupt|central directory|zip|format|header/i.test(technicalMessage)) {
    return new DocumentExtractionError({
      code: "invalid_file",
      message: "The document could not be read. Upload a valid, uncorrupted copy and retry.",
      retryable: false,
      cause: error
    });
  }

  return new DocumentExtractionError({
    code: "native_extraction_failed",
    message: "Native text extraction failed. Retry processing; if it fails again, verify the source file.",
    retryable: true,
    cause: error
  });
}
