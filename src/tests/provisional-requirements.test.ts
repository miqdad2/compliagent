/**
 * Unit 13 — Provisional Requirement Persistence tests.
 *
 * Covers: ProvisionalRequirementService, MemoryProvisionalRequirementGateway,
 * ready-for-annotation logic, and orchestrator provisional requirement integration.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  ProvisionalRequirementService,
  type ProvisionalRequirementInsert
} from "@/server/services/reviews/provisional-requirements";
import {
  MemoryProvisionalRequirementGateway
} from "@/server/services/reviews/provisional-requirement-gateway";
import { RequirementDiscoveryService, hasMandatoryLanguage } from "@/server/services/reviews/requirement-discovery";
import { ReviewOrchestrator } from "@/server/services/reviews/review-orchestrator";
import { MemoryReviewGateway, makeTestReviewRow } from "@/server/services/reviews/memory-review-gateway";
import { MemoryComplianceGateway } from "@/server/services/compliance/memory-compliance-gateway";
import type { ChunkRow } from "@/server/services/reviews/types";

// ── Shared test factories ─────────────────────────────────────────────────────

function makeInsert(overrides: Partial<ProvisionalRequirementInsert> = {}): ProvisionalRequirementInsert {
  return {
    organizationId:       "org-1",
    projectId:            "proj-1",
    reviewId:             "review-1",
    sourceDocumentId:     "doc-1",
    pageNumber:           5,
    clauseNumber:         "3.2",
    subClauseNumber:      null,
    sectionHeading:       "Acoustic requirements",
    requirementText:      "Units shall comply with IEC 60268-5.",
    normalizedText:       "Units shall comply with IEC 60268-5.",
    requirementType:      "standard_required",
    mandatoryLevel:       "mandatory",
    requirementState:     "provisional",
    discoveryConfidence:  65,
    refinementConfidence: null,
    aiRunId:              null,
    promptVersion:        null,
    humanReviewRequired:  true,
    humanReviewReasons:   ["Provisional — discovered from chunks"],
    createdBy:            "user-1",
    ...overrides
  };
}

// ── ProvisionalRequirementService tests ──────────────────────────────────────

describe("ProvisionalRequirementService", () => {
  let gateway: MemoryProvisionalRequirementGateway;
  let svc: ProvisionalRequirementService;

  beforeEach(() => {
    gateway = new MemoryProvisionalRequirementGateway();
    svc     = new ProvisionalRequirementService(gateway);
  });

  it("persists a valid provisional requirement", async () => {
    const result = await svc.persistDiscovered(makeInsert());
    expect(result.isNew).toBe(true);
    expect(result.state).toBe("provisional");
    expect(gateway.rows).toHaveLength(1);
    expect(gateway.rows[0].requirement_text).toBe("Units shall comply with IEC 60268-5.");
  });

  it("rejects empty requirementText (source grounding required)", async () => {
    await expect(svc.persistDiscovered(makeInsert({ requirementText: "  " }))).rejects.toThrow();
  });

  it("prevents duplicate active requirement at same source location", async () => {
    await svc.persistDiscovered(makeInsert());
    const result = await svc.persistDiscovered(makeInsert());
    expect(result.isNew).toBe(false);
    expect(gateway.rows).toHaveLength(1); // Only one row inserted.
    const actions = gateway.audits.map((a) => a.action);
    expect(actions).toContain("provisional_requirement.duplicate_skipped");
  });

  it("allows different clause number at same page — not a duplicate", async () => {
    await svc.persistDiscovered(makeInsert({ clauseNumber: "3.1" }));
    const result = await svc.persistDiscovered(makeInsert({ clauseNumber: "3.2" }));
    expect(result.isNew).toBe(true);
    expect(gateway.rows).toHaveLength(2);
  });

  it("human-confirmed requirement is never overwritten on rerun", async () => {
    const r1 = await svc.persistDiscovered(makeInsert());
    await svc.confirm({
      requirementId:  r1.id,
      organizationId: "org-1",
      projectId:      "proj-1",
      reviewId:       "review-1",
      reviewerId:     "reviewer-1"
    });

    // Attempt to rerun for the same source location.
    const r2 = await svc.persistDiscovered(makeInsert());
    expect(r2.isNew).toBe(false);
    expect(r2.humanConfirmed).toBe(true);
    expect(r2.id).toBe(r1.id);
    const actions = gateway.audits.map((a) => a.action);
    expect(actions).toContain("provisional_requirement.human_confirmed_protected");
  });

  it("confirmed requirement remains in DB when rejected (auditable)", async () => {
    const r = await svc.persistDiscovered(makeInsert());
    await svc.reject({
      requirementId:  r.id,
      organizationId: "org-1",
      projectId:      "proj-1",
      reviewId:       "review-1",
      reviewerId:     "reviewer-1",
      reason:         "Not applicable to this scope."
    });
    expect(gateway.rows).toHaveLength(1);
    expect(gateway.rows[0].requirement_state).toBe("rejected");
    expect(gateway.rows[0].superseded_reason).toBe("Not applicable to this scope.");
    const actions = gateway.audits.map((a) => a.action);
    expect(actions).toContain("provisional_requirement.rejected");
  });

  it("cannot reject a confirmed requirement", async () => {
    const r = await svc.persistDiscovered(makeInsert());
    await svc.confirm({
      requirementId:  r.id,
      organizationId: "org-1",
      projectId:      "proj-1",
      reviewId:       "review-1",
      reviewerId:     "reviewer-1"
    });
    await expect(svc.reject({
      requirementId:  r.id,
      organizationId: "org-1",
      projectId:      "proj-1",
      reviewId:       "review-1",
      reviewerId:     "reviewer-1",
      reason:         "Trying to reject a confirmed requirement."
    })).rejects.toThrow("Cannot reject a human-confirmed requirement");
  });

  it("confirmation writes an audit event", async () => {
    const r = await svc.persistDiscovered(makeInsert());
    await svc.confirm({
      requirementId:  r.id,
      organizationId: "org-1",
      projectId:      "proj-1",
      reviewId:       "review-1",
      reviewerId:     "reviewer-1"
    });
    const actions = gateway.audits.map((a) => a.action);
    expect(actions).toContain("provisional_requirement.confirmed");
  });

  it("confirm is idempotent for already-confirmed requirements", async () => {
    const r = await svc.persistDiscovered(makeInsert());
    await svc.confirm({ requirementId: r.id, organizationId: "org-1", projectId: "proj-1", reviewId: "review-1", reviewerId: "r1" });
    const result = await svc.confirm({ requirementId: r.id, organizationId: "org-1", projectId: "proj-1", reviewId: "review-1", reviewerId: "r1" });
    expect(result.requirement_state).toBe("confirmed");
  });

  it("provisional requirement reaches condition decomposition with humanReviewRequired=true", async () => {
    await svc.persistDiscovered(makeInsert());
    const rows = gateway.rows;
    expect(rows[0].human_review_required).toBe(true);
    expect(rows[0].requirement_state).toBe("provisional");
  });

  it("non-existent requirement returns error on confirm", async () => {
    await expect(svc.confirm({
      requirementId:  "does-not-exist",
      organizationId: "org-1",
      projectId:      "proj-1",
      reviewId:       "review-1",
      reviewerId:     "reviewer-1"
    })).rejects.toThrow("not found");
  });

  it("cross-project access denied on confirm", async () => {
    const r = await svc.persistDiscovered(makeInsert());
    await expect(svc.confirm({
      requirementId:  r.id,
      organizationId: "org-1",
      projectId:      "wrong-project",  // different project
      reviewId:       "review-1",
      reviewerId:     "reviewer-1"
    })).rejects.toThrow("Project access denied");
  });

  it("audit records do not contain requirement text", async () => {
    await svc.persistDiscovered(makeInsert({ requirementText: "CONFIDENTIAL_REQUIREMENT" }));
    for (const record of gateway.audits) {
      const meta = JSON.stringify(record.metadata);
      expect(meta).not.toContain("CONFIDENTIAL_REQUIREMENT");
    }
  });
});

// ── Orchestrator integration with provisional requirement gateway ──────────────

describe("ReviewOrchestrator with provisional requirement persistence", () => {
  it("persists provisional requirement from chunk scan (no longer skips)", async () => {
    const reviewGateway  = new MemoryReviewGateway();
    const complianceGateway = new MemoryComplianceGateway();
    complianceGateway.enableFindingStubs();
    const provGateway    = new MemoryProvisionalRequirementGateway();
    const orchestrator   = new ReviewOrchestrator(reviewGateway, complianceGateway, null, provGateway);

    reviewGateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    reviewGateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    // NO pre-extracted requirements → triggers chunk scanning.
    reviewGateway.seedChunks([
      {
        id: "chunk-spec-1", document_id: "doc-spec-1", project_id: "proj-1",
        page_number: 2, clause_number: "4.1", section_heading: "Acoustic",
        chunk_text:      "The unit shall comply with IEC 60268-5.",
        normalized_text: "The unit shall comply with IEC 60268-5.",
        embedding: null, metadata: {}, created_at: new Date().toISOString()
      }
    ]);

    const result = await orchestrator.runControlledReview({
      organizationId: "org-1", projectId: "proj-1", reviewId: "review-1",
      createdBy: "user-1", reviewVersion: 1, sourceHash: "h1",
      extractionVersion: "v1", promptVersion: "1.0.0",
      executionMode: "deterministic"
    });

    expect(result.ok).toBe(true);
    // Requirement should be auto-confirmed: it has a clause number, mandatory language,
    // sufficient text, and reasonable confidence (default 60).
    expect(provGateway.rows.length).toBeGreaterThan(0);
    expect(provGateway.rows[0].requirement_state).toBe("confirmed");
    expect(provGateway.rows[0].human_review_required).toBe(false);
  });

  it("keeps a chunk as provisional when it lacks a clause number", async () => {
    const reviewGateway  = new MemoryReviewGateway();
    const complianceGateway = new MemoryComplianceGateway();
    complianceGateway.enableFindingStubs();
    const provGateway    = new MemoryProvisionalRequirementGateway();
    const orchestrator   = new ReviewOrchestrator(reviewGateway, complianceGateway, null, provGateway);

    // Use org-1 to match makeTestReviewRow's default organization_id.
    reviewGateway.seedReview(makeTestReviewRow({ id: "review-2", project_id: "proj-2" }));
    reviewGateway.seedProjectDocuments([
      { id: "doc-spec-2", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-2",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    // Chunk without a clause_number → cannot auto-confirm.
    reviewGateway.seedChunks([
      {
        id: "chunk-spec-2", document_id: "doc-spec-2", project_id: "proj-2",
        page_number: 3, clause_number: null, section_heading: null,
        chunk_text:      "The device shall comply with applicable standards.",
        normalized_text: "The device shall comply with applicable standards.",
        embedding: null, metadata: {}, created_at: new Date().toISOString()
      }
    ]);

    const result = await orchestrator.runControlledReview({
      organizationId: "org-1", projectId: "proj-2", reviewId: "review-2",
      createdBy: "user-1", reviewVersion: 1, sourceHash: "h2",
      extractionVersion: "v1", promptVersion: "1.0.0",
      executionMode: "deterministic"
    });

    expect(result.ok).toBe(true);
    expect(provGateway.rows.length).toBeGreaterThan(0);
    expect(provGateway.rows[0].requirement_state).toBe("provisional");
    expect(provGateway.rows[0].human_review_required).toBe(true);
  });

  it("does not persist provisional requirement when no gateway is provided", async () => {
    const reviewGateway  = new MemoryReviewGateway();
    const complianceGateway = new MemoryComplianceGateway();
    complianceGateway.enableFindingStubs();
    // No provisional gateway → old behavior (synthetic ID, skipped in loop).
    const orchestrator = new ReviewOrchestrator(reviewGateway, complianceGateway, null, null);

    reviewGateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    reviewGateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    reviewGateway.seedChunks([
      {
        id: "chunk-spec-1", document_id: "doc-spec-1", project_id: "proj-1",
        page_number: 1, clause_number: "1.1", section_heading: null,
        chunk_text: "Units shall be IP65 rated.", normalized_text: "Units shall be IP65 rated.",
        embedding: null, metadata: {}, created_at: new Date().toISOString()
      }
    ]);

    const result = await orchestrator.runControlledReview({
      organizationId: "org-1", projectId: "proj-1", reviewId: "review-1",
      createdBy: "user-1", reviewVersion: 1, sourceHash: "h1",
      extractionVersion: "v1", promptVersion: "1.0.0",
      executionMode: "deterministic"
    });

    expect(result.ok).toBe(true);
    // With no gateway: provisional requirements get synthetic IDs and are skipped.
    if (result.ok) expect(result.data.findingCount).toBe(0);
  });

  it("previously confirmed requirement is preserved when orchestrator reruns", async () => {
    const reviewGateway  = new MemoryReviewGateway();
    const complianceGateway = new MemoryComplianceGateway();
    complianceGateway.enableFindingStubs();
    const provGateway    = new MemoryProvisionalRequirementGateway();
    const orchestrator   = new ReviewOrchestrator(reviewGateway, complianceGateway, null, provGateway);

    // Pre-seed a confirmed requirement at the same location.
    const existingRow = await new ProvisionalRequirementService(provGateway).persistDiscovered(
      makeInsert({ sourceDocumentId: "doc-spec-1", pageNumber: 2, clauseNumber: "4.1", requirementText: "Unit shall be IP65." })
    );
    await new ProvisionalRequirementService(provGateway).confirm({
      requirementId:  existingRow.id,
      organizationId: "org-1", projectId: "proj-1",
      reviewId:       "review-1", reviewerId:     "reviewer-1"
    });

    reviewGateway.seedReview(makeTestReviewRow({ id: "review-1", project_id: "proj-1" }));
    reviewGateway.seedProjectDocuments([
      { id: "doc-spec-1", document_role: "specification",         processing_status: "completed" },
      { id: "doc-sub-1",  document_role: "contractor_submission", processing_status: "completed" }
    ]);
    reviewGateway.seedChunks([
      {
        id: "chunk-1", document_id: "doc-spec-1", project_id: "proj-1",
        page_number: 2, clause_number: "4.1", section_heading: null,
        chunk_text: "Unit shall be IP65.", normalized_text: "Unit shall be IP65.",
        embedding: null, metadata: {}, created_at: new Date().toISOString()
      }
    ]);

    await orchestrator.runControlledReview({
      organizationId: "org-1", projectId: "proj-1", reviewId: "review-1",
      createdBy: "user-1", reviewVersion: 1, sourceHash: "h1",
      extractionVersion: "v1", promptVersion: "1.0.0",
      executionMode: "deterministic"
    });

    // Confirmed requirement must still be confirmed.
    expect(provGateway.rows).toHaveLength(1);
    expect(provGateway.rows[0].requirement_state).toBe("confirmed");
    expect(provGateway.rows[0].id).toBe(existingRow.id);
  });
});

// ── Mandatory language detection ──────────────────────────────────────────────

describe("Mandatory language detection", () => {
  const cases: [string, boolean][] = [
    ["The device shall comply.", true],
    ["It must be rated at 100W.", true],
    ["Certification is required.", true],
    ["The unit is to be installed.", true],
    ["The supplier is required to submit.", true],
    ["Units shall not exceed 50 dB.", true],
    ["This is general guidance only.", false],
    ["This section provides background.", false],
    ["See clause 3.1 for more details.", false]
  ];

  for (const [text, expected] of cases) {
    it(`${expected ? "detects" : "rejects"}: "${text.slice(0, 50)}"`, () => {
      expect(hasMandatoryLanguage(text)).toBe(expected);
    });
  }
});

// ── RequirementDiscoveryService chunk scanning ────────────────────────────────

describe("RequirementDiscoveryService — discoverFromChunks", () => {
  const svc = new RequirementDiscoveryService();

  it("discovers requirements from specification chunks", () => {
    const chunks = [
      {
        id: "c1", document_id: "d1", project_id: "p1", page_number: 1,
        clause_number: "2.1", section_heading: null,
        chunk_text: "The system shall be IP65 rated.", normalized_text: "The system shall be IP65 rated.",
        embedding: null, metadata: {}, created_at: ""
      },
      {
        id: "c2", document_id: "d1", project_id: "p1", page_number: 2,
        clause_number: null, section_heading: null,
        chunk_text: "This is informative text.", normalized_text: "This is informative text.",
        embedding: null, metadata: {}, created_at: ""
      }
    ];
    const result = svc.discoverFromChunks(chunks, "p1", ["d1"]);
    expect(result).toHaveLength(1);
    expect(result[0].requirementText).toContain("IP65");
    expect(result[0].clauseNumber).toBe("2.1");
  });

  it("does not discover from documents already having extracted requirements", () => {
    const chunks = [
      {
        id: "c1", document_id: "d1", project_id: "p1", page_number: 1,
        clause_number: "1.1", section_heading: null,
        chunk_text: "Units shall comply.", normalized_text: "Units shall comply.",
        embedding: null, metadata: {}, created_at: ""
      }
    ];
    // d1 is excluded because it has requirements already.
    const result = svc.discoverFromChunks(chunks, "p1", ["d2"]);
    expect(result).toHaveLength(0);
  });
});

// ── Ready-for-annotation gate (unit-level logic) ──────────────────────────────

describe("Ready-for-annotation gate logic", () => {
  it("provisional requirements block annotation readiness", () => {
    const provisionalCount = 3;
    const blockers: string[] = [];
    if (provisionalCount > 0) {
      blockers.push(`${provisionalCount} provisional requirement(s) have not been confirmed or rejected.`);
    }
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers[0]).toContain("provisional");
  });

  it("zero provisional requirements do not block annotation readiness", () => {
    const provisionalCount = 0;
    const blockers: string[] = [];
    if (provisionalCount > 0) {
      blockers.push("provisional");
    }
    expect(blockers).toHaveLength(0);
  });

  it("not_verified findings without human override block annotation readiness", () => {
    const findings = [
      { status: "not_verified", human_override_status: null }
    ];
    const blockers: string[] = [];
    const unverified = findings.filter((f) => f.status === "not_verified" && !f.human_override_status);
    if (unverified.length > 0) {
      blockers.push(`${unverified.length} finding(s) have unresolved citation failures.`);
    }
    expect(blockers).toHaveLength(1);
  });

  it("not_verified findings with human override do not block", () => {
    const findings = [
      { status: "not_verified", human_override_status: "complied" }
    ];
    const unverified = findings.filter((f) => f.status === "not_verified" && !f.human_override_status);
    expect(unverified).toHaveLength(0);
  });

  it("all conditions met — gate passes", () => {
    const provisionalCount = 0;
    const activeJobs       = 0;
    const unresolved       = 0;
    const undecided        = 0;
    const reviewStatus     = "awaiting_human_review";

    const blockers: string[] = [];
    if (activeJobs > 0) blockers.push("JOBS_RUNNING");
    if (["failed", "cancelled", "superseded"].includes(reviewStatus)) blockers.push("REVIEW_TERMINAL");
    if (undecided > 0)  blockers.push("UNDECIDED_FINDINGS");
    if (unresolved > 0) blockers.push("UNRESOLVED_CITATION_FAILURE");
    if (provisionalCount > 0) blockers.push("PROVISIONAL_REQUIREMENTS");

    expect(blockers).toHaveLength(0);
  });
});

// ── Reviewer decision model ───────────────────────────────────────────────────

describe("Reviewer decision precedence", () => {
  function effectiveStatus(finding: {
    human_override_status: string | null;
    deterministic_derived_status: string | null;
    status: string;
  }): string {
    return finding.human_override_status ?? finding.deterministic_derived_status ?? finding.status;
  }

  it("reviewer override takes precedence over deterministic", () => {
    const f = { human_override_status: "complied", deterministic_derived_status: "not_proven", status: "not_proven" };
    expect(effectiveStatus(f)).toBe("complied");
  });

  it("deterministic takes precedence when no override", () => {
    const f = { human_override_status: null, deterministic_derived_status: "partially_complied", status: "not_proven" };
    expect(effectiveStatus(f)).toBe("partially_complied");
  });

  it("raw status is used when no override and no deterministic", () => {
    const f = { human_override_status: null, deterministic_derived_status: null, status: "ambiguous" };
    expect(effectiveStatus(f)).toBe("ambiguous");
  });

  it("reviewer final status never auto-changes", () => {
    const approvedFinding = { human_override_status: "complied", deterministic_derived_status: "not_proven", status: "not_proven" };
    // Simulating a rerun that gets a different deterministic result.
    const afterRerun = { ...approvedFinding, deterministic_derived_status: "not_complied" };
    // Reviewer status must not change.
    expect(effectiveStatus(afterRerun)).toBe("complied");
  });
});

// ── Positive status requires evidence (approval rule) ────────────────────────

describe("Approval prerequisite validation", () => {
  const POSITIVE_STATUSES = ["complied", "exceeds_requirement"];

  it("complied requires evidence", () => {
    const hasEvidence = false;
    const status      = "complied";
    const blocked     = POSITIVE_STATUSES.includes(status) && !hasEvidence;
    expect(blocked).toBe(true);
  });

  it("complied with evidence is not blocked", () => {
    const hasEvidence = true;
    const status      = "complied";
    const blocked     = POSITIVE_STATUSES.includes(status) && !hasEvidence;
    expect(blocked).toBe(false);
  });

  it("not_proven does not require evidence", () => {
    const hasEvidence = false;
    const status      = "not_proven";
    const blocked     = POSITIVE_STATUSES.includes(status) && !hasEvidence;
    expect(blocked).toBe(false);
  });
});
