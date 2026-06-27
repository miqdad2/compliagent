/**
 * Semantic evidence reranker.
 *
 * Takes the bounded list of candidate evidence results from the deterministic
 * retrieval stage and asks the AI to classify each candidate's relevance
 * to the specific condition.
 *
 * If AI is unavailable, the original deterministic ordering is preserved
 * (no re-ranking) and the result is flagged.
 *
 * The AI must not generate new evidence — it classifies only the provided candidates.
 */
import type { ChunkRow, RetrievedEvidence, EvidenceSufficiency } from "./types";
import type { RequirementConditionRow } from "@/server/services/compliance/gateway";
import type { RetrievalResult } from "@/lib/ai/schemas";
import type { ConfidenceFlag, EvidenceSufficiencyClass } from "@/lib/ai/review-schemas";
import { evidenceRerankingOutputSchema } from "@/lib/ai/review-schemas";
import { AI_TASK } from "@/lib/ai/tasks";
import { evidenceRerankingPrompt } from "@/lib/prompts/evidence-reranking";
import { hashSafeInputRef, type ControlledAiExecutionService } from "@/server/services/ai/controlled-execution";
import type { AuthProfile } from "@/lib/permissions/server";

export type RerankerContext = {
  actor:          AuthProfile;
  organizationId: string;
  projectId:      string;
  reviewId:       string;
  documentRole:   string;
};

export type RerankedEvidence = {
  evidence:  RetrievedEvidence;
  reranked:  boolean;
  aiRunId:   string | null;
  flags:     ConfidenceFlag[];
};

function sufficiencyFromClass(cls: EvidenceSufficiencyClass): EvidenceSufficiency {
  switch (cls) {
    case "DIRECT":         return "direct";
    case "PARTIAL":        return "partial";
    case "CONTRADICTORY":  return "contradictory";
    case "CONTEXTUAL":     return "contextual";
    case "IRRELEVANT":     return "irrelevant";
    case "UNVERIFIED":     return "unverified";
  }
}

export class EvidenceRerankerService {
  constructor(private readonly executor: ControlledAiExecutionService | null) {}

  async rerank(
    condition: RequirementConditionRow,
    evidence: RetrievedEvidence,
    context: RerankerContext
  ): Promise<RerankedEvidence> {
    if (!this.executor || evidence.retrievalResults.length === 0) {
      return { evidence, reranked: false, aiRunId: null, flags: [] };
    }

    const conditionSummary =
      `${condition.subject} / ${condition.attribute} ${condition.operator} ${condition.expected_text ?? condition.expected_numeric_value ?? ""}`.trim();

    const candidates = evidence.retrievalResults.slice(0, 5).map((r) => ({
      regionId:     r.regionId,
      pageNumber:   r.pageNumber,
      clauseNumber: r.clauseNumber,
      exactQuote:   r.exactQuote.slice(0, 300),
      keywordScore: r.keywordScore
    }));

    const userMessage = JSON.stringify({
      conditionId:      condition.id,
      conditionSummary,
      documentRole:     context.documentRole,
      candidates
    });

    const inputHash = hashSafeInputRef({
      organizationId: context.organizationId,
      projectId:      context.projectId,
      reviewId:       context.reviewId,
      entityId:       condition.id,
      taskType:       AI_TASK.EVIDENCE_RERANKING,
      promptVersion:  evidenceRerankingPrompt.version
    });

    const result = await this.executor.execute({
      actor:                          context.actor,
      organizationId:                 context.organizationId,
      projectId:                      context.projectId,
      reviewId:                       context.reviewId,
      documentId:                     null,
      taskType:                       AI_TASK.EVIDENCE_RERANKING,
      promptVersion:                  evidenceRerankingPrompt.version,
      systemPrompt:                   evidenceRerankingPrompt.systemPrompt,
      input:                          [{ type: "text", text: userMessage }],
      inputHash,
      outputSchema:                   evidenceRerankingOutputSchema,
      outputSchemaName:               "EvidenceRerankingOutput",
      temperature:                    0,
      timeoutMs:                      20_000,
      externalTransmissionRequested:  true,
      multimodalTransmissionRequested: false
    });

    if (!result.ok) {
      return { evidence, reranked: false, aiRunId: null, flags: ["DETERMINISTIC_FALLBACK_USED"] };
    }

    const rerankItems = result.data;
    const flags: ConfidenceFlag[] = ["AI_RERANKING_USED"];
    if (result.repaired) flags.push("REPAIR_ATTEMPTED");

    // Apply AI classification to retrieval results.
    const updatedResults: RetrievalResult[] = evidence.retrievalResults.map((r) => {
      const ranked = rerankItems.find((item) => item.regionId === r.regionId);
      if (!ranked) return r;
      return {
        ...r,
        semanticScore: ranked.semanticScore,
        relationshipType:
          ranked.classification === "CONTRADICTORY" ? "contradicts" :
          ranked.classification === "PARTIAL"        ? "partially_supports" :
          ranked.classification === "CONTEXTUAL"     ? "contextual" :
          "supports"
      };
    });

    // Sort: DIRECT first, then PARTIAL, then others.
    const rankOrder: EvidenceSufficiencyClass[] = ["DIRECT", "PARTIAL", "CONTEXTUAL", "CONTRADICTORY", "IRRELEVANT", "UNVERIFIED"];
    updatedResults.sort((a, b) => {
      const aRank = rerankItems.find((x) => x.regionId === a.regionId);
      const bRank = rerankItems.find((x) => x.regionId === b.regionId);
      const aIdx  = aRank ? rankOrder.indexOf(aRank.classification) : 99;
      const bIdx  = bRank ? rankOrder.indexOf(bRank.classification) : 99;
      return aIdx - bIdx;
    });

    // Determine primary sufficiency from top-ranked item.
    const topClass = rerankItems.find((x) => x.regionId === updatedResults[0]?.regionId)?.classification;
    const sufficiency: EvidenceSufficiency = topClass
      ? sufficiencyFromClass(topClass)
      : evidence.sufficiency;

    const rerankedEvidence: RetrievedEvidence = {
      ...evidence,
      retrievalResults: updatedResults,
      sufficiency,
      primaryQuote:    updatedResults[0] ? (updatedResults[0].exactQuote.slice(0, 400)) : evidence.primaryQuote,
      primaryRegionId: updatedResults[0]?.regionId ?? evidence.primaryRegionId
    };

    return { evidence: rerankedEvidence, reranked: true, aiRunId: result.runId, flags };
  }
}
