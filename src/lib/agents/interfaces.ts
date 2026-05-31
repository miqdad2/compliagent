import type { DocumentChunk } from "@/lib/documents/chunking";
import type {
  ComplianceFindingOutput,
  ContractorClarificationOutput,
  DocumentClassification,
  ExtractedEvidence,
  ExtractedRequirement
} from "./schemas";

export type AgentContext = {
  projectId: string;
  documentId?: string;
  reviewType: string;
  discipline: string;
};

export type DocumentClassifierAgent = {
  classify(input: { fileName: string; mimeType: string; sampleText?: string }): Promise<DocumentClassification>;
};

export type ClauseExtractionAgent = {
  extractRequirements(context: AgentContext, chunks: DocumentChunk[]): Promise<ExtractedRequirement[]>;
};

export type TechnicalDataExtractionAgent = {
  extractEvidence(context: AgentContext, chunks: DocumentChunk[]): Promise<ExtractedEvidence[]>;
};

export type StandardsApplicabilityAgent = {
  determineApplicableRequirements(
    context: AgentContext,
    requirements: ExtractedRequirement[]
  ): Promise<ExtractedRequirement[]>;
};

export type ComplianceComparisonAgent = {
  compare(
    context: AgentContext,
    requirements: ExtractedRequirement[],
    evidence: ExtractedEvidence[]
  ): Promise<ComplianceFindingOutput[]>;
};

export type MissingInformationAgent = {
  createClarifications(findings: ComplianceFindingOutput[]): Promise<ContractorClarificationOutput[]>;
};

export type ReviewerAgent = {
  validateFindings(findings: ComplianceFindingOutput[]): Promise<ComplianceFindingOutput[]>;
};
