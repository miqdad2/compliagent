import { sharedPromptRules } from "./shared";

export const complianceComparisonPrompt = `
Task: Legacy clause-level comparison for requirements that do not yet have decomposed conditions.
Constraint: When requirement conditions exist, use condition-level comparison instead. Never assign the parent clause status independently.
Context: Statuses are Complied, Partially Complied, Not Complied, Ambiguous, Not Proven, Exceeds Requirement, Not Applicable, and Not Verified.
Input schema: extracted requirements without condition rows, extracted evidence, project context.
Output schema: draft compliance findings with status, reasoning, missing information, contractor action, weightage, confidence, risk, and human-review flag.
${sharedPromptRules}
`;
