import { describe, expect, it } from "vitest";
import { belongsToOrganization } from "@/lib/annotations/ownership";
import {
  conditionEvaluationSchema,
  conditionEvidenceRegionSchema,
  parentFindingDerivationResultSchema,
  requirementConditionSchema,
  type ConditionEvaluation,
  type RequirementCondition
} from "@/lib/compliance/condition-schemas";
import { deriveParentFindingStatus, type ParentConditionEvaluation } from "@/lib/compliance/parent-finding";

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  otherOrganization: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  requirement: "44444444-4444-4444-8444-444444444444",
  review: "55555555-5555-4555-8555-555555555555",
  finding: "66666666-6666-4666-8666-666666666666",
  sizeCondition: "77777777-7777-4777-8777-777777777777",
  rangeCondition: "88888888-8888-4888-8888-888888888888",
  magnetCondition: "99999999-9999-4999-8999-999999999999",
  evaluation: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  region: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  link: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  reviewer: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
};
const timestamp = "2026-06-20T20:00:00.000Z";

function condition(overrides: Partial<RequirementCondition> = {}): RequirementCondition {
  return {
    id: ids.sizeCondition,
    organizationId: ids.organization,
    projectId: ids.project,
    requirementId: ids.requirement,
    conditionOrder: 1,
    conditionKey: "driver_type",
    conditionType: "feature_required",
    subject: "driver",
    attribute: "type",
    operator: "equals",
    expectedText: "full-range",
    expectedNumericValue: null,
    expectedMinValue: null,
    expectedMaxValue: null,
    expectedUnit: null,
    isMandatory: true,
    sourceText: "Drivers must be high-quality full-range units.",
    extractionConfidence: 98,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function evaluation(overrides: Partial<ConditionEvaluation> = {}): ConditionEvaluation {
  return {
    id: ids.evaluation,
    organizationId: ids.organization,
    projectId: ids.project,
    reviewId: ids.review,
    findingId: ids.finding,
    requirementId: ids.requirement,
    requirementConditionId: ids.sizeCondition,
    status: "not_proven",
    evidenceRegionIds: [],
    evidenceSummary: null,
    reasoning: "No direct evidence was located for this condition.",
    contradictionReasoning: null,
    missingInformation: "Provide direct manufacturer evidence.",
    verificationFailureReason: null,
    contractorAction: "Submit a manufacturer datasheet.",
    confidenceScore: 92,
    weightageScore: 2,
    isHumanReviewRequired: true,
    humanStatus: null,
    humanComment: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function parentEvaluation(
  id: string,
  status: ParentConditionEvaluation["status"],
  overrides: Partial<ParentConditionEvaluation> = {}
): ParentConditionEvaluation {
  return { id, status, isMandatory: true, ...overrides };
}

describe("requirement condition schemas", () => {
  it("decomposes one clause into independently checkable conditions", () => {
    const result = [
      condition(),
      condition({
        id: ids.rangeCondition,
        conditionOrder: 2,
        conditionKey: "driver_size",
        conditionType: "numeric_range",
        attribute: "diameter",
        operator: "between",
        expectedText: null,
        expectedMinValue: 3.5,
        expectedMaxValue: 4,
        expectedUnit: "in"
      }),
      condition({
        id: ids.magnetCondition,
        conditionOrder: 3,
        conditionKey: "magnet_material",
        conditionType: "material_required",
        attribute: "magnet material",
        expectedText: "neodymium"
      })
    ].map((item) => requirementConditionSchema.parse(item));

    expect(result.map((item) => item.conditionKey)).toEqual(["driver_type", "driver_size", "magnet_material"]);
  });

  it("rejects invalid numeric ranges and numeric conditions without units", () => {
    const invalidRange = condition({
      conditionType: "numeric_range",
      operator: "between",
      expectedText: null,
      expectedMinValue: 4,
      expectedMaxValue: 3.5,
      expectedUnit: "in"
    });
    const missingUnit = { ...invalidRange, expectedMinValue: 3.5, expectedMaxValue: 4, expectedUnit: null };

    expect(requirementConditionSchema.safeParse(invalidRange).success).toBe(false);
    expect(requirementConditionSchema.safeParse(missingUnit).success).toBe(false);
  });
});

describe("condition evaluation schemas", () => {
  it("validates status-specific evidence and reasoning requirements", () => {
    expect(conditionEvaluationSchema.safeParse(evaluation()).success).toBe(true);
    expect(
      conditionEvaluationSchema.safeParse(
        evaluation({
          status: "complied",
          evidenceRegionIds: [ids.region],
          evidenceSummary: 'The datasheet states 3.5" drivers.',
          missingInformation: null,
          weightageScore: 10
        })
      ).success
    ).toBe(true);
    expect(conditionEvaluationSchema.safeParse(evaluation({ status: "not_proven", missingInformation: null })).success).toBe(false);
    expect(conditionEvaluationSchema.safeParse(evaluation({ status: "not_complied" })).success).toBe(false);
    expect(conditionEvaluationSchema.safeParse(evaluation({ status: "not_verified" })).success).toBe(false);
    expect(
      conditionEvaluationSchema.safeParse(
        evaluation({
          status: "partially_complied",
          evidenceRegionIds: [ids.region],
          evidenceSummary: "One part of the condition is proven.",
          missingInformation: "The remaining part is not proven."
        })
      ).success
    ).toBe(true);
  });

  it("validates evidence links and missing-expected-region markers", () => {
    const supportLink = {
      id: ids.link,
      conditionEvaluationId: ids.evaluation,
      evidenceRegionId: ids.region,
      organizationId: ids.organization,
      projectId: ids.project,
      relationshipType: "supports",
      createdAt: timestamp
    };

    expect(conditionEvidenceRegionSchema.safeParse(supportLink).success).toBe(true);
    expect(conditionEvidenceRegionSchema.safeParse({ ...supportLink, evidenceRegionId: null }).success).toBe(false);
    expect(
      conditionEvidenceRegionSchema.safeParse({
        ...supportLink,
        evidenceRegionId: null,
        relationshipType: "missing_expected_region"
      }).success
    ).toBe(true);
  });
});

describe("parent finding derivation", () => {
  it("derives complied only when all mandatory conditions are proven", () => {
    const result = deriveParentFindingStatus([
      parentEvaluation(ids.sizeCondition, "complied"),
      parentEvaluation(ids.rangeCondition, "complied")
    ]);

    expect(parentFindingDerivationResultSchema.parse(result).status).toBe("complied");
  });

  it("derives partial compliance for the driver example", () => {
    const result = deriveParentFindingStatus([
      parentEvaluation(ids.rangeCondition, "complied"),
      parentEvaluation(ids.sizeCondition, "not_proven"),
      parentEvaluation(ids.magnetCondition, "not_proven")
    ]);

    expect(result.status).toBe("partially_complied");
    expect(result.provenConditionIds).toEqual([ids.rangeCondition]);
    expect(result.unresolvedConditionIds).toEqual([ids.sizeCondition, ids.magnetCondition]);
  });

  it("derives not proven when no mandatory condition is proven", () => {
    const result = deriveParentFindingStatus([
      parentEvaluation(ids.sizeCondition, "ambiguous"),
      parentEvaluation(ids.magnetCondition, "not_proven")
    ]);

    expect(result.status).toBe("not_proven");
  });

  it("gives contradictory mandatory evidence precedence", () => {
    const result = deriveParentFindingStatus([
      parentEvaluation(ids.rangeCondition, "complied"),
      parentEvaluation(ids.magnetCondition, "not_complied")
    ]);

    expect(result.status).toBe("not_complied");
    expect(result.contradictoryConditionIds).toEqual([ids.magnetCondition]);
  });

  it("derives exceeds requirement only when every applicable mandatory condition exceeds", () => {
    const allExceeded = deriveParentFindingStatus([
      parentEvaluation(ids.sizeCondition, "exceeds_requirement"),
      parentEvaluation(ids.rangeCondition, "exceeds_requirement")
    ]);
    const mixed = deriveParentFindingStatus([
      parentEvaluation(ids.sizeCondition, "complied"),
      parentEvaluation(ids.rangeCondition, "exceeds_requirement")
    ]);

    expect(allExceeded.status).toBe("exceeds_requirement");
    expect(mixed.status).toBe("complied");
  });

  it("uses a scoped human override without changing sibling conditions", () => {
    const result = deriveParentFindingStatus([
      parentEvaluation(ids.rangeCondition, "not_proven", { humanStatus: "complied" }),
      parentEvaluation(ids.magnetCondition, "not_proven")
    ]);

    expect(result.status).toBe("partially_complied");
  });
});

describe("condition organization ownership", () => {
  it("keeps condition records within the active organization", () => {
    const record = condition();

    expect(belongsToOrganization(record, ids.organization)).toBe(true);
    expect(belongsToOrganization(record, ids.otherOrganization)).toBe(false);
  });
});
