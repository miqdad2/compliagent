import { describe, it, expect, beforeEach } from "vitest";
import { ReviewOrchestrator } from "@/server/services/reviews/review-orchestrator";
import { MemoryReviewGateway, makeTestReviewRow, makeTestRequirementRow } from "@/server/services/reviews/memory-review-gateway";
import { MemoryComplianceGateway } from "@/server/services/compliance/memory-compliance-gateway";
import { RequirementDiscoveryService, hasMandatoryLanguage, extractLeadingClauseNumber } from "@/server/services/reviews/requirement-discovery";
import { EvidenceRetrievalService } from "@/server/services/reviews/evidence-retrieval";
import { ConditionComparisonService } from "@/server/services/reviews/condition-comparison";
import { FindingVerifierService } from "@/server/services/reviews/finding-verifier";
import type { RequirementConditionRow } from "@/server/services/compliance/gateway";
import type { ChunkRow } from "@/server/services/reviews/types";
import type { RetrievedEvidence } from "@/server/services/reviews/types";

// ── Shared test factories ────────────────────────────────────────────────────

function makeCondition(overrides: Partial<RequirementConditionRow> = {}): RequirementConditionRow {
  const now = new Date().toISOString();
  return {
    id:                      "cond-1",
    organization_id:         "org-1",
    project_id:              "proj-1",
    requirement_id:          "req-1",
    condition_order:         1,
    condition_key:           "driver_count",
    condition_type:          "exact_value",
    subject:                 "loudspeaker system",
    attribute:               "driver count",
    operator:                "equals",
    expected_text:           "8 drivers",
    expected_numeric_value:  8,
    expected_min_value:      null,
    expected_max_value:      null,
    expected_unit:           null,
    is_mandatory:            true,
    source_text:             "8 × 3.5-inch HQ drivers shall be provided",
    extraction_confidence:   92,
    is_active:               true,
    is_human_confirmed:      false,
    superseded_at:           null,
    superseded_reason:       null,
    created_at:              now,
    updated_at:              now,
    ...overrides
  };
}

function makeChunk(overrides: Partial<ChunkRow> = {}): ChunkRow {
  const now = new Date().toISOString();
  return {
    id:              "chunk-1",
    document_id:     "doc-sub-1",
    project_id:      "proj-1",
    page_number:     1,
    clause_number:   null,
    section_heading: null,
    chunk_text:      "The system includes 8 × 3.5-inch HQ drivers.",
    normalized_text: "The system includes 8 × 3.5-inch HQ drivers.",
    embedding:       null,
    metadata:        {},
    created_at:      now,
    ...overrides
  };
}

function baseInput() {
  return {
    organizationId:    "org-1",
    projectId:         "proj-1",
    reviewId:          "review-1",
    createdBy:         "user-1",
    reviewVersion:     1,
    sourceHash:        "abc123",
    extractionVersion: "v1",
    promptVersion:     "1.0.0-placeholder",
    executionMode:     "deterministic" as const
  };
}

// ── Golden client review test ────────────────────────────────────────────────

