import { sharedPromptRules } from "./shared";

export const documentClassifierPrompt = `
Task: Classify an uploaded technical review document.
Context: The platform supports many disciplines and must not assume a single domain.
Input schema: file name, MIME type, optional extracted sample text.
Output schema: document_role_suggestion, document_type, language, ocr_required, contains_tables, contains_drawings, contains_certificates, confidence.
${sharedPromptRules}
`;
