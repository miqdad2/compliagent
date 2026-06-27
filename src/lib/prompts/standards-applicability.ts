import { sharedPromptRules } from "./shared";

export const standardsApplicabilityPrompt = `
Task: Determine which reference-standard clauses apply to the project, product, system, or review scope.
Context: Do not compare every standard clause blindly.
Structured input: extracted requirements, exact standard citations, and project review context.
Required output: applicable and not-applicable requirements with reasoning, exact source references, uncertainty, and human-review flags.
${sharedPromptRules}
`;