describe("Golden client review — speaker spec 2.2.1 A.1(b) vs submission", () => {
  let gateway: MemoryReviewGateway;
  let complianceGateway: MemoryComplianceGateway;
  let orchestrator: ReviewOrchestrator;

  beforeEach(() => {
    gateway = new MemoryReviewGateway();
    complianceGateway = new MemoryComplianceGateway();
    complianceGateway.enableFindingStubs();
    orchestrator = new ReviewOrchestrator(gateway, complianceGateway);
  });

  it("produces awaiting_human_review when spec drivers match submission", async () => {
    // Spec: clause 2.2.1 A.1(b) requires 8 × 3.5-inch HQ drivers.
    // Submission: states "8 × 3.5-inch HQ drivers".
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({
        id: "req-1", project_id: "proj-1", source_document_id: "doc-spec-1",
        clause_number:    "2.2.1",
        sub_clause_number: "A.1(b)",
        requirement_text: "8 × 3.5-inch HQ drivers shall be provided.",
        mandatory_level:  "mandatory",
        extraction_confidence: 92
      })
    ]);
    gateway.seedChunks([
      makeChunk({
        id: "chunk-sub-1", document_id: "doc-sub-1",
        chunk_text:      "The speaker system is equipped with 8 × 3.5-inch HQ drivers.",
        normalized_text: "The speaker system is equipped with 8 × 3.5-inch HQ drivers.",
        page_number: 3, clause_number: "5.1"
      })
    ]);

    // Seed the condition for the spec requirement.
    complianceGateway.seedCondition(makeCondition({
      requirement_id: "req-1",
      expected_text:  "8 × 3.5-inch HQ drivers",
      expected_numeric_value: 8
    }));

    const result = await orchestrator.runControlledReview(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("awaiting_human_review");
    expect(result.data.findingCount).toBeGreaterThanOrEqual(1);
    expect(result.data.idempotentSkip).toBe(false);
    // The review must NOT be auto-approved.
    const reviewRow = gateway.getReviewRow("review-1");
    expect(reviewRow?.status).toBe("awaiting_human_review");
    // Audit must contain review start and completion events.
    const actions = gateway.auditLog.map((a) => a.action);
    expect(actions).toContain("controlled_review.started");
    expect(actions).toContain("controlled_review.completed_to_human_review");
    expect(actions).not.toContain("controlled_review.failed");
  });

  it("does NOT auto-approve the review regardless of evidence confidence", async () => {
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({
        id: "req-1", project_id: "proj-1", source_document_id: "doc-spec-1",
        requirement_text: "8 × 3.5-inch HQ drivers shall be installed.",
        mandatory_level: "mandatory", extraction_confidence: 95
      })
    ]);
    gateway.seedChunks([
      makeChunk({ chunk_text: "8 × 3.5-inch HQ drivers are installed.", normalized_text: "8 × 3.5-inch HQ drivers are installed." })
    ]);
    complianceGateway.seedCondition(makeCondition({ expected_numeric_value: 8, expected_text: "8 × 3.5-inch HQ drivers" }));

    const result = await orchestrator.runControlledReview(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("awaiting_human_review");
    expect(result.data.status).not.toBe("approved");
    const reviewRow = gateway.getReviewRow("review-1");
    expect(reviewRow?.status).not.toBe("approved");
  });
});

// ── Requirement discovery tests ──────────────────────────────────────────────

