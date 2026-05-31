import type {
  ClauseExtractionAgent,
  ComplianceComparisonAgent,
  MissingInformationAgent,
  ReviewerAgent,
  StandardsApplicabilityAgent,
  TechnicalDataExtractionAgent,
  AgentContext
} from "./interfaces";
import type { DocumentChunk } from "@/lib/documents/chunking";

export type ReviewPipelineAgents = {
  clauseExtraction: ClauseExtractionAgent;
  technicalDataExtraction: TechnicalDataExtractionAgent;
  standardsApplicability: StandardsApplicabilityAgent;
  complianceComparison: ComplianceComparisonAgent;
  missingInformation: MissingInformationAgent;
  reviewer: ReviewerAgent;
};

export async function runReviewPipeline(context: AgentContext, chunks: DocumentChunk[], agents: ReviewPipelineAgents) {
  const requirements = await agents.clauseExtraction.extractRequirements(context, chunks);
  const evidence = await agents.technicalDataExtraction.extractEvidence(context, chunks);
  const applicableRequirements = await agents.standardsApplicability.determineApplicableRequirements(
    context,
    requirements
  );
  const draftFindings = await agents.complianceComparison.compare(context, applicableRequirements, evidence);
  const reviewedFindings = await agents.reviewer.validateFindings(draftFindings);
  const clarifications = await agents.missingInformation.createClarifications(reviewedFindings);

  return {
    requirements: applicableRequirements,
    evidence,
    findings: reviewedFindings,
    clarifications
  };
}
