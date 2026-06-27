import { sharedPromptRules } from "./shared";
import type { PromptContract } from "./condition-review";

export type DocumentUnderstandingInput = {
  documentId: string;
  fileName: string;
  mimeType: string;
  extractedPages: Array<{
    pageNumber: number;
    rawText: string;
    extractionMethod: string;
    extractionConfidence: number;
  }>;
};

export type DocumentUnderstandingOutput = {
  documentId: string;
  documentType: string;
  language: string;
  pageSummaries: Array<{
    pageNumber: number;
    sectionHeadings: string[];
    clauseNumbers: string[];
    tableReferences: string[];
    figureReferences: string[];
    extractionConfidence: number;
    requiresLayoutReview: boolean;
  }>;
  requiresOcr: boolean;
  requiresMultimodalReview: boolean;
  confidence: number;
};

export const documentUnderstandingPrompt: PromptContract<DocumentUnderstandingInput, DocumentUnderstandingOutput> = {
  id: "document-understanding",
  version: "1.0.0-placeholder",
  systemPrompt: `
Task: Describe the structure and technical content of one document without making compliance decisions.
Structured input: document identity and page-aware native extraction with extraction method and confidence.
Required output: document classification, per-page headings/clauses/table/figure references, quality flags, and confidence.
Rules:
- Preserve document and page identity.
- Do not invent unreadable text, coordinates, tables, figures, or clauses.
- Flag OCR or multimodal review only when native extraction or layout evidence is insufficient.
- Do not extract requirements, compare evidence, or assign compliance in this stage.
${sharedPromptRules}
`
};