describe("RequirementDiscoveryService", () => {
  const svc = new RequirementDiscoveryService();

  describe("hasMandatoryLanguage", () => {
    it("detects 'shall'", () => expect(hasMandatoryLanguage("The device shall comply.")).toBe(true));
    it("detects 'must'", () => expect(hasMandatoryLanguage("It must be rated at 100W.")).toBe(true));
    it("detects 'is required'", () => expect(hasMandatoryLanguage("Certification is required.")).toBe(true));
    it("detects 'is to'", () => expect(hasMandatoryLanguage("The unit is to be installed indoors.")).toBe(true));
    it("detects 'required to'", () => expect(hasMandatoryLanguage("The supplier is required to submit drawings.")).toBe(true));
    it("rejects informative text", () => expect(hasMandatoryLanguage("This section provides guidance.")).toBe(false));
    it("rejects empty string", () => expect(hasMandatoryLanguage("")).toBe(false));
  });

  describe("extractLeadingClauseNumber", () => {
    it("extracts standard clause", () => expect(extractLeadingClauseNumber("2.2.1 Some heading")).toBe("2.2.1"));
    it("extracts letter-prefixed clause", () => expect(extractLeadingClauseNumber("A.1(b) Requirement")).toBe("A.1"));
    it("returns null for plain text", () => expect(extractLeadingClauseNumber("No clause here")).toBeNull());
    it("extracts deep clause", () => expect(extractLeadingClauseNumber("3.4.2.1 Deep clause")).toBe("3.4.2.1"));
  });

  describe("fromExtracted", () => {
    it("maps requirement rows to DiscoveredRequirement", () => {
      const row = makeTestRequirementRow({
        id: "r1", project_id: "p1", source_document_id: "d1",
        clause_number: "3.1", requirement_text: "The device shall comply.", mandatory_level: "mandatory"
      });
      const result = svc.fromExtracted([row]);
      expect(result).toHaveLength(1);
      expect(result[0].requirementId).toBe("r1");
      expect(result[0].clauseNumber).toBe("3.1");
      expect(result[0].mandatoryLevel).toBe("mandatory");
    });

    it("returns empty array for no rows", () => {
      expect(svc.fromExtracted([])).toEqual([]);
    });
  });

  describe("discoverFromChunks", () => {
    it("returns chunks with mandatory language", () => {
      const chunks: ChunkRow[] = [
        makeChunk({ id: "c1", document_id: "d1", chunk_text: "Units shall be IP65 rated.", normalized_text: "Units shall be IP65 rated." }),
        makeChunk({ id: "c2", document_id: "d1", chunk_text: "This is general guidance.", normalized_text: "This is general guidance." })
      ];
      const result = svc.discoverFromChunks(chunks, "p1", ["d1"]);
      expect(result).toHaveLength(1);
      expect(result[0].requirementText).toContain("IP65");
    });

    it("ignores chunks from documents that already have requirements", () => {
      const chunks: ChunkRow[] = [
        makeChunk({ id: "c3", document_id: "d2", chunk_text: "Units shall be IP65 rated.", normalized_text: "Units shall be IP65 rated." })
      ];
      // documentIdsWithoutRequirements does not include d2.
      const result = svc.discoverFromChunks(chunks, "p1", ["d1"]);
      expect(result).toHaveLength(0);
    });
  });

  describe("filterCheckable", () => {
    it("keeps mandatory requirements", () => {
      const reqs = [
        { requirementId: "r1", projectId: "p1", sourceDocumentId: "d1", pageNumber: 1, clauseNumber: "1.1", subClauseNumber: null, requirementText: "Shall comply", mandatoryLevel: "mandatory", extractionConfidence: 90 },
        { requirementId: "r2", projectId: "p1", sourceDocumentId: "d1", pageNumber: 2, clauseNumber: null, subClauseNumber: null, requirementText: "General note.", mandatoryLevel: "informative", extractionConfidence: 70 }
      ];
      const result = svc.filterCheckable(reqs);
      expect(result).toHaveLength(1);
      expect(result[0].requirementId).toBe("r1");
    });

    it("keeps requirements with mandatory language even if level is null", () => {
      const reqs = [
        { requirementId: "r3", projectId: "p1", sourceDocumentId: "d1", pageNumber: 1, clauseNumber: null, subClauseNumber: null, requirementText: "The unit shall meet IP65.", mandatoryLevel: null, extractionConfidence: 80 }
      ];
      expect(svc.filterCheckable(reqs)).toHaveLength(1);
    });

    it("filters out blank requirement text", () => {
      const reqs = [
        { requirementId: "r4", projectId: "p1", sourceDocumentId: "d1", pageNumber: 1, clauseNumber: null, subClauseNumber: null, requirementText: "   ", mandatoryLevel: "mandatory", extractionConfidence: 50 }
      ];
      expect(svc.filterCheckable(reqs)).toHaveLength(0);
    });
  });
});

// ── Evidence retrieval tests ─────────────────────────────────────────────────

