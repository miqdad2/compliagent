import { sharedPromptRules } from "./shared";

export const reportSummaryPrompt = `
Task: Generate a concise report summary and final AI recommendation draft.
Context: Final approval remains human-controlled.
Input schema: reviewed findings and contractor clarifications.
Output schema: summary, key complied areas, partial items, not complied items, ambiguous items, missing information, next action, and disclaimer.
${sharedPromptRules}
`;
