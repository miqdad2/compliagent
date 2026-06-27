/**
 * Provider-neutral OCR interface.
 *
 * All OCR execution is server-only. No adapter may call fetch, a provider
 * SDK, or any external transport without explicit organization consent and
 * provider configuration. This unit ships with the mock provider only.
 */

export type OcrLanguageHint = string;

export type OcrLayoutMode = "text" | "document" | "sparse" | "single_line";

export interface OcrBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateSystem: "pixels" | "normalized";
}

export interface OcrWord {
  text: string;
  confidence: number;
  boundingBox?: OcrBoundingBox;
}

export interface OcrLine {
  text: string;
  confidence: number;
  words: OcrWord[];
  boundingBox?: OcrBoundingBox;
}

export interface OcrInput {
  pageNumber: number;
  imageBuffer: Buffer;
  imageMimeType: "image/png" | "image/jpeg";
  pageWidth?: number;
  pageHeight?: number;
  languageHints?: OcrLanguageHint[];
  layoutMode?: OcrLayoutMode;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface OcrResult {
  pageNumber: number;
  text: string;
  lines: OcrLine[];
  words: OcrWord[];
  confidence: number;
  pageWidth?: number;
  pageHeight?: number;
  warnings: string[];
  provider: string;
  engineVersion?: string;
  durationMs: number;
}

export type OcrErrorCode =
  | "timeout"
  | "provider_failure"
  | "invalid_image"
  | "low_confidence"
  | "empty_result"
  | "malformed_coordinates"
  | "unsupported_input";

export class OcrProviderError extends Error {
  readonly code: OcrErrorCode;
  readonly retryable: boolean;

  constructor(input: { code: OcrErrorCode; message: string; retryable: boolean; cause?: unknown }) {
    super(input.message, { cause: input.cause });
    this.name = "OcrProviderError";
    this.code = input.code;
    this.retryable = input.retryable;
  }
}

export interface OcrProvider {
  readonly name: string;
  supports(input: OcrInput): boolean;
  recognize(input: OcrInput): Promise<OcrResult>;
}