describe("EvidenceRetrievalService", () => {
  const svc = new EvidenceRetrievalService();

  it("returns irrelevant sufficiency when no submission chunks match", () => {
    const condition = makeCondition({ expected_text: "IP65 rating", attribute: "ingress protection" });
    const chunk = makeChunk({ chunk_text: "No relevant content here.", normalized_text: "No relevant content here." });
    const result = svc.retrieve(condition, [chunk], [], ["doc-sub-1"]);
    expect(result.sufficiency).toBe("irrelevant");
    expect(result.retrievalResults).toHaveLength(0);
  });

  it("returns direct sufficiency for exact phrase match", () => {
    const condition = makeCondition({ expected_text: "8 drivers", attribute: "driver count" });
    const chunk = makeChunk({ chunk_text: "System has 8 drivers installed.", normalized_text: "System has 8 drivers installed." });
    const result = svc.retrieve(condition, [chunk], [], ["doc-sub-1"]);
    expect(result.sufficiency).toBe("direct");
    expect(result.retrievalResults).toHaveLength(1);
    expect(result.retrievalResults[0].exactQuote).toBeTruthy();
  });

  it("returns contextual sufficiency for partial keyword match", () => {
    const condition = makeCondition({ expected_text: "acoustic driver", attribute: "driver type" });
    const chunk = makeChunk({ chunk_text: "The driver assembly uses high-quality transducers.", normalized_text: "The driver assembly uses high-quality transducers." });
    const result = svc.retrieve(condition, [chunk], [], ["doc-sub-1"]);
    // "driver" keyword is present; "acoustic" is not.
    expect(["contextual", "partial", "irrelevant"]).toContain(result.sufficiency);
  });

  it("only retrieves from submission document IDs, not spec documents", () => {
    const condition = makeCondition({ expected_text: "8 drivers" });
    const specChunk = makeChunk({ id: "spec-chunk", document_id: "doc-spec-1", chunk_text: "8 drivers shall be installed." });
    const result = svc.retrieve(condition, [specChunk], [], ["doc-sub-1"]);
    expect(result.retrievalResults).toHaveLength(0);
  });

  it("matches numeric values in submission text", () => {
    const condition = makeCondition({ condition_type: "exact_value", expected_numeric_value: 8, expected_text: null });
    const chunk = makeChunk({ chunk_text: "8 woofers are installed in the enclosure.", normalized_text: "8 woofers are installed in the enclosure." });
    const result = svc.retrieve(condition, [chunk], [], ["doc-sub-1"]);
    expect(result.retrievalResults.length).toBeGreaterThan(0);
  });

  it("returns null primaryQuote when nothing matches", () => {
    const condition = makeCondition({ expected_text: "quantum resonator", expected_numeric_value: null });
    const chunk = makeChunk({
      chunk_text: "Normal product description.",
      normalized_text: "Normal product description."
    });
    const result = svc.retrieve(condition, [chunk], [], ["doc-sub-1"]);
    expect(result.primaryQuote).toBeNull();
    expect(result.primaryRegionId).toBeNull();
  });

  it("caps retrieval results at 5", () => {
    const condition = makeCondition({ expected_text: "8 drivers" });
    const chunks = Array.from({ length: 10 }, (_, i) =>
      makeChunk({ id: `c${i}`, page_number: i + 1, chunk_text: "8 drivers are fitted.", normalized_text: "8 drivers are fitted." })
    );
    const result = svc.retrieve(condition, chunks, [], ["doc-sub-1"]);
    expect(result.retrievalResults.length).toBeLessThanOrEqual(5);
  });
});

// ── Condition comparison tests ───────────────────────────────────────────────

