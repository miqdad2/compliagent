import type { ChunkRow, EvidenceRegionRow, RetrievedEvidence, EvidenceSufficiency } from "./types";
import type { RequirementConditionRow } from "@/server/services/compliance/gateway";
import type { RetrievalResult } from "@/lib/ai/schemas";

/** Numeric value pattern — captures a decimal or integer with optional unit. */
const NUMERIC_PATTERN = /(\d+(?:\.\d+)?)\s*([a-zA-Z"'\-/]+)?/g;

/** Normalise text for keyword matching: lower-case, collapse whitespace. */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Extract all numeric values found in text. */
function extractNumbers(text: string): number[] {
  const values: number[] = [];
  let m: RegExpExecArray | null;
  NUMERIC_PATTERN.lastIndex = 0;
  while ((m = NUMERIC_PATTERN.exec(text)) !== null) {
    const v = parseFloat(m[1]);
    if (!isNaN(v)) values.push(v);
  }
  return values;
}

/** Score how well a single chunk matches a condition's expected text/value. */
function scoreChunk(
  chunk: ChunkRow,
  condition: RequirementConditionRow
): { keywordScore: number; numericScore: number; exactMatch: boolean } {
  const haystack = normalise(chunk.normalized_text ?? chunk.chunk_text);

  // Exact phrase match.
  const needle =
    condition.expected_text !== null ? normalise(condition.expected_text) : normalise(condition.attribute);
  const exactMatch = haystack.includes(needle);

  // Keyword scoring: how many significant words from the condition appear.
  const keywords = needle
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["that", "with", "from", "this", "have", "shall"].includes(w));
  const keywordHits = keywords.filter((kw) => haystack.includes(kw)).length;
  const keywordScore = keywords.length > 0 ? keywordHits / keywords.length : 0;

  // Numeric score: does the chunk contain the expected numeric value?
  let numericScore = 0;
  if (condition.expected_numeric_value !== null) {
    const nums = extractNumbers(haystack);
    if (nums.some((n) => Math.abs(n - condition.expected_numeric_value!) < 0.01)) {
      numericScore = 1;
    }
  } else if (condition.expected_min_value !== null || condition.expected_max_value !== null) {
    const nums = extractNumbers(haystack);
    const min = condition.expected_min_value ?? -Infinity;
    const max = condition.expected_max_value ?? Infinity;
    if (nums.some((n) => n >= min && n <= max)) numericScore = 0.8;
  }

  return { keywordScore, numericScore, exactMatch };
}

/** Classify evidence sufficiency from the top retrieval score. */
function classifySufficiency(
  topKeyword: number,
  topNumeric: number,
  exactFound: boolean,
  hasEvidence: boolean
): EvidenceSufficiency {
  if (!hasEvidence) return "irrelevant";
  if (exactFound) return "direct";
  if (topKeyword >= 0.8 || topNumeric >= 0.8) return "partial";
  if (topKeyword >= 0.4) return "contextual";
  return "irrelevant";
}

/**
 * EvidenceRetrievalService performs hybrid evidence search over document chunks
 * and evidence regions for a given condition.
 *
 * Strategy (in priority order):
 * 1. Exact phrase match in normalized chunk text
 * 2. Numeric value match (condition.expected_numeric_value or range)
 * 3. Keyword co-occurrence score across significant terms
 * 4. Evidence regions already tagged to the document
 *
 * Does not perform semantic (embedding) search — that is a future step when
 * the embedding_generation job is complete.
 *
 * Never invents quotes or fabricates evidence.
 */
export class EvidenceRetrievalService {
  /**
   * Retrieve evidence for a single condition from pre-loaded chunks and regions.
   *
   * @param condition  The requirement condition to search for.
   * @param submissionChunks  Chunks from submission documents.
   * @param evidenceRegions   Pre-loaded evidence regions (optional, for region-linked results).
   * @param submissionDocumentIds  IDs of documents that are submission-role.
   */
  retrieve(
    condition: RequirementConditionRow,
    submissionChunks: ChunkRow[],
    evidenceRegions: EvidenceRegionRow[],
    submissionDocumentIds: string[]
  ): RetrievedEvidence {
    const relevantChunks = submissionChunks.filter((c) =>
      submissionDocumentIds.includes(c.document_id)
    );

    type ScoredChunk = {
      chunk: ChunkRow;
      keywordScore: number;
      numericScore: number;
      exactMatch: boolean;
      compositeScore: number;
    };

    const scored: ScoredChunk[] = relevantChunks.map((chunk) => {
      const scores = scoreChunk(chunk, condition);
      const composite =
        (scores.exactMatch ? 1.0 : 0) * 0.5 +
        scores.keywordScore * 0.3 +
        scores.numericScore * 0.2;
      return { chunk, ...scores, compositeScore: composite };
    });

    scored.sort((a, b) => b.compositeScore - a.compositeScore);
    // Minimum threshold of 0.15 to exclude chunks that only share incidental keywords.
    // Score breakdown: exactMatch*0.5 + keywordScore*0.3 + numericScore*0.2.
    // A score < 0.15 means no exact match and fewer than half of meaningful keywords hit.
    const top = scored.filter((s) => s.compositeScore >= 0.15).slice(0, 5);

    const retrievalResults: RetrievalResult[] = top.map((s) => {
      // Find a matching evidence region for this chunk's page/document if available.
      const matchingRegion = evidenceRegions.find(
        (r) => r.document_id === s.chunk.document_id && r.page_number === s.chunk.page_number
      );

      return {
        conditionId:          condition.id,
        documentId:           s.chunk.document_id,
        pageNumber:           s.chunk.page_number,
        clauseNumber:         s.chunk.clause_number,
        regionId:             matchingRegion?.id ?? `chunk:${s.chunk.document_id}:${s.chunk.page_number}`,
        exactQuote:           extractExactQuote(s.chunk, condition),
        evidenceType:         s.exactMatch ? "exact_phrase" : s.numericScore > 0 ? "numeric_value" : "keyword",
        semanticScore:        0,  // Placeholder — pgvector search not yet implemented.
        keywordScore:         s.keywordScore,
        retrievalConfidence:  Math.round(s.compositeScore * 100),
        extractionConfidence: 80,
        relationshipType:     s.exactMatch || s.compositeScore >= 0.5 ? "supports" : "contextual"
      };
    });

    const topKeyword = top[0]?.keywordScore ?? 0;
    const topNumeric = top[0]?.numericScore ?? 0;
    const exactFound = top.some((s) => s.exactMatch);
    const sufficiency = classifySufficiency(topKeyword, topNumeric, exactFound, top.length > 0);

    const primaryRegion = retrievalResults[0]
      ? evidenceRegions.find((r) => r.id === retrievalResults[0].regionId) ?? null
      : null;

    return {
      conditionId:     condition.id,
      retrievalResults,
      sufficiency,
      primaryQuote:    retrievalResults[0]?.exactQuote ?? null,
      primaryRegionId: primaryRegion?.id ?? null
    };
  }
}

/**
 * Extract a concise quote from a chunk that best represents the evidence for
 * the condition.  Returns the first sentence that contains the expected text
 * or the first 200 characters of the chunk.
 */
function extractExactQuote(chunk: ChunkRow, condition: RequirementConditionRow): string {
  const text = chunk.normalized_text ?? chunk.chunk_text;
  const needle =
    condition.expected_text !== null
      ? normalise(condition.expected_text)
      : normalise(condition.attribute);

  const sentences = text.split(/(?<=[.!?])\s+/);
  const hit = sentences.find((s) => normalise(s).includes(needle));
  if (hit) return hit.slice(0, 400).trim();
  return text.slice(0, 200).trim();
}
