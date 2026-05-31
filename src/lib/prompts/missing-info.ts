import { sharedPromptRules } from "./shared";

export const missingInfoPrompt = `
Task: Generate contractor clarification points from partially complied, ambiguous, not proven, not verified, and not complied findings.
Context: The output should request specific missing documents, calculations, certificates, drawings, or confirmations.
Input schema: compliance findings.
Output schema: clarification items with related clause, issue, why it matters, required action, required document, and priority.
${sharedPromptRules}
`;
