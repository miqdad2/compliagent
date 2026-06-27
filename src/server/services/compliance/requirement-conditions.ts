import { requirementConditionSchema } from "@/lib/compliance/condition-schemas";
import type { RequirementConditionType, ConditionOperator } from "@/lib/compliance/condition-schemas";
import { ok, fail, type ServiceResult } from "./types";
import type {
  CompliancePersistenceGateway,
  RequirementConditionRow,
  RequirementConditionInsert
} from "./gateway";

export type ConditionInput = {
  conditionOrder: number;
  conditionKey: string;
  conditionType: RequirementConditionType;
  subject: string;
  attribute: string;
  operator: ConditionOperator;
  expectedText?: string | null;
  expectedNumericValue?: number | null;
  expectedMinValue?: number | null;
  expectedMaxValue?: number | null;
  expectedUnit?: string | null;
  isMandatory?: boolean;
  sourceText: string;
  extractionConfidence: number;
};

export type CreateConditionsInput = {
  organizationId: string;
  projectId: string;
  requirementId: string;
  requestingUserId: string;
  conditions: ConditionInput[];
};

export type ReplaceAiConditionsInput = CreateConditionsInput;

export type ReplaceAiConditionsResult = {
  created: RequirementConditionRow[];
  superseded: string[];
  protected: string[];
};

export const CONDITION_AUDIT_ACTIONS = {
  CONDITIONS_CREATED: "requirement_conditions.created",
  CONDITIONS_REPLACED: "requirement_conditions.replaced",
  CONDITION_SUPERSEDED: "requirement_condition.superseded"
} as const;

const FAKE_TIMESTAMP = "2000-01-01T00:00:00.000Z";

function buildInsert(
  input: CreateConditionsInput,
  condition: ConditionInput
): RequirementConditionInsert {
  return {
    organization_id: input.organizationId,
    project_id: input.projectId,
    requirement_id: input.requirementId,
    condition_order: condition.conditionOrder,
    condition_key: condition.conditionKey,
    condition_type: condition.conditionType,
    subject: condition.subject,
    attribute: condition.attribute,
    operator: condition.operator,
    expected_text: condition.expectedText ?? null,
    expected_numeric_value: condition.expectedNumericValue ?? null,
    expected_min_value: condition.expectedMinValue ?? null,
    expected_max_value: condition.expectedMaxValue ?? null,
    expected_unit: condition.expectedUnit ?? null,
    is_mandatory: condition.isMandatory ?? true,
    source_text: condition.sourceText,
    extraction_confidence: condition.extractionConfidence,
    is_active: true,
    is_human_confirmed: false
  };
}

function validateConditionInput(
  input: CreateConditionsInput,
  condition: ConditionInput
): string | null {
  const now = FAKE_TIMESTAMP;
  const fakeId = "00000000-0000-4000-8000-000000000000";
  const result = requirementConditionSchema.safeParse({
    id: fakeId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    requirementId: input.requirementId,
    conditionOrder: condition.conditionOrder,
    conditionKey: condition.conditionKey,
    conditionType: condition.conditionType,
    subject: condition.subject,
    attribute: condition.attribute,
    operator: condition.operator,
    expectedText: condition.expectedText ?? null,
    expectedNumericValue: condition.expectedNumericValue ?? null,
    expectedMinValue: condition.expectedMinValue ?? null,
    expectedMaxValue: condition.expectedMaxValue ?? null,
    expectedUnit: condition.expectedUnit ?? null,
    isMandatory: condition.isMandatory ?? true,
    sourceText: condition.sourceText,
    extractionConfidence: condition.extractionConfidence,
    createdAt: now,
    updatedAt: now
  });
  if (!result.success) {
    return result.error.errors[0]?.message ?? "Invalid condition.";
  }
  return null;
}

export class RequirementConditionsService {
  constructor(private readonly gateway: CompliancePersistenceGateway) {}

  async createConditions(input: CreateConditionsInput): Promise<ServiceResult<RequirementConditionRow[]>> {
    if (input.conditions.length === 0) {
      return ok([]);
    }

    const reqScope = await this.gateway.getRequirementScope(input.requirementId, input.projectId);
    if (!reqScope) {
      return fail("REQUIREMENT_NOT_FOUND", "The requirement was not found in this project.");
    }
    if (reqScope.organizationId !== input.organizationId) {
      return fail("ORGANIZATION_ACCESS_DENIED", "The requirement does not belong to the requesting organization.");
    }

    for (const condition of input.conditions) {
      const error = validateConditionInput(input, condition);
      if (error) {
        return fail("INVALID_CONDITION", error);
      }
    }

    const existing = await this.gateway.listActiveConditionsByRequirement(input.requirementId);
    const existingOrders = new Set(existing.map((c) => c.condition_order));
    const existingKeys = new Set(existing.map((c) => c.condition_key));

    for (const condition of input.conditions) {
      if (existingOrders.has(condition.conditionOrder)) {
        return fail("DUPLICATE_CONDITION", `Condition order ${condition.conditionOrder} already exists for this requirement.`);
      }
      if (existingKeys.has(condition.conditionKey)) {
        return fail("DUPLICATE_CONDITION", `Condition key "${condition.conditionKey}" already exists for this requirement.`);
      }
    }

    const inserts = input.conditions.map((c) => buildInsert(input, c));
    const created = await this.gateway.insertConditions(inserts);

    await this.gateway.writeAudit([
      {
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.requestingUserId,
        action: CONDITION_AUDIT_ACTIONS.CONDITIONS_CREATED,
        entityType: "requirement_conditions",
        entityId: input.requirementId,
        metadata: { count: created.length, requirementId: input.requirementId }
      }
    ]);

    return ok(created);
  }

