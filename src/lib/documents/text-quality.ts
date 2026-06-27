import { normalizeDocumentText } from "./chunking";
import type { ExtractionQualityResult, PageQualityResult, QualityClassification } from "./layout-types";

// ============================================================
// Existing single-page quality check (backward-compatible)
// ============================================================

export type TextQuality = {
  confidence: number;
  sufficient: boolean;
  normalizedText: string;
};

export function assessNativeTextQuality(text: string): TextQuality {
  const normalizedText = normalizeDocumentText(text);
  if (!normalizedText) {
    return { confidence: 0, sufficient: false, normalizedText };
  }

  const alphaNumericCharacters = normalizedText.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const replacementCharacters = normalizedText.match(/�/g)?.length ?? 0;
  const words = normalizedText.split(/\s+/).filter(Boolean);
  const alphaNumericRatio = alphaNumericCharacters / normalizedText.length;
  const replacementRatio = replacementCharacters / normalizedText.length;

  if (normalizedText.length < 20 || words.length < 3 || alphaNumericRatio < 0.3 || replacementRatio > 0.02) {
    return { confidence: 0.25, sufficient: false, normalizedText };
  }

  if (normalizedText.length < 40 || words.length < 5 || alphaNumericRatio < 0.45) {
    return { confidence: 0.6, sufficient: true, normalizedText };
  }

  return { confidence: 0.95, sufficient: true, normalizedText };
}

// ============================================================
// Page-level quality assessment
// ============================================================

/** Minimum average characters per page for a "good" document. */
const MIN_CHARS_PER_PAGE_GOOD = 100;
/** Maximum acceptable replacement-character ratio. */
const MAX_REPLACEMENT_RATIO = 0.02;
/** Maximum acceptable control-character ratio (excludes \n \r \t). */
const MAX_CONTROL_CHAR_RATIO = 0.05;

export function assessPageQuality(
  pageNumber: number,
  text: string
): PageQualityResult {
  const normalized = normalizeDocumentText(text);
  const charCount = normalized.length;
  const words = normalized.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const isEmpty = charCount === 0;

  const replacementChars = (text.match(/�/g) ?? []).length;
  const controlChars = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g) ?? []).length;
  const alphaNumericChars = (normalized.match(/[\p{L}\p{N}]/gu) ?? []).length;

  const hasReplacementChars = charCount > 0 && replacementChars / charCount > MAX_REPLACEMENT_RATIO;
  const hasControlChars = charCount > 0 && controlChars / charCount > MAX_CONTROL_CHAR_RATIO;
  const hasLowAlphaNumeric = charCount > 0 && alphaNumericChars / charCount < 0.3;

  const reasons: string[] = [];
  let score: number;
  let classification: QualityClassification;
  let requiresOcr: boolean;

  if (isEmpty) {
    reasons.push("Page has no extractable text.");
    score = 0;
    classification = "unusable";
    requiresOcr = true;
  } else if (hasReplacementChars) {
    reasons.push("Page contains replacement characters indicating encoding corruption.");
    score = 0.2;
    classification = "weak";
    requiresOcr = true;
  } else if (hasControlChars) {
    reasons.push("Page contains unexpected control characters.");
    score = 0.3;
    classification = "weak";
    requiresOcr = true;
  } else if (hasLowAlphaNumeric) {
    reasons.push("Page text has very low alphanumeric density — likely image-only or garbled.");
    score = 0.1;
    classification = "unusable";
    requiresOcr = true;
  } else if (wordCount < 3 || charCount < 20) {
    reasons.push("Page has insufficient text for reliable extraction.");
    score = 0.25;
    classification = "weak";
    requiresOcr = true;
  } else if (charCount < MIN_CHARS_PER_PAGE_GOOD || wordCount < 10) {
    reasons.push("Page has limited text.");
    score = 0.6;
    classification = "good";
    requiresOcr = false;
  } else {
    score = 0.95;
    classification = "excellent";
    requiresOcr = false;
  }

  return {
    pageNumber,
    score,
    classification,
    requiresOcr,
    reasons,
    charCount,
    wordCount,
    isEmpty,
    hasReplacementChars,
    hasControlChars
  };
}

// ============================================================
// Document-level quality assessment
// ============================================================

export function assessExtractionQuality(
  pageTexts: Array<{ pageNumber: number; text: string }>
): ExtractionQualityResult {
  if (pageTexts.length === 0) {
    return {
      score: 0,
      classification: "unusable",
      requiresOcr: true,
      reasons: ["No pages were extracted."],
      pageResults: []
    };
  }

  const pageResults = pageTexts.map(({ pageNumber, text }) =>
    assessPageQuality(pageNumber, text)
  );

  const totalScore = pageResults.reduce((sum, p) => sum + p.score, 0);
  const averageScore = totalScore / pageResults.length;
  const emptyPageCount = pageResults.filter((p) => p.isEmpty).length;
  const ocrRequiredCount = pageResults.filter((p) => p.requiresOcr).length;
  const emptyRatio = emptyPageCount / pageResults.length;

  const reasons: string[] = [];
  let classification: QualityClassification;
  let requiresOcr: boolean;

  if (emptyRatio >= 0.5 || averageScore < 0.2) {
    classification = "unusable";
    requiresOcr = true;
    if (emptyRatio >= 0.5) reasons.push(`${emptyPageCount} of ${pageResults.length} pages have no extractable text.`);
    if (averageScore < 0.2) reasons.push("Average page quality score is critically low.");
  } else if (ocrRequiredCount > 0 || averageScore < 0.6) {
    classification = "weak";
    requiresOcr = ocrRequiredCount > 0;
    if (ocrRequiredCount > 0)
      reasons.push(`${ocrRequiredCount} page${ocrRequiredCount === 1 ? "" : "s"} require OCR.`);
    if (averageScore < 0.6) reasons.push("Average page quality is below the reliable threshold.");
  } else if (averageScore < 0.9) {
    classification = "good";
    requiresOcr = false;
    reasons.push("All pages extracted successfully with acceptable quality.");
  } else {
    classification = "excellent";
    requiresOcr = false;
  }

  return {
    score: Math.round(averageScore * 1000) / 1000,
    classification,
    requiresOcr,
    reasons,
    pageResults
  };
}
