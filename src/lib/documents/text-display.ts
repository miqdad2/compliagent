/**
 * Display-only text normalization for extracted document text.
 *
 * These transforms apply ONLY when rendering text in the UI.
 * The stored text in the database is NEVER modified.
 *
 * Artifacts come from PDF/OCR extraction: Unicode substitutions,
 * encoding errors in list markers, and whitespace collisions.
 */

// Map of artifact patterns to their display replacement.
const ARTIFACT_REPLACEMENTS: Array<[RegExp, string]> = [
  // "u " at line start is a malformed "•" bullet from certain PDF encodings.
  [/^u\s+/gm, "• "],
  // "l " at line start is another bullet artifact (Wingdings/Symbol font).
  [/^l\s+/gm, "• "],
  // Ÿ is sometimes an em-dash artifact.
  [/Ÿ/g, "—"],
  // Non-breaking hyphens displayed as box characters.
  [/�/g, "-"],
  // Multiple spaces to single.
  [/ {2,}/g, " "],
  // Collapse more-than-one blank line into exactly one.
  [/\n{3,}/g, "\n\n"]
];

/**
 * Normalize extracted text for display only.
 * Never call this on text that will be written back to the database.
 */
export function normalizeDisplayText(text: string | null | undefined): string {
  if (!text) return "";
  let result = text;
  for (const [pattern, replacement] of ARTIFACT_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result.trim();
}
