import type { RequirementRow, ChunkRow, DiscoveredRequirement } from "./types";

/** Mandatory-language patterns used to detect requirements in unstructured text. */
const MANDATORY_PATTERNS = [
  /\bshall\b/i,
  /\bmust\b/i,
  /\bshall not\b/i,
  /\bis required\b/i,
  /\bis to\b/i,
  /\brequired to\b/i,
  /\brequires\b/i
];

/** Clause-number pattern supporting forms like "2.2.1", "A.1", "A.1(b)", "3.4.2.1".
 *  Captures only the alphanumeric dotted portion, not trailing parentheticals. */
const CLAUSE_NUMBER_PATTERN = /^((?:[A-Z]+\.)?[0-9]+(?:\.[0-9]+)*)/;

/** Returns true when the text contains at least one mandatory-language trigger. */
export function hasMandatoryLanguage(text: string): boolean {
  return MANDATORY_PATTERNS.some((re) => re.test(text));
}

/** Extract a leading clause number from a chunk heading or text, if present. */
export function extractLeadingClauseNumber(text: string): string | null {
  const match = CLAUSE_NUMBER_PATTERN.exec(text.trim());
  return match ? match[1] : null;
}

/**
 * RequirementDiscoveryService uses two sources:
 *
 * 1. Primary — existing `extracted_requirements` rows from specification-role
 *    documents (populated during the extraction pipeline).
 * 2. Fallback — scans document chunks for mandatory language when no pre-extracted
 *    requirements exist for a given document.
 *
 * This service never fabricates requirement text; all returned items come from
 * stored extraction data.
 */
export class RequirementDiscoveryService {
  /**
   * Map pre-extracted requirements to the lightweight DiscoveredRequirement shape.
   * Used when `extracted_requirements` rows already exist for a project.
   */
  fromExtracted(rows: RequirementRow[]): DiscoveredRequirement[] {
    return rows.map((r) => ({
      requirementId:       r.id,
      projectId:           r.project_id,
      sourceDocumentId:    r.source_document_id,
      pageNumber:          r.page_number,
      clauseNumber:        r.clause_number ?? null,
      subClauseNumber:     r.sub_clause_number ?? null,
      requirementText:     r.requirement_text,
      mandatoryLevel:      r.mandatory_level ?? null,
      extractionConfidence: r.extraction_confidence
    }));
  }

  /**
   * Scan document chunks for mandatory language when no extracted requirements
   * are available for the given document IDs.
   *
   * Only returns chunks that contain at least one mandatory-language trigger.
   * Each matching chunk yields one DiscoveredRequirement using the chunk's
   * clause_number, page_number, and normalized_text.
   *
   * NOTE: these provisional requirements must be stored in `extracted_requirements`
   * by the caller before being used downstream — this service does not persist.
   */
  discoverFromChunks(
    chunks: ChunkRow[],
    projectId: string,
    documentIdsWithoutRequirements: string[]
  ): Array<Omit<DiscoveredRequirement, "requirementId">> {
    const relevant = chunks.filter(
      (c) =>
        documentIdsWithoutRequirements.includes(c.document_id) &&
        hasMandatoryLanguage(c.normalized_text ?? c.chunk_text)
    );

    return relevant.map((c) => ({
      projectId,
      sourceDocumentId:    c.document_id,
      pageNumber:          c.page_number,
      clauseNumber:        c.clause_number ?? extractLeadingClauseNumber(c.section_heading ?? "") ?? null,
      subClauseNumber:     null,
      requirementText:     c.normalized_text ?? c.chunk_text,
      mandatoryLevel:      "provisional",
      extractionConfidence: Math.round((c.metadata as Record<string, number>)?.confidence ?? 60)
    }));
  }

  /**
   * Filter discovered requirements to those that should be checked:
   * - mandatory_level is "mandatory" or "provisional" (not purely informative)
   * - Non-empty requirement text
   */
  filterCheckable(discovered: DiscoveredRequirement[]): DiscoveredRequirement[] {
    return discovered.filter(
      (d) =>
        d.requirementText.trim().length > 0 &&
        (d.mandatoryLevel === null ||
          d.mandatoryLevel === "mandatory" ||
          d.mandatoryLevel === "provisional" ||
          hasMandatoryLanguage(d.requirementText))
    );
  }
}