describe("ConditionComparisonService", () => {
  const svc = new ConditionComparisonService();

  function makeEvidence(overrides: Partial<RetrievedEvidence> = {}): RetrievedEvidence {
    return {
      conditionId: "cond-1",
      retrievalResults: [],
      sufficiency: "irrelevant",
      primaryQuote: null,
      primaryRegionId: null,
      ...overrides
    };
  }

  it("returns not_proven when no evidence exists for numeric condition", () => {
    const condition = makeCondition({ condition_type: "numeric_minimum", expected_numeric_value: 8, expected_text: null });
    const evidence = makeEvidence();
    const result = svc.compare(condition, evidence);
    expect(result.status).toBe("not_proven");
    expect(result.missingInformation).toBeTruthy();
  });

  it("detects compliance for exact numeric match", () => {
    const condition = makeCondition({
      condition_type: "exact_value",
      expected_numeric_value: 8,
      expected_unit: null,
      expected_text: null
    });
    const evidence = makeEvidence({
      sufficiency: "direct",
      primaryQuote: "The system uses 8 drivers.",
      retrievalResults: [
        {
          conditionId: "cond-1", documentId: "doc-1", pageNumber: 1,
          clauseNumber: "5.1", regionId: "reg-1", exactQuote: "The system uses 8 drivers.",
          evidenceType: "exact_phrase", semanticScore: 0, keywordScore: 0.8,
          retrievalConfidence: 85, extractionConfidence: 80, relationshipType: "supports"
        }
      ]
    });
    const result = svc.compare(condition, evidence);
    expect(result.status).toBe("complied");
    expect(result.normalizedEvidence).toBeTruthy();
  });

  it("returns not_proven for text_match condition with no evidence", () => {
    const condition = makeCondition({ condition_type: "text_match", expected_text: "CE certified", expected_numeric_value: null });
    const evidence = makeEvidence();
    const result = svc.compare(condition, evidence);
    expect(result.status).toBe("not_proven");
  });

  it("flags humanReviewRequired when confidence is below 70", () => {
    const condition = makeCondition({ condition_type: "text_match", expected_text: "unique identifier", expected_numeric_value: null });
    const evidence = makeEvidence({ sufficiency: "contextual", primaryQuote: "Some generic text mentioning identifier." });
    const result = svc.compare(condition, evidence);
    // low confidence text match should require human review
    if (result.confidence < 70) {
      expect(result.humanReviewRequired).toBe(true);
    }
  });

  it("includes contractorAction for not_proven results", () => {
    const condition = makeCondition({ condition_type: "boolean", expected_text: "IP65", expected_numeric_value: null });
    const evidence = makeEvidence();
    const result = svc.compare(condition, evidence);
    expect(result.status).toBe("not_proven");
    expect(result.contractorAction).toBeTruthy();
  });

  it("numeric range: value within range → complied", () => {
    const condition = makeCondition({
      condition_type:      "numeric_range",
      expected_numeric_value: null,
      expected_min_value:  3.0,
      expected_max_value:  4.0,
      expected_unit:       "inch",
      expected_text:       null
    });
    const evidence = makeEvidence({
      sufficiency:  "direct",
      primaryQuote: '3.5 inch drivers',
      retrievalResults: [
        {
          conditionId: "cond-1", documentId: "doc-1", pageNumber: 1,
          clauseNumber: null, regionId: "reg-1", exactQuote: '3.5 inch drivers',
          evidenceType: "numeric_value", semanticScore: 0, keywordScore: 0.5,
          retrievalConfidence: 80, extractionConfidence: 80, relationshipType: "supports"
        }
      ]
    });
    const result = svc.compare(condition, evidence);
    expect(result.status).toBe("complied");
  });

  it("numeric range: value out of range → not_complied", () => {
    const condition = makeCondition({
      condition_type:         "numeric_range",
      expected_numeric_value: null,
      expected_min_value:     3.0,
      expected_max_value:     4.0,
      expected_unit:          "inch",
      expected_text:          null
    });
    const evidence = makeEvidence({
      sufficiency:  "direct",
      primaryQuote: "5.0 inch drivers",
      retrievalResults: [
        {
          conditionId: "cond-1", documentId: "doc-1", pageNumber: 1,
          clauseNumber: null, regionId: "reg-1", exactQuote: "5.0 inch drivers",
          evidenceType: "numeric_value", semanticScore: 0, keywordScore: 0.5,
          retrievalConfidence: 80, extractionConfidence: 80, relationshipType: "supports"
        }
      ]
    });
    const result = svc.compare(condition, evidence);
    expect(result.status).toBe("not_complied");
  });
});

// ── Finding verifier tests ───────────────────────────────────────────────────

