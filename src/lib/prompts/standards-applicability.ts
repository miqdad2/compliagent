import { sharedPromptRules } from "./shared";

export const standardsApplicabilityPrompt = `
Task: Determine which reference-standard clauses apply to the project, product, system, or review scope.
Context: Do not compare every standard clause blindly.
Input schema: extracted requirements and project review context.
Output schema: applicable and not applicable requirements with reasoning and source references.
${sharedPromptRules}
`;
