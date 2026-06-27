import { sharedPromptRules } from "./shared";

export const clauseExtractorPrompt = `
Task: Extract clauses, sub-clauses, mandatory wording, values, units, standards references and acceptance criteria. Pass each clause to requirement decomposition before comparison.
Context: Use specification and reference-standard chunks with page metadata.
Input schema: source-preserving document chunks.
Output schema: array of extracted requirements with source references and extraction confidence.
${sharedPromptRules}
`;
