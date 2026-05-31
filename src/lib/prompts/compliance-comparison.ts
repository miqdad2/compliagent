import { sharedPromptRules } from "./shared";

export const complianceComparisonPrompt = `
Task: Compare each requirement against submitted evidence and assign a conservative compliance status.
Context: Statuses are Complied, Partially Complied, Not Complied, Ambiguous / Not Proven, Not Applicable, and Not Verified.
Input schema: extracted requirements, extracted evidence, project context.
Output schema: compliance findings with status, reasoning, missing information, contractor action, weightage, confidence, risk, and human-review flag.
${sharedPromptRules}
`;