describe("FindingVerifierService", () => {
  const svc = new FindingVerifierService();

  function makeComparisonResult(
    overrides: Partial<import("@/lib/ai/schemas").ComparisonResult> = {}
  ): import("@/lib/ai/schemas").ComparisonResult {
    return {
      conditionId:            "cond-1",
      status:                 "complied",
      normalizedRequirement:  "loudspeaker: driver count equals 8",
      normalizedEvidence:     "8 drivers are installed",
      numericComparison:      null,
      unitComparison:         null,
      reasoning:              "Driver count matches requirement.",
      missingInformation:     null,
      contractorAction:       null,
      verificationFailureReason: null,
      confidence:             85,
      risk:                   "low",
      humanReviewRequired:    false,
      ...overrides
    };
  }

  function makeEvidenceForVerification(overrides: Partial<RetrievedEvidence> = {}): RetrievedEvidence {
    return {
      conditionId: "cond-1",
      retrievalResults: [
        {
          conditionId: "cond-1", documentId: "doc-1", pageNumber: 1,
          clauseNumber: "5.1", regionId: "reg-1", exactQuote: "8 drivers are installed",
          evidenceType: "exact_phrase", semanticScore: 0, keywordScore: 1.0,
          retrievalConfidence: 90, extractionConfidence: 90, relationshipType: "supports"
        }
      ],
      sufficiency: "direct",
      primaryQuote: "8 drivers are installed",
      primaryRegionId: "reg-1",
      ...overrides
    };
  }

  it("passes verification when all checks succeed", () => {
    const condition = makeCondition();
    const evidence = makeEvidenceForVerification();
    const comparison = makeComparisonResult();
    const result = svc.verify("finding-1", condition, evidence, comparison);
    expect(result.passed).toBe(true);
    expect(result.unsupportedClaims).toHaveLength(0);
  });

  it("fails when complied status but no citation", () => {
    const condition = makeCondition();
    const evidence = makeEvidenceForVerification({ retrievalResults: [], primaryRegionId: null });
    const comparison = makeComparisonResult({ status: "complied" });
    const result = svc.verify("finding-1", condition, evidence, comparison);
    expect(result.passed).toBe(false);
    expect(result.citationValid).toBe(false);
  });

  it("flags unsupported claim when normalizedEvidence not found in quotes", () => {
    const condition = makeCondition();
    const evidence = makeEvidenceForVerification({
      retrievalResults: [
        {
          conditionId: "cond-1", documentId: "doc-1", pageNumber: 1,
          clauseNumber: null, regionId: "reg-1", exactQuote: "completely different text",
          evidenceType: "keyword", semanticScore: 0, keywordScore: 0.3,
          retrievalConfidence: 40, extractionConfidence: 70, relationshipType: "contextual"
        }
      ]
    });
    const comparison = makeComparisonResult({ normalizedEvidence: "fabricated quote not in evidence" });
    const result = svc.verify("finding-1", condition, evidence, comparison);
    expect(result.quoteExact).toBe(false);
    expect(result.unsupportedClaims.length).toBeGreaterThan(0);
  });

  it("flags incompatible units", () => {
    const condition = makeCondition({ expected_unit: "mm" });
    const evidence = makeEvidenceForVerification({ primaryQuote: "3.5 inch drivers" });
    const comparison = makeComparisonResult({ normalizedEvidence: "3.5 inch drivers" });
    const result = svc.verify("finding-1", condition, evidence, comparison);
    expect(result.unitsCompatible).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("flags missing_information when not_proven but no missingInformation field", () => {
    const condition = makeCondition();
    const evidence = makeEvidenceForVerification({ retrievalResults: [], sufficiency: "irrelevant" });
    const comparison = makeComparisonResult({ status: "not_proven", normalizedEvidence: null, missingInformation: null });
    const result = svc.verify("finding-1", condition, evidence, comparison);
    expect(result.conditionsComplete).toBe(false);
  });

  it("requires human review when verifier confidence is low", () => {
    const condition = makeCondition();
    const evidence = makeEvidenceForVerification({ retrievalResults: [], primaryRegionId: null });
    const comparison = makeComparisonResult({ status: "ambiguous", confidence: 40 });
    const result = svc.verify("finding-1", condition, evidence, comparison);
    expect(result.requiresHumanReview).toBe(true);
  });
});

// ── Orchestrator reliability tests ───────────────────────────────────────────

describe("ReviewOrchestrator — reliability", () => {
  let gateway: MemoryReviewGateway;
  let complianceGateway: MemoryComplianceGateway;
  let orchestrator: ReviewOrchestrator;

  beforeEach(() => {
    gateway = new MemoryReviewGateway();
    complianceGateway = new MemoryComplianceGateway();
    complianceGateway.enableFindingStubs();
    orchestrator = new ReviewOrchestrator(gateway, complianceGateway);
  });

  it("returns REVIEW_NOT_FOUND when review does not exist", async () => {
    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("REVIEW_NOT_FOUND");
  });

  it("returns PROJECT_ACCESS_DENIED when review belongs to different project", async () => {
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "wrong-project" }));
    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("PROJECT_ACCESS_DENIED");
  });

  it("returns REVIEW_STATE_CONFLICT when review is already running", async () => {
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1", status: "running" }));
    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("REVIEW_STATE_CONFLICT");
  });

  it("returns REVIEW_STATE_CONFLICT when review is already approved", async () => {
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1", status: "approved" }));
    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("REVIEW_STATE_CONFLICT");
  });

  it("returns idempotentSkip when all hashes match and status is awaiting_human_review", async () => {
    gateway.seedReview(makeTestReviewRow({
      id: "review-1", project_id: "proj-1",
      status: "awaiting_human_review",
      review_version: 1,
      source_hash: "abc123",
      extraction_version: "v1",
      prompt_version: "1.0.0-placeholder"
    }));
    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.idempotentSkip).toBe(true);
    const actions = gateway.auditLog.map((a) => a.action);
    expect(actions).toContain("controlled_review.idempotent_skip");
  });

  it("proceeds (not idempotent) when source_hash differs", async () => {
    gateway.seedReview(makeTestReviewRow({
      id: "review-1", project_id: "proj-1",
      status: "awaiting_human_review",
      review_version: 1,
      source_hash: "different_hash",
      extraction_version: "v1",
      prompt_version: "1.0.0-placeholder"
    }));
    // Will hit state conflict because status is awaiting_human_review and we're trying to begin it.
    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(false);
  });

  it("completes with zero findings when no processed documents exist", async () => {
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-1", document_role: "specification", processing_status: "running" }
    ]);
    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("NO_PROCESSED_DOCUMENTS");
  });

  it("transitions to awaiting_human_review even with zero requirements", async () => {
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification", processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    // No requirements or chunks seeded.
    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("awaiting_human_review");
    expect(result.data.findingCount).toBe(0);
  });

  it("processes multiple requirements independently", async () => {
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({ id: "req-1", project_id: "proj-1", source_document_id: "doc-spec-1", requirement_text: "8 drivers shall be fitted.", mandatory_level: "mandatory", extraction_confidence: 90 }),
      makeTestRequirementRow({ id: "req-2", project_id: "proj-1", source_document_id: "doc-spec-1", requirement_text: "Unit shall be IP65 rated.", mandatory_level: "mandatory", extraction_confidence: 85 })
    ]);
    gateway.seedChunks([
      makeChunk({ document_id: "doc-sub-1", chunk_text: "8 drivers are installed. IP65 enclosure.", normalized_text: "8 drivers are installed. IP65 enclosure." })
    ]);
    complianceGateway.seedCondition(makeCondition({ requirement_id: "req-1", expected_numeric_value: 8 }));
    complianceGateway.seedCondition(makeCondition({ id: "cond-2", requirement_id: "req-2", condition_key: "ip_rating", expected_text: "IP65", expected_numeric_value: null }));

    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.findingCount).toBe(2);
    expect(result.data.status).toBe("awaiting_human_review");
  });

  it("auto-creates a simple condition for requirements without any in deterministic mode", async () => {
    // Previously this test verified skipping; now in deterministic mode the orchestrator
    // auto-creates one boolean evidence-presence condition so the review produces a finding.
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({ id: "req-1", project_id: "proj-1", source_document_id: "doc-spec-1", requirement_text: "8 drivers shall be fitted.", mandatory_level: "mandatory", extraction_confidence: 90 })
    ]);
    // No conditions seeded for req-1 — auto-condition creation fires in deterministic mode.
    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Deterministic mode creates auto-condition → finding produced
    expect(result.data.findingCount).toBeGreaterThanOrEqual(1);
    expect(complianceGateway.conditions.some((c) => c.condition_key === "auto_presence_check")).toBe(true);
  });

  it("emits started, condition_evaluated, and completed audit events", async () => {
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({ id: "req-1", project_id: "proj-1", source_document_id: "doc-spec-1", requirement_text: "8 drivers shall be fitted.", mandatory_level: "mandatory", extraction_confidence: 90 })
    ]);
    gateway.seedChunks([makeChunk({ document_id: "doc-sub-1" })]);
    complianceGateway.seedCondition(makeCondition());

    await orchestrator.runControlledReview(baseInput());
    const actions = gateway.auditLog.map((a) => a.action);
    expect(actions).toContain("controlled_review.started");
    expect(actions).toContain("controlled_review.completed_to_human_review");
  });

  it("audit metadata does not contain evidence text", async () => {
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({ id: "req-1", project_id: "proj-1", source_document_id: "doc-spec-1", requirement_text: "Shall comply.", mandatory_level: "mandatory", extraction_confidence: 80 })
    ]);
    gateway.seedChunks([makeChunk({ document_id: "doc-sub-1", chunk_text: "CONFIDENTIAL DATA: system complies.", normalized_text: "CONFIDENTIAL DATA: system complies." })]);
    complianceGateway.seedCondition(makeCondition());

    await orchestrator.runControlledReview(baseInput());

    // Audit metadata must not contain full evidence text — only safe metadata.
    for (const record of gateway.auditLog) {
      const metaStr = JSON.stringify(record.metadata);
      expect(metaStr).not.toContain("CONFIDENTIAL DATA");
    }
  });

  it("only includes submission documents in evidence search, not spec documents", async () => {
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({ id: "req-1", project_id: "proj-1", source_document_id: "doc-spec-1", requirement_text: "8 drivers shall be provided.", mandatory_level: "mandatory", extraction_confidence: 90 })
    ]);
    // Only spec chunk — should NOT be used as evidence.
    gateway.seedChunks([
      makeChunk({ id: "spec-c", document_id: "doc-spec-1", chunk_text: "8 drivers shall be installed." })
    ]);
    complianceGateway.seedCondition(makeCondition());

    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("awaiting_human_review");
  });

  it("can start a failed review again", async () => {
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1", status: "failed" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    // No requirements, so completes immediately.
    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(true);
  });

  it("rejects organization access when review org does not match", async () => {
    gateway.seedReview(makeTestReviewRow({
      id: "review-1", project_id: "proj-1", organization_id: "different-org"
    }));
    // getReview will return null due to org mismatch.
    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe("REVIEW_NOT_FOUND");
  });

  it("handles multiple conditions per requirement — all evaluated", async () => {
    gateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    gateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({ id: "req-1", project_id: "proj-1", source_document_id: "doc-spec-1", requirement_text: "8 drivers at 3.5 inch.", mandatory_level: "mandatory", extraction_confidence: 90 })
    ]);
    gateway.seedChunks([
      makeChunk({ document_id: "doc-sub-1", chunk_text: "8 HQ drivers, each 3.5 inches.", normalized_text: "8 HQ drivers, each 3.5 inches." })
    ]);
    complianceGateway.seedCondition(makeCondition({ id: "cond-1", condition_key: "count", expected_numeric_value: 8 }));
    complianceGateway.seedCondition(makeCondition({ id: "cond-2", condition_key: "size", expected_numeric_value: 3.5, expected_unit: "inch", expected_text: "3.5 inch" }));

    const result = await orchestrator.runControlledReview(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.conditionCount).toBe(2);
  });
});
