/**
 * Deterministic mock OCR provider for tests and development.
 *
 * Makes no external requests. Behavior is controlled by `MockOcrScenario`.
 * Malformed-coordinate scenarios intentionally produce coordinates that
 * fail normalized-box validation — callers must validate OCR output.
 */

import type { OcrInput, OcrLine, OcrResult, OcrProvider } from "./provider";
import { OcrProviderError } from "./provider";

export type MockOcrScenario =
  | "success"
  | "low_confidence"
  | "empty_result"
  | "malformed_coordinates"
  | "timeout"
  | "provider_failure"
  | "mixed_confidence";

const MOCK_PROVIDER_NAME = "mock-ocr-v1";
const MOCK_ENGINE_VERSION = "mock-1.0.0";

export class MockOcrProvider implements OcrProvider {
  readonly name = MOCK_PROVIDER_NAME;

  constructor(private readonly scenario: MockOcrScenario = "success") {}

  supports(input: OcrInput): boolean {
    return input.imageMimeType === "image/png" || input.imageMimeType === "image/jpeg";
  }

  async recognize(input: OcrInput): Promise<OcrResult> {
    switch (this.scenario) {
      case "timeout":
        throw new OcrProviderError({
          code: "timeout",
          message: "OCR timed out after the configured limit.",
          retryable: true
        });

      case "provider_failure":
        throw new OcrProviderError({
          code: "provider_failure",
          message: "Mock OCR provider failed.",
          retryable: true
        });

      case "empty_result":
        return this.buildResult(input, "", [], 0.0);

      case "low_confidence":
        return this.buildResult(
          input,
          "low quality text",
          [
            {
              text: "low",
              confidence: 0.3,
              words: [{ text: "low", confidence: 0.3 }]
            },
            {
              text: "quality text",
              confidence: 0.25,
              words: [
                { text: "quality", confidence: 0.25 },
                { text: "text", confidence: 0.28 }
              ]
            }
          ],
          0.28
        );

      case "malformed_coordinates": {
        const malformedLines: OcrLine[] = [
          {
            text: "sample text",
            confidence: 0.95,
            words: [
              {
                text: "sample",
                confidence: 0.95,
                boundingBox: { x: -0.5, y: -0.1, width: 2.0, height: 0.05, coordinateSystem: "normalized" as const }
              }
            ]
          }
        ];
        return this.buildResult(input, "sample text", malformedLines, 0.95);
      }

      case "mixed_confidence":
        return this.buildResult(
          input,
          "high low mixed",
          [
            { text: "high", confidence: 0.98, words: [{ text: "high", confidence: 0.98 }] },
            { text: "low", confidence: 0.2, words: [{ text: "low", confidence: 0.2 }] },
            { text: "mixed", confidence: 0.75, words: [{ text: "mixed", confidence: 0.75 }] }
          ],
          0.64
        );

      case "success":
      default:
        return this.buildResult(
          input,
          "extracted text from mock OCR",
          [
            {
              text: "extracted text from mock OCR",
              confidence: 0.97,
              words: [
                { text: "extracted", confidence: 0.97 },
                { text: "text", confidence: 0.98 },
                { text: "from", confidence: 0.99 },
                { text: "mock", confidence: 0.97 },
                { text: "OCR", confidence: 0.96 }
              ]
            }
          ],
          0.97
        );
    }
  }

  private buildResult(
    input: OcrInput,
    text: string,
    lines: OcrLine[],
    confidence: number
  ): OcrResult {
    const words = lines.flatMap((line) => line.words);
    return {
      pageNumber: input.pageNumber,
      text,
      lines,
      words,
      confidence,
      pageWidth: input.pageWidth,
      pageHeight: input.pageHeight,
      warnings: confidence < 0.3 ? ["Low-confidence OCR result."] : [],
      provider: MOCK_PROVIDER_NAME,
      engineVersion: MOCK_ENGINE_VERSION,
      durationMs: 5
    };
  }
}
