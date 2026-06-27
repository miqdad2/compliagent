import { sharedPromptRules } from "./shared";

export const reviewerCheckPrompt = `
Legacy task: Validate paragraph-level draft findings before display.
Context: This prompt remains for compatibility. New condition-level reviews use findingVerificationPrompt and a separate verifier run.
Structured input: legacy compliance findings and their cited sources.
Required output: corrected legacy findings with conservative status and human-review flags.
${sharedPromptRules}
`;
