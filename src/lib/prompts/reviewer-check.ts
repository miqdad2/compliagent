import { sharedPromptRules } from "./shared";

export const reviewerCheckPrompt = `
Task: Validate AI draft findings before they are shown as compliance output.
Context: Reject unsupported assumptions, missing citations, invalid numeric comparisons, invented standards, or unsafe conclusions.
Input schema: compliance findings.
Output schema: corrected compliance findings with conservative status and human-review flags.
${sharedPromptRules}
`;
