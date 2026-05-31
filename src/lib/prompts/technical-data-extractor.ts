import { sharedPromptRules } from "./shared";

export const technicalDataExtractorPrompt = `
Task: Extract technical evidence from submissions, datasheets, certificates, manuals, drawings and supporting evidence.
Context: Evidence may be functional, technical, numeric, certification-based, or installation-dependent.
Input schema: source-preserving document chunks.
Output schema: array of extracted evidence items with source references and extraction confidence.
${sharedPromptRules}
`;
