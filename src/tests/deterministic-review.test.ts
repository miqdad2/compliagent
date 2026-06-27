/**
 * deterministic-review.test.ts
 *
 * Regression tests for Unit 17C: Real Deterministic Review Execution.
 *
 * Covers the 18 required items from the unit spec:
 *  1. main_specification is accepted as requirement source
 *  2. specification is accepted as requirement source
 *  3. product_datasheet is accepted as evidence source
 *  4. Processed documents appear in Start Review (role arrays cover expected roles)
 *  5. Review enters running
 *  6. Requirements persist (provisional)
 *  7. Provisional requirements enter decomposition (auto-condition created)
 *  8. Evidence search excludes specification documents
 *  9. Numeric size condition complies when value is within range
 * 10. Missing full-range becomes not_proven when no evidence is found
 * 11. Missing neodymium becomes not_proven when no evidence is found
 * 12. Parent status derives partially_complied from mixed evaluations
 * 13. Review reaches awaiting_human_review
 * 14. Workspace — finding status is stored in compliance gateway after review
 * 15. Reviewer action (human_status) is applied and stored
 * 16. Human decision survives — overwrite attempt throws HumanApprovalProtected
 * 17. No automatic approval occurs
 * 18. No external AI call occurs in deterministic mode
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { specificationRoles, submissionRoles } from "@/types/domain";
import { ReviewOrchestrator } from "@/server/services/reviews/review-orchestrator";
import {
  MemoryReviewGateway,
  makeTestReviewRow,
  makeTestRequirementRow
} from "@/server/services/reviews/memory-review-gateway";
import { MemoryComplianceGateway } from "@/server/services/compliance/memory-compliance-gateway";
import { MemoryProvisionalRequirementGateway } from "@/server/services/reviews/provisional-requirement-gateway";
import { ConditionComparisonService } from "@/server/services/reviews/condition-comparison";
import { deriveParentFindingStatus } from "@/lib/compliance/parent-finding";
import type { RequirementConditionRow } from "@/server/services/compliance/gateway";
import type { ChunkRow, RetrievedEvidence } from "@/server/services/reviews/types";
import type { ConditionEvaluationStatus } from "@/lib/compliance/condition-schemas";

// ── Test IDs ─────────────────────────────────────────────────────────────────

const TS = "2026-06-26T00:00:00.000Z";

// All IDs use consistent org-1 / proj-1 patterns to match makeTestReviewRow defaults.
const IDS = {
  org: "org-1",
  project: "proj-1",
  review: "review-1",
  user: "user-1",
  specDoc: "doc-spec-1",
  subDoc: "doc-sub-1"
};

// ── Factories ─────────────────────────────────────────────────────────────────

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    organizationId:    IDS.org,
    projectId:         IDS.project,
    reviewId:          IDS.review,
    createdBy:         IDS.user,
    reviewVersion:     1,
    sourceHash:        "test-hash",
    extractionVersion: "v1",
    promptVersion:     "1.0.0",
    executionMode:     "deterministic" as const,
    ...overrides
  };
}

function makeChunk(overrides: Partial<ChunkRow> = {}): ChunkRow {
  return {
    id: "chunk-1",
    document_id: IDS.subDoc,
    project_id: IDS.project,
    page_number: 1,
    clause_number: null,
    section_heading: null,
    chunk_text: 'The speaker includes 8 × 3.5" HQ drivers.',
    normalized_text: 'The speaker includes 8 × 3.5" HQ drivers.',
    embedding: null,
    metadata: {},
    created_at: TS,
    ...overrides
  };
}

function makeCondition(overrides: Partial<RequirementConditionRow>): RequirementConditionRow {
  return {
    id: "cond-1",
    organization_id: IDS.org,
    project_id: IDS.project,
    requirement_id: "req-1",
    condition_order: 1,
    condition_key: "test_condition",
    condition_type: "boolean",
    subject: "speaker",
    attribute: "drivers",
    operator: "exists",
    expected_text: null,
    expected_numeric_value: null,
    expected_min_value: null,
    expected_max_value: null,
    expected_unit: null,
    is_mandatory: true,
    source_text: "Drivers shall be provided.",
    extraction_confidence: 90,
    is_active: true,
    is_human_confirmed: false,
    superseded_at: null,
    superseded_reason: null,
    created_at: TS,
    updated_at: TS,
    ...overrides
  };
}

function makeEvidence(overrides: Partial<RetrievedEvidence> = {}): RetrievedEvidence {
  return {
    conditionId: "cond-1",
    retrievalResults: [],
    primaryQuote: null,
    primaryRegionId: null,
    sufficiency: "irrelevant",  // valid EvidenceSufficiency: "direct"|"partial"|"contradictory"|"contextual"|"irrelevant"|"unverified"
    ...overrides
  };
}

function makeOrchestrator() {
  const gateway = new MemoryReviewGateway();
  const complianceGateway = new MemoryComplianceGateway();
  complianceGateway.enableFindingStubs();
  const provisionalGateway = new MemoryProvisionalRequirementGateway();
  const orchestrator = new ReviewOrchestrator(gateway, complianceGateway, null, provisionalGateway);
  return { gateway, complianceGateway, provisionalGateway, orchestrator };
}

// ── 1–4. Role compatibility ───────────────────────────────────────────────────

describe("1–4. Role compatibility", () => {
  it("1. main_specification is in specificationRoles", () => {
    expect(specificationRoles).toContain("main_specification");
  });

  it("2. specification is in specificationRoles", () => {
    expect(specificationRoles).toContain("specification");
  });

  it("3. product_datasheet is in submissionRoles", () => {
    expect(submissionRoles).toContain("product_datasheet");
  });

  it("4. proposed_product (legacy) is in submissionRoles", () => {
    expect(submissionRoles).toContain("proposed_product");
  });

  it("no specificationRole overlaps with submissionRoles (roles are mutually exclusive)", () => {
    for (const role of specificationRoles) {
      expect(submissionRoles).not.toContain(role);
    }
  });

  it("contractor_submission is in submissionRoles", () => {
    expect(submissionRoles).toContain("contractor_submission");
  });
});

// ── 5, 13, 17, 18. Review lifecycle ──────────────────────────────────────────

describe("5, 13, 17, 18. Review lifecycle — main_specification + product_datasheet", () => {
  let gateway: MemoryReviewGateway;
  let complianceGateway: MemoryComplianceGateway;
  let provisionalGateway: MemoryProvisionalRequirementGateway;
  let orchestrator: ReviewOrchestrator;

  beforeEach(() => {
    ({ gateway, complianceGateway, provisionalGateway, orchestrator } = makeOrchestrator());
    // Seed a review in draft status using the same org-1 as baseInput()
    gateway.seedReview(makeTestReviewRow({ id: IDS.review, project_id: IDS.project }));
    gateway.seedProjectDocuments([
      { id: IDS.specDoc, document_role: "main_specification", processing_status: "completed" },
      { id: IDS.subDoc,  document_role: "product_datasheet",  processing_status: "completed" }
    ]);
    gateway.seedChunks([
      makeChunk({ id: "sub-c", document_id: IDS.subDoc,
        chunk_text: "Product datasheet content.", normalized_text: "Product datasheet content." })
    ]);
  });

  it("5. Review enters running then reaches awaiting_human_review", async () => {
    gateway.seedRequirements([
      makeTestRequirementRow({
        id: "req-1", project_id: IDS.project, source_document_id: IDS.specDoc,
        requirement_text: "Drivers must be provided.", mandatory_level: "mandatory"
      })
    ]);
    complianceGateway.seedCondition(makeCondition({ requirement_id: "req-1" }));

    const result = await orchestrator.runControlledReview(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("awaiting_human_review");
    const reviewRow = gateway.getReviewRow(IDS.review);
    expect(reviewRow?.status).toBe("awaiting_human_review");
  });

  it("13. Review completed — audit events include started and completed", async () => {
    gateway.seedChunks([
      makeChunk({ id: "spec-c", document_id: IDS.specDoc,
        chunk_text: "Equipment shall be installed.", normalized_text: "Equipment shall be installed." })
    ]);

    const result = await orchestrator.runControlledReview(baseInput());

    expect(result.ok).toBe(true);
    const actions = gateway.auditLog.map((a) => a.action);
    expect(actions).toContain("controlled_review.started");
    expect(actions).toContain("controlled_review.completed_to_human_review");
    expect(actions).not.toContain("controlled_review.failed");
  });

  it("17. No automatic approval — review stays in awaiting_human_review, not approved", async () => {
    gateway.seedRequirements([
      makeTestRequirementRow({
        id: "req-auto", project_id: IDS.project, source_document_id: IDS.specDoc,
        requirement_text: "Equipment shall comply.", mandatory_level: "mandatory"
      })
    ]);
    complianceGateway.seedCondition(makeCondition({ requirement_id: "req-auto" }));

    const result = await orchestrator.runControlledReview(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).not.toBe("approved");
    const reviewRow = gateway.getReviewRow(IDS.review);
    expect(reviewRow?.status).not.toBe("approved");
    expect(reviewRow?.status).toBe("awaiting_human_review");
  });

  it("18. No external AI HTTP calls in deterministic mode", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: false, status: 500, json: async () => ({})
    } as Response);

    await orchestrator.runControlledReview(baseInput());

    const aiCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === "string" && (
        url.includes("anthropic") || url.includes("openai") || url.includes("claude")
      )
    );
    expect(aiCalls).toHaveLength(0);
    fetchSpy.mockRestore();
  });
});

// ── 6–7. Provisional requirement discovery and persistence ────────────────────

describe("6–7. Provisional requirement discovery and auto-condition creation", () => {
  it("6. Chunks with mandatory language ('must', 'shall') produce provisional requirements", async () => {
    const { gateway, provisionalGateway, orchestrator } = makeOrchestrator();
    gateway.seedReview(makeTestReviewRow({ id: IDS.review, project_id: IDS.project }));
    gateway.seedProjectDocuments([
      { id: IDS.specDoc, document_role: "main_specification", processing_status: "completed" },
      { id: IDS.subDoc,  document_role: "product_datasheet",  processing_status: "completed" }
    ]);
    // Spec chunks: one mandatory, one informative
    gateway.seedChunks([
      makeChunk({ id: "spec-m", document_id: IDS.specDoc,
        chunk_text: "Drivers must be high-quality full-range units.",
        normalized_text: "Drivers must be high-quality full-range units." }),
      makeChunk({ id: "spec-i", document_id: IDS.specDoc,
        chunk_text: "This section provides general guidance only.",
        normalized_text: "This section provides general guidance only." })
    ]);

    await orchestrator.runControlledReview(baseInput());

    const persisted = provisionalGateway.rows;
    expect(persisted.length).toBeGreaterThanOrEqual(1);
    expect(persisted.every((r) => r.requirement_state === "provisional")).toBe(true);
    // Only the mandatory-language chunk should be in requirements
    expect(persisted.some((r) => r.requirement_text.toLowerCase().includes("must"))).toBe(true);
  });

  it("6. Provisional requirements get real IDs from gateway (not synthetic timestamp IDs)", async () => {
    const { gateway, provisionalGateway, orchestrator } = makeOrchestrator();
    gateway.seedReview(makeTestReviewRow({ id: IDS.review, project_id: IDS.project }));
    gateway.seedProjectDocuments([
      { id: IDS.specDoc, document_role: "specification", processing_status: "completed" },
      { id: IDS.subDoc,  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    gateway.seedChunks([
      makeChunk({ id: "spec-c", document_id: IDS.specDoc,
        chunk_text: "Equipment shall comply with BS 5839-8.",
        normalized_text: "Equipment shall comply with BS 5839-8." })
    ]);

    await orchestrator.runControlledReview(baseInput());

    const persisted = provisionalGateway.rows;
    expect(persisted.length).toBeGreaterThanOrEqual(1);
    // IDs from MemoryProvisionalRequirementGateway follow "req-N" pattern, not "provisional-{ts}"
    for (const r of persisted) {
      expect(r.id).not.toMatch(/^provisional-\d+-\d+$/);
      expect(r.id.trim().length).toBeGreaterThan(0);
    }
  });

  it("7. Auto-condition is created for provisional requirement with no pre-existing conditions", async () => {
    const { gateway, complianceGateway, orchestrator } = makeOrchestrator();
    gateway.seedReview(makeTestReviewRow({ id: IDS.review, project_id: IDS.project }));
    gateway.seedProjectDocuments([
      { id: IDS.specDoc, document_role: "main_specification", processing_status: "completed" },
      { id: IDS.subDoc,  document_role: "product_datasheet",  processing_status: "completed" }
    ]);
    gateway.seedChunks([
      makeChunk({ id: "spec-c", document_id: IDS.specDoc,
        chunk_text: "The driver shall have a 3.5-inch diameter.",
        normalized_text: "The driver shall have a 3.5-inch diameter." })
    ]);
    // No conditions seeded — auto-creation should fire

    await orchestrator.runControlledReview(baseInput());

    expect(complianceGateway.conditions.length).toBeGreaterThanOrEqual(1);
    const autoCond = complianceGateway.conditions.find((c) => c.condition_key === "auto_presence_check");
    expect(autoCond).toBeDefined();
    expect(autoCond?.condition_type).toBe("boolean");
    expect(autoCond?.is_mandatory).toBe(true);
  });

  it("7. Review produces at least one finding when mandatory chunks exist and conditions are created", async () => {
    const { gateway, complianceGateway, orchestrator } = makeOrchestrator();
    gateway.seedReview(makeTestReviewRow({ id: IDS.review, project_id: IDS.project }));
    gateway.seedProjectDocuments([
      { id: IDS.specDoc, document_role: "main_specification", processing_status: "completed" },
      { id: IDS.subDoc,  document_role: "product_datasheet",  processing_status: "completed" }
    ]);
    gateway.seedChunks([
      makeChunk({ id: "spec-c", document_id: IDS.specDoc,
        chunk_text: "Loudspeakers shall comply with the specification.",
        normalized_text: "Loudspeakers shall comply with the specification." }),
      makeChunk({ id: "sub-c", document_id: IDS.subDoc,
        chunk_text: "Product complies with specification requirements.",
        normalized_text: "Product complies with specification requirements." })
    ]);

    const result = await orchestrator.runControlledReview(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.findingCount).toBeGreaterThanOrEqual(1);
    expect(result.data.conditionCount).toBeGreaterThanOrEqual(1);
    expect(complianceGateway.evaluations.length).toBeGreaterThanOrEqual(1);
  });
});

// ── 8. Evidence retrieval excludes specification documents ─────────────────────

describe("8. Evidence retrieval only searches submission documents", () => {
  it("spec document chunks are not used as evidence sources", async () => {
    const { gateway, complianceGateway, orchestrator } = makeOrchestrator();
    gateway.seedReview(makeTestReviewRow({ id: IDS.review, project_id: IDS.project }));
    gateway.seedProjectDocuments([
      { id: IDS.specDoc, document_role: "main_specification", processing_status: "completed" },
      { id: IDS.subDoc,  document_role: "product_datasheet",  processing_status: "completed" }
    ]);
    // Pre-seeded requirement (so no chunk discovery for spec doc)
    gateway.seedRequirements([
      makeTestRequirementRow({
        id: "req-marker", project_id: IDS.project, source_document_id: IDS.specDoc,
        requirement_text: "UNIQUE_SPEC_MARKER shall be present.",
        mandatory_level: "mandatory"
      })
    ]);
    // Spec chunk contains the marker — but it should NOT be used as evidence
    // Only the sub-chunk should be searched
    gateway.seedChunks([
      makeChunk({ id: "spec-c", document_id: IDS.specDoc,
        chunk_text: "UNIQUE_SPEC_MARKER shall be present.", // spec doc, should not be evidence
        normalized_text: "UNIQUE_SPEC_MARKER shall be present." }),
      makeChunk({ id: "sub-c", document_id: IDS.subDoc,
        chunk_text: "Submission contents.", // sub doc, no marker
        normalized_text: "Submission contents." })
    ]);
    // Condition that searches for the marker
    complianceGateway.seedCondition(makeCondition({
      requirement_id: "req-marker",
      condition_type: "feature_required",
      attribute: "UNIQUE_SPEC_MARKER",
      expected_text: "UNIQUE_SPEC_MARKER"
    }));

    const result = await orchestrator.runControlledReview(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Evidence from spec doc was NOT retrieved → condition finds no evidence → not_proven
    // (sub-doc chunk "Submission contents." doesn't mention UNIQUE_SPEC_MARKER)
    const evaluations = complianceGateway.evaluations;
    expect(evaluations.length).toBeGreaterThanOrEqual(1);
    // All evaluations must be not_proven or similar (evidence not found in submission)
    for (const e of evaluations) {
      // UNIQUE_SPEC_MARKER is not in the sub-doc, so it cannot appear in evidence_summary
      const summary = e.evidence_summary ?? "";
      expect(summary).not.toContain("UNIQUE_SPEC_MARKER");
    }
  });
});

// ── 9. Numeric size condition complies ────────────────────────────────────────

describe("9. Numeric size condition: value within range → complied", () => {
  const svc = new ConditionComparisonService();

  it('3.5" (quote unit) within [3.5, 4.0] inch range → complied', () => {
    const condition = makeCondition({
      condition_type: "numeric_range",
      subject: "driver", attribute: "diameter",
      operator: "between",
      expected_min_value: 3.5, expected_max_value: 4.0,
      expected_unit: "inch", expected_text: null
    });
    // Use `"` (double-quote) as shorthand for inches — normalises to "inch"
    const evidence = makeEvidence({ primaryQuote: '3.5" HQ drivers', sufficiency: "direct" });
    const result = svc.compare(condition, evidence);
    expect(result.status).toBe("complied");
  });

  it("4 inch at upper bound → complied", () => {
    const condition = makeCondition({
      condition_type: "numeric_range", subject: "driver", attribute: "diameter",
      operator: "between", expected_min_value: 3.5, expected_max_value: 4.0,
      expected_unit: "inch", expected_text: null
    });
    const evidence = makeEvidence({ primaryQuote: '4" drivers', sufficiency: "direct" });
    expect(svc.compare(condition, evidence).status).toBe("complied");
  });

  it("no evidence for numeric range → not_proven", () => {
    const condition = makeCondition({
      condition_type: "numeric_range", subject: "driver", attribute: "diameter",
      operator: "between", expected_min_value: 3.5, expected_max_value: 4.0,
      expected_unit: "inch", expected_text: null
    });
    expect(svc.compare(condition, makeEvidence()).status).toBe("not_proven");
  });

  it("5 inch exceeds upper bound → not_complied", () => {
    const condition = makeCondition({
      condition_type: "numeric_range", subject: "driver", attribute: "diameter",
      operator: "between", expected_min_value: 3.5, expected_max_value: 4.0,
      expected_unit: "inch", expected_text: null
    });
    const evidence = makeEvidence({ primaryQuote: '5" drivers', sufficiency: "direct" });
    expect(svc.compare(condition, evidence).status).toBe("not_complied");
  });
});

// ── 10. Missing full-range → not_proven when no evidence found ─────────────────

describe("10. Missing full-range: no evidence → not_proven", () => {
  const svc = new ConditionComparisonService();

  it("feature_required with no evidence → not_proven", () => {
    const condition = makeCondition({
      condition_type: "feature_required",
      subject: "driver", attribute: "full-range construction",
      operator: "exists", expected_text: "full-range"
    });
    expect(svc.compare(condition, makeEvidence()).status).toBe("not_proven");
  });

  it("text_match condition: evidence found but not confirming → ambiguous", () => {
    // text_match falls into the "requires AI" branch → ambiguous when evidence exists
    const condition = makeCondition({
      condition_type: "text_match",
      subject: "driver", attribute: "type",
      operator: "contains", expected_text: "full-range"
    });
    // sufficiency "partial" = evidence found but not confirmatory
    const evidence = makeEvidence({ primaryQuote: "HQ drivers", sufficiency: "partial" });
    const result = svc.compare(condition, evidence);
    // text_match with evidence present falls through to the ambiguous/not-proven branch
    expect(["ambiguous", "not_proven"]).toContain(result.status);
  });

  it("text_match with no evidence → not_proven", () => {
    const condition = makeCondition({
      condition_type: "text_match",
      subject: "driver", attribute: "type",
      operator: "contains", expected_text: "full-range"
    });
    expect(svc.compare(condition, makeEvidence()).status).toBe("not_proven");
  });
});

// ── 11. Missing neodymium → not_proven when no evidence found ─────────────────

describe("11. Missing neodymium: no evidence → not_proven", () => {
  const svc = new ConditionComparisonService();

  it("material_required with no evidence → not_proven", () => {
    const condition = makeCondition({
      condition_type: "material_required",
      subject: "driver", attribute: "magnet material",
      operator: "exists", expected_text: "neodymium"
    });
    expect(svc.compare(condition, makeEvidence()).status).toBe("not_proven");
  });

  it("text_match condition for neodymium: no evidence → not_proven", () => {
    const condition = makeCondition({
      condition_type: "text_match",
      subject: "driver", attribute: "magnet material",
      operator: "contains", expected_text: "neodymium"
    });
    expect(svc.compare(condition, makeEvidence()).status).toBe("not_proven");
  });

  it("compareRequiredEvidencePresence: absent expected → not_proven", () => {
    const condition = makeCondition({
      condition_type: "material_required",
      subject: "driver", attribute: "magnet material",
      operator: "exists", expected_text: "neodymium"
    });
    const result = svc.compare(condition, makeEvidence({ primaryQuote: null }));
    expect(result.status).toBe("not_proven");
  });
});

// ── 12. Parent status derivation ──────────────────────────────────────────────

describe("12. Parent status: mixed evaluations → partially_complied", () => {
  it("1 complied + 2 not_proven + 1 ambiguous → partially_complied", () => {
    const evals = [
      { id: "e1", status: "complied"       as ConditionEvaluationStatus, humanStatus: null, isMandatory: true, isHumanReviewRequired: false },
      { id: "e2", status: "not_proven"      as ConditionEvaluationStatus, humanStatus: null, isMandatory: true, isHumanReviewRequired: true  },
      { id: "e3", status: "not_proven"      as ConditionEvaluationStatus, humanStatus: null, isMandatory: true, isHumanReviewRequired: true  },
      { id: "e4", status: "ambiguous"       as ConditionEvaluationStatus, humanStatus: null, isMandatory: true, isHumanReviewRequired: true  }
    ];
    expect(deriveParentFindingStatus(evals).status).toBe("partially_complied");
  });

  it("all not_proven → not_proven (no compliance at all)", () => {
    const evals = [
      { id: "e1", status: "not_proven" as ConditionEvaluationStatus, humanStatus: null, isMandatory: true, isHumanReviewRequired: true },
      { id: "e2", status: "not_proven" as ConditionEvaluationStatus, humanStatus: null, isMandatory: true, isHumanReviewRequired: true }
    ];
    expect(deriveParentFindingStatus(evals).status).toBe("not_proven");
  });

  it("all complied → complied", () => {
    const evals = [
      { id: "e1", status: "complied" as ConditionEvaluationStatus, humanStatus: null, isMandatory: true, isHumanReviewRequired: false },
      { id: "e2", status: "complied" as ConditionEvaluationStatus, humanStatus: null, isMandatory: true, isHumanReviewRequired: false }
    ];
    expect(deriveParentFindingStatus(evals).status).toBe("complied");
  });

  it("direct contradiction → not_complied", () => {
    const evals = [
      { id: "e1", status: "complied"     as ConditionEvaluationStatus, humanStatus: null, isMandatory: true, isHumanReviewRequired: false },
      { id: "e2", status: "not_complied" as ConditionEvaluationStatus, humanStatus: null, isMandatory: true, isHumanReviewRequired: true  }
    ];
    expect(deriveParentFindingStatus(evals).status).toBe("not_complied");
  });

  it("requiresHumanReview is true when any condition requires review", () => {
    const evals = [
      { id: "e1", status: "complied"  as ConditionEvaluationStatus, humanStatus: null, isMandatory: true, isHumanReviewRequired: false },
      { id: "e2", status: "ambiguous" as ConditionEvaluationStatus, humanStatus: null, isMandatory: true, isHumanReviewRequired: true  }
    ];
    expect(deriveParentFindingStatus(evals).requiresHumanReview).toBe(true);
  });
});

// ── 14. Workspace — evaluations persisted ────────────────────────────────────

describe("14. Workspace — finding evaluations persisted in compliance gateway", () => {
  it("after deterministic review runs, evaluations are stored with correct review_id", async () => {
    const { gateway, complianceGateway, orchestrator } = makeOrchestrator();
    gateway.seedReview(makeTestReviewRow({ id: IDS.review, project_id: IDS.project }));
    gateway.seedProjectDocuments([
      { id: IDS.specDoc, document_role: "main_specification", processing_status: "completed" },
      { id: IDS.subDoc,  document_role: "product_datasheet",  processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({
        id: "req-ws", project_id: IDS.project, source_document_id: IDS.specDoc,
        requirement_text: "Drivers shall be present.", mandatory_level: "mandatory"
      })
    ]);
    gateway.seedChunks([
      makeChunk({ id: "sub-c", document_id: IDS.subDoc,
        chunk_text: "Drivers are present.", normalized_text: "Drivers are present." })
    ]);
    complianceGateway.seedCondition(makeCondition({ requirement_id: "req-ws" }));

    await orchestrator.runControlledReview(baseInput());

    expect(complianceGateway.evaluations.length).toBeGreaterThanOrEqual(1);
    const eval_ = complianceGateway.evaluations[0];
    expect(eval_?.review_id).toBe(IDS.review);
    expect(eval_?.project_id).toBe(IDS.project);
    expect(eval_?.status).toBeDefined();
  });
});

// ── 15–16. Reviewer actions ────────────────────────────────────────────────────

describe("15–16. Reviewer actions and human decision preservation", () => {
  it("15. Human status applied to evaluation is stored", async () => {
    const complianceGateway = new MemoryComplianceGateway();
    const evalRow = await complianceGateway.insertEvaluation({
      organization_id: IDS.org, project_id: IDS.project,
      review_id: IDS.review, finding_id: "finding-1",
      requirement_id: "req-1", requirement_condition_id: "cond-1",
      status: "not_proven", evidence_summary: null,
      reasoning: "No evidence found.",
      contradiction_reasoning: null,
      missing_information: "Driver specification not provided.",
      verification_failure_reason: null,
      contractor_action: "Provide driver spec.",
      confidence_score: 45, weightage_score: 1,
      is_human_review_required: true, is_active: true, revision_number: 1
    });

    const updated = await complianceGateway.applyHumanReviewStatus(
      evalRow.id, IDS.org,
      "not_complied",
      "Reviewer confirmed: no evidence of driver type.",
      IDS.user,
      new Date().toISOString()
    );

    expect(updated?.human_status).toBe("not_complied");
    expect(updated?.reviewed_by).toBe(IDS.user);
    expect(updated?.human_comment).toBe("Reviewer confirmed: no evidence of driver type.");
  });

  it("16. Human decision is preserved — overwrite attempt throws HUMAN_APPROVAL_PROTECTED", async () => {
    const complianceGateway = new MemoryComplianceGateway();
    const evalRow = await complianceGateway.insertEvaluation({
      organization_id: IDS.org, project_id: IDS.project,
      review_id: IDS.review, finding_id: "finding-1",
      requirement_id: "req-1", requirement_condition_id: "cond-1",
      status: "not_proven", evidence_summary: null,
      reasoning: "No evidence.", contradiction_reasoning: null,
      missing_information: "Documentation missing.",
      verification_failure_reason: null, contractor_action: null,
      confidence_score: 45, weightage_score: 1,
      is_human_review_required: true, is_active: true, revision_number: 1
    });

    // Apply human review
    await complianceGateway.applyHumanReviewStatus(
      evalRow.id, IDS.org, "complied",
      "Reviewer confirmed.", IDS.user, new Date().toISOString()
    );

    // Verify human_status is set
    const afterHuman = complianceGateway.evaluations.find((e) => e.id === evalRow.id);
    expect(afterHuman?.human_status).toBe("complied");

    // Overwrite attempt must throw (human approval is protected)
    await expect(
      complianceGateway.persistEvaluationAndRefreshParent({
        organizationId: IDS.org, projectId: IDS.project,
        reviewId: IDS.review, findingId: "finding-1",
        requirementId: "req-1", requirementConditionId: "cond-1",
        status: "not_proven",
        evidenceSummary: null, reasoning: "Re-run attempt.",
        contradictionReasoning: null, missingInformation: null,
        verificationFailureReason: null, contractorAction: null,
        confidenceScore: 45, weightageScore: 1, isHumanReviewRequired: true,
        evidenceLinks: [],
        deterministicParentStatus: "not_proven",
        deterministicParentReasoning: "No evidence.",
        deterministicRequiresHumanReview: true,
        createdBy: IDS.user
      })
    ).rejects.toThrow();

    // Human status is still "complied" — not overwritten
    const afterRerun = complianceGateway.evaluations.find(
      (e) => e.id === evalRow.id && e.human_status !== null
    );
    expect(afterRerun?.human_status).toBe("complied");
  });
});

// ── Full orchestrator integration ─────────────────────────────────────────────

describe("Full deterministic review integration (all phases)", () => {
  it("produces awaiting_human_review with legacy main_specification + product_datasheet roles", async () => {
    const { gateway, complianceGateway, orchestrator } = makeOrchestrator();
    gateway.seedReview(makeTestReviewRow({ id: IDS.review, project_id: IDS.project }));
    gateway.seedProjectDocuments([
      { id: IDS.specDoc, document_role: "main_specification", processing_status: "completed" },
      { id: IDS.subDoc,  document_role: "product_datasheet",  processing_status: "completed" }
    ]);
    gateway.seedRequirements([
      makeTestRequirementRow({
        id: "req-full", project_id: IDS.project, source_document_id: IDS.specDoc,
        requirement_text: "Drivers shall be high-quality.",
        mandatory_level: "mandatory"
      })
    ]);
    gateway.seedChunks([makeChunk()]);
    complianceGateway.seedCondition(makeCondition({ requirement_id: "req-full" }));

    const result = await orchestrator.runControlledReview(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.status).toBe("awaiting_human_review");
    expect(result.data.findingCount).toBeGreaterThanOrEqual(1);
    expect(result.data.conditionCount).toBeGreaterThanOrEqual(1);
  });

  it("provisional requirement from chunk gets real ID and triggers auto-condition", async () => {
    const { gateway, complianceGateway, provisionalGateway, orchestrator } = makeOrchestrator();
    gateway.seedReview(makeTestReviewRow({ id: IDS.review, project_id: IDS.project }));
    gateway.seedProjectDocuments([
      { id: IDS.specDoc, document_role: "specification",         processing_status: "completed" },
      { id: IDS.subDoc,  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    // No pre-extracted requirements
    gateway.seedChunks([
      makeChunk({ id: "spec-c1", document_id: IDS.specDoc,
        chunk_text: "The loudspeaker shall meet all performance requirements.",
        normalized_text: "The loudspeaker shall meet all performance requirements." })
    ]);

    const result = await orchestrator.runControlledReview(baseInput());

    expect(result.ok).toBe(true);

    // Provisional requirement persisted with real ID
    const persisted = provisionalGateway.rows;
    expect(persisted.length).toBeGreaterThanOrEqual(1);
    for (const r of persisted) {
      expect(r.id).not.toMatch(/^provisional-\d+-\d+$/);
      expect(r.requirement_state).toBe("provisional");
    }

    // Auto-condition created (no pre-existing conditions for provisional req)
    expect(complianceGateway.conditions.length).toBeGreaterThanOrEqual(1);
    expect(complianceGateway.conditions.some((c) => c.condition_key === "auto_presence_check")).toBe(true);

    // At least one evaluation recorded
    if (result.ok && result.data.findingCount > 0) {
      expect(complianceGateway.evaluations.length).toBeGreaterThanOrEqual(1);
    }
  });
});
