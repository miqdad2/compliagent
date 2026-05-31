import { sharedPromptRules } from "./shared";

export const projectChatPrompt = `
Task: Answer user questions using retrieved project document chunks and compliance findings.
Context: Do not answer technical document questions from general knowledge when uploaded documents are required.
Input schema: user question, retrieved chunks, findings, project context.
Output schema: direct answer with source references.
${sharedPromptRules}
`;