  async replaceAiConditions(input: ReplaceAiConditionsInput): Promise<ServiceResult<ReplaceAiConditionsResult>> {
    const reqScope = await this.gateway.getRequirementScope(input.requirementId, input.projectId);
    if (!reqScope) {
      return fail("REQUIREMENT_NOT_FOUND", "The requirement was not found in this project.");
    }
    if (reqScope.organizationId !== input.organizationId) {
      return fail("ORGANIZATION_ACCESS_DENIED", "The requirement does not belong to the requesting organization.");
    }

    for (const condition of input.conditions) {
      const error = validateConditionInput(input, condition);
      if (error) {
        return fail("INVALID_CONDITION", error);
      }
    }

    const existing = await this.gateway.listActiveConditionsByRequirement(input.requirementId);
    const humanConfirmed = existing.filter((c) => c.is_human_confirmed);
    const aiGenerated = existing.filter((c) => !c.is_human_confirmed);

    const humanConfirmedOrders = new Set(humanConfirmed.map((c) => c.condition_order));
    const humanConfirmedKeys = new Set(humanConfirmed.map((c) => c.condition_key));

    for (const condition of input.conditions) {
      if (humanConfirmedOrders.has(condition.conditionOrder) || humanConfirmedKeys.has(condition.conditionKey)) {
        return fail(
          "HUMAN_APPROVAL_PROTECTED",
          `Condition order ${condition.conditionOrder} or key "${condition.conditionKey}" is human-confirmed and cannot be replaced automatically.`
        );
      }
    }

    const toSupersede = aiGenerated.map((c) => c.id);
    if (toSupersede.length > 0) {
      await this.gateway.supersedConditions(toSupersede, "replaced_by_reprocessing");
    }

    const inserts = input.conditions.map((c) => buildInsert(input, c));
    const created = input.conditions.length > 0 ? await this.gateway.insertConditions(inserts) : [];

    await this.gateway.writeAudit([
      {
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.requestingUserId,
        action: CONDITION_AUDIT_ACTIONS.CONDITIONS_REPLACED,
        entityType: "requirement_conditions",
        entityId: input.requirementId,
        metadata: {
          superseded: toSupersede.length,
          created: created.length,
          humanConfirmedPreserved: humanConfirmed.length
        }
      }
    ]);

    return ok({
      created,
      superseded: toSupersede,
      protected: humanConfirmed.map((c) => c.id)
    });
  }

  async listByRequirement(
    requirementId: string,
    organizationId: string,
    projectId: string
  ): Promise<ServiceResult<RequirementConditionRow[]>> {
    const reqScope = await this.gateway.getRequirementScope(requirementId, projectId);
    if (!reqScope) {
      return fail("REQUIREMENT_NOT_FOUND", "The requirement was not found.");
    }
    if (reqScope.organizationId !== organizationId) {
      return fail("ORGANIZATION_ACCESS_DENIED", "Access denied.");
    }
    const conditions = await this.gateway.listActiveConditionsByRequirement(requirementId);
    return ok(conditions);
  }

  async listByProject(projectId: string, organizationId: string): Promise<ServiceResult<RequirementConditionRow[]>> {
    const conditions = await this.gateway.listActiveConditionsByProject(projectId, organizationId);
    return ok(conditions);
  }

  async getWithRequirement(conditionId: string, organizationId: string): Promise<ServiceResult<RequirementConditionRow>> {
    const condition = await this.gateway.getCondition(conditionId, organizationId);
    if (!condition) {
      return fail("CONDITION_NOT_FOUND", "The condition was not found.");
    }
    return ok(condition);
  }

  async markSuperseded(
    conditionIds: string[],
    organizationId: string,
    reason: string,
    requestingUserId: string
  ): Promise<ServiceResult<void>> {
    for (const id of conditionIds) {
      const condition = await this.gateway.getCondition(id, organizationId);
      if (!condition) {
        return fail("CONDITION_NOT_FOUND", `Condition ${id} was not found.`);
      }
      if (condition.is_human_confirmed) {
        return fail("HUMAN_APPROVAL_PROTECTED", `Condition ${id} is human-confirmed and cannot be superseded automatically.`);
      }
    }

    await this.gateway.supersedConditions(conditionIds, reason);

    await this.gateway.writeAudit(
      conditionIds.map((id) => ({
        organizationId,
        projectId: null,
        userId: requestingUserId,
        action: CONDITION_AUDIT_ACTIONS.CONDITION_SUPERSEDED,
        entityType: "requirement_conditions",
        entityId: id,
        metadata: { reason }
      }))
    );

    return ok(undefined);
  }
}
