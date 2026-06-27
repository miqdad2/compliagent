export const aiTaskTypes = [
  "document_classification",
  "document_understanding",
  "requirement_extraction",
  "requirement_refinement",
  "requirement_decomposition",
  "evidence_retrieval",
  "evidence_reranking",
  "condition_comparison",
  "standards_applicability",
  "finding_verification",
  "annotation_comment_generation",
  "report_summary",
  "project_chat"
] as const;

export type AiTaskType = (typeof aiTaskTypes)[number];

export const AI_TASK = {
  DOCUMENT_CLASSIFICATION:      "document_classification",
  DOCUMENT_UNDERSTANDING:       "document_understanding",
  REQUIREMENT_EXTRACTION:       "requirement_extraction",
  REQUIREMENT_REFINEMENT:       "requirement_refinement",
  REQUIREMENT_DECOMPOSITION:    "requirement_decomposition",
  EVIDENCE_RETRIEVAL:           "evidence_retrieval",
  EVIDENCE_RERANKING:           "evidence_reranking",
  CONDITION_COMPARISON:         "condition_comparison",
  STANDARDS_APPLICABILITY:      "standards_applicability",
  FINDING_VERIFICATION:         "finding_verification",
  ANNOTATION_COMMENT_GENERATION:"annotation_comment_generation",
  REPORT_SUMMARY:               "report_summary",
  PROJECT_CHAT:                 "project_chat"
} as const satisfies Record<string, AiTaskType>;

export const aiModelTiers = ["lightweight", "multimodal", "reasoning", "verifier"] as const;
export type AiModelTier = (typeof aiModelTiers)[number];

export const taskModelTier: Record<AiTaskType, AiModelTier> = {
  document_classification:       "lightweight",
  document_understanding:        "multimodal",
  requirement_extraction:        "reasoning",
  requirement_refinement:        "reasoning",
  requirement_decomposition:     "reasoning",
  evidence_retrieval:            "reasoning",
  evidence_reranking:            "reasoning",
  condition_comparison:          "reasoning",
  standards_applicability:       "reasoning",
  finding_verification:          "verifier",
  annotation_comment_generation: "lightweight",
  report_summary:                "reasoning",
  project_chat:                  "reasoning"
};
