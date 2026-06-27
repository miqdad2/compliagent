import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_AUDIT_ACTIONS } from "@/lib/ai/audit";
import type { AuthProfile } from "@/lib/permissions/server";
import { enforceAiConsent } from "@/server/services/ai/consent-guard";
import type {
  AiAuditRecord,
  AiPersistenceGateway,
  AiProjectScope,
  AiRunInsert,
  AiRunRow,
  AiRunUpdate,
  OrganizationAiSettingsInsert,
  OrganizationAiSettingsRow
} from "@/server/services/ai/gateway";
import { MockAiExecutionService } from "@/server/services/ai/mock-execution";
import {
  mapOrganizationAiSettings,
  OrganizationAiSettingsService,
  type OrganizationAiSettings
} from "@/server/services/ai/organization-settings";
import { isMockAiTestEndpointEnabled, safeMockAiTestPayloadSchema } from "@/server/services/ai/safe-test";

const ids = {
  organization: "11111111-1111-4111-8111-111111111111",
  otherOrganization: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  project: "22222222-2222-4222-8222-222222222222",
  otherProject: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  profile: "33333333-3333-4333-8333-333333333333",
  user: "44444444-4444-4444-8444-444444444444"
};

const actor: AuthProfile = {
  id: ids.profile,
  user_id: ids.user,
  organization_id: ids.organization,
  full_name: "Test Admin",
  role: "admin",
  created_at: "2026-06-21T00:00:00.000Z",
  updated_at: "2026-06-21T00:00:00.000Z"
};

function settingsRow(overrides: Partial<OrganizationAiSettingsRow> = {}): OrganizationAiSettingsRow {
  return {
    organization_id: ids.organization,
    ai_enabled: true,
    consent_granted_at: "2026-06-21T00:00:00.000Z",
    consent_granted_by: ids.profile,
    consent_document_version: "consent-v1",
    default_provider: "openai",
    enabled_providers: ["openai"],
    model_routes: {
      version: 1,
      allowedTaskTypes: ["document_classification", "document_understanding", "condition_comparison", "finding_verification"],
      externalDocumentTransmissionAllowed: true,
      multimodalTransmissionAllowed: true,
      retentionPreference: "no_storage",
      providerRoutes: {
        openai: {
          lightweight: "mock-lightweight-v1",
          multimodal: "mock-multimodal-v1",
          reasoning: "mock-reasoning-v1",
          verifier: "mock-verifier-v1",
          taskModels: {}
        }
      }
    },
    created_at: "2026-06-21T00:00:00.000Z",
    updated_at: "2026-06-21T00:00:00.000Z",
    ...overrides
  };
}

class MemoryAiGateway implements AiPersistenceGateway {
  settings: OrganizationAiSettingsRow | null = settingsRow();
  project: AiProjectScope | null = { id: ids.project, organizationId: ids.organization };
  runs: AiRunRow[] = [];
  createdRunInputs: AiRunInsert[] = [];
  audits: AiAuditRecord[] = [];
  settingsWrites: OrganizationAiSettingsInsert[] = [];

  async getOrganizationAiSettings(organizationId: string) {
    return this.settings?.organization_id === organizationId ? this.settings : null;
  }

  async upsertOrganizationAiSettings(input: OrganizationAiSettingsInsert) {
    this.settingsWrites.push(input);
    this.settings = {
      organization_id: input.organization_id,
      ai_enabled: input.ai_enabled ?? false,
      consent_granted_at: input.consent_granted_at ?? null,
      consent_granted_by: input.consent_granted_by ?? null,
      consent_document_version: input.consent_document_version ?? null,
      default_provider: input.default_provider ?? null,
      enabled_providers: input.enabled_providers ?? [],
      model_routes: input.model_routes ?? {},
      created_at: input.created_at ?? "2026-06-21T00:00:00.000Z",
      updated_at: input.updated_at ?? "2026-06-21T00:00:00.000Z"
    };
    return this.settings;
  }

  async getProjectScope(projectId: string) {
    return this.project?.id === projectId ? this.project : null;
  }

  async createAiRun(input: AiRunInsert) {
    this.createdRunInputs.push(input);
    const row: AiRunRow = {
      id: `90000000-0000-4000-8000-${String(this.runs.length + 1).padStart(12, "0")}`,
      organization_id: input.organization_id,
      project_id: input.project_id,
      review_id: input.review_id ?? null,
      document_id: input.document_id ?? null,
      task_type: input.task_type,
      provider: input.provider,
      model: input.model,
      prompt_version: input.prompt_version,
      provider_run_id: input.provider_run_id ?? null,
      input_hash: input.input_hash,
      status: input.status ?? "queued",
      started_at: input.started_at ?? null,
      completed_at: input.completed_at ?? null,
      latency_ms: input.latency_ms ?? null,
      input_tokens: input.input_tokens ?? null,
      output_tokens: input.output_tokens ?? null,
      estimated_cost: input.estimated_cost ?? null,
      validation_status: input.validation_status ?? "pending",
      verification_status: input.verification_status ?? "pending",
      error_code: input.error_code ?? null,
      error_message: input.error_message ?? null,
      created_by: input.created_by,
      created_at: input.created_at ?? "2026-06-21T00:00:00.000Z"
    };
    this.runs.push(row);
    return row;
  }

  async updateAiRun(organizationId: string, runId: string, input: AiRunUpdate) {
    const index = this.runs.findIndex((run) => run.id === runId && run.organization_id === organizationId);
    if (index < 0) throw new Error("Missing mock run");
    this.runs[index] = { ...this.runs[index], ...input } as AiRunRow;
    return this.runs[index];
  }

  async writeAudit(record: AiAuditRecord) {
    this.audits.push(record);
  }
}

function guardSettings(overrides: Partial<OrganizationAiSettings> = {}): OrganizationAiSettings {
  return { ...mapOrganizationAiSettings(settingsRow()), ...overrides };
}

function guard(overrides: Partial<Parameters<typeof enforceAiConsent>[0]> = {}) {
  return enforceAiConsent({
    actor,
    organizationId: ids.organization,
    projectId: ids.project,
    project: { id: ids.project, organizationId: ids.organization },
    settings: guardSettings(),
    provider: "openai",
    taskType: "condition_comparison",
    externalTransmissionRequested: false,
    multimodalTransmissionRequested: false,
    ...overrides
  });
}

function executionInput(overrides: Partial<Parameters<MockAiExecutionService["execute"]>[0]> = {}) {
  return {
    actor,
    organizationId: ids.organization,
    projectId: ids.project,
    provider: "openai" as const,
    taskType: "condition_comparison" as const,
    promptVersion: "safe-mock-test@1.0.0",
    predefinedPayloadId: "safe-condition-comparison-success",
    behavior: "success" as const,
    repairInvalidOutput: true,
    externalTransmissionRequested: false,
    multimodalTransmissionRequested: false,
    ...overrides
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AI consent enforcement", () => {
  it("blocks execution when AI is disabled", () => {
    expect(guard({ settings: guardSettings({ aiEnabled: false }) })).toMatchObject({ allowed: false, error: { code: "AI_DISABLED" } });
  });

  it("blocks execution when consent is missing", () => {
    expect(guard({ settings: guardSettings({ consentGranted: false }) })).toMatchObject({ allowed: false, error: { code: "CONSENT_REQUIRED" } });
  });

  it("blocks a disallowed provider", () => {
    expect(guard({ settings: guardSettings({ allowedProviders: ["anthropic"] }) })).toMatchObject({
      allowed: false,
      error: { code: "PROVIDER_NOT_ALLOWED" }
    });
  });

  it("blocks a disallowed task", () => {
    expect(guard({ settings: guardSettings({ allowedTaskTypes: ["document_classification"] }) })).toMatchObject({
      allowed: false,
      error: { code: "TASK_NOT_ALLOWED" }
    });
  });

  it("blocks external transmission when permission is disabled", () => {
    expect(
      guard({ externalTransmissionRequested: true, settings: guardSettings({ externalDocumentTransmissionAllowed: false }) })
    ).toMatchObject({ allowed: false, error: { code: "EXTERNAL_TRANSMISSION_BLOCKED" } });
  });

  it("blocks multimodal transmission when permission is disabled", () => {
    expect(
      guard({ multimodalTransmissionRequested: true, settings: guardSettings({ multimodalTransmissionAllowed: false }) })
    ).toMatchObject({ allowed: false, error: { code: "MULTIMODAL_TRANSMISSION_BLOCKED" } });
  });

  it("blocks organization mismatch", () => {
    expect(guard({ organizationId: ids.otherOrganization })).toMatchObject({
      allowed: false,
      error: { code: "ORGANIZATION_ACCESS_DENIED" }
    });
  });

  it("blocks project mismatch", () => {
    expect(guard({ projectId: ids.otherProject })).toMatchObject({ allowed: false, error: { code: "PROJECT_ACCESS_DENIED" } });
  });
});

describe("server-only mock AI execution", () => {
  it("completes a deterministic mock run", async () => {
    const gateway = new MemoryAiGateway();
    const result = await new MockAiExecutionService(gateway).execute(executionInput());
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      validationStatus: "passed",
      provider: "openai",
      mockProvider: "mock-reasoning"
    });
  });

  it("provides deterministic lightweight, multimodal, reasoning, and verifier mock tiers", async () => {
    const cases = [
      ["document_classification", "mock-lightweight"],
      ["document_understanding", "mock-multimodal"],
      ["condition_comparison", "mock-reasoning"],
      ["finding_verification", "mock-verifier"]
    ] as const;
    for (const [taskType, mockProvider] of cases) {
      const gateway = new MemoryAiGateway();
      const result = await new MockAiExecutionService(gateway).execute(
        executionInput({ taskType, multimodalTransmissionRequested: taskType === "document_understanding" })
      );
      expect(result).toMatchObject({ ok: true, mockProvider });
    }
  });

  it("persists safe run metadata through the complete lifecycle", async () => {
    const gateway = new MemoryAiGateway();
    await new MockAiExecutionService(gateway).execute(executionInput());
    expect(gateway.runs[0]).toMatchObject({
      status: "completed",
      task_type: "condition_comparison",
      provider: "openai",
      model: "mock-reasoning-v1",
      prompt_version: "safe-mock-test@1.0.0",
      validation_status: "passed",
      verification_status: "not_required",
      input_tokens: 36,
      output_tokens: 8,
      estimated_cost: 0
    });
    expect(gateway.runs[0].input_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("attempts exactly one mock repair after validation failure", async () => {
    const gateway = new MemoryAiGateway();
    const result = await new MockAiExecutionService(gateway).execute(
      executionInput({ behavior: "invalid_json_then_repair" })
    );
    expect(result).toMatchObject({ ok: true, validationStatus: "repaired" });
    expect(gateway.audits.filter((audit) => audit.action === AI_AUDIT_ACTIONS.MOCK_REPAIR_ATTEMPTED)).toHaveLength(1);
  });

  it("marks the run failed when repaired output is also invalid", async () => {
    const gateway = new MemoryAiGateway();
    const result = await new MockAiExecutionService(gateway).execute(
      executionInput({ behavior: "invalid_json_persistent" })
    );
    expect(result).toMatchObject({ ok: false, error: { code: "OUTPUT_VALIDATION_FAILED" } });
    expect(gateway.runs[0]).toMatchObject({ status: "failed", validation_status: "failed", error_code: "OUTPUT_VALIDATION_FAILED" });
  });

  it("normalizes mock provider timeouts", async () => {
    const gateway = new MemoryAiGateway();
    const result = await new MockAiExecutionService(gateway).execute(executionInput({ behavior: "timeout" }));
    expect(result).toMatchObject({ ok: false, error: { code: "PROVIDER_TIMEOUT", retryable: true } });
    expect(gateway.runs[0]).toMatchObject({ status: "failed", error_code: "PROVIDER_TIMEOUT" });
  });

  it("normalizes mock provider failures", async () => {
    const gateway = new MemoryAiGateway();
    const result = await new MockAiExecutionService(gateway).execute(executionInput({ behavior: "provider_failure" }));
    expect(result).toMatchObject({ ok: false, error: { code: "PROVIDER_FAILED", retryable: true } });
  });

  it("writes requested, started, and completed audit events", async () => {
    const gateway = new MemoryAiGateway();
    await new MockAiExecutionService(gateway).execute(executionInput());
    expect(gateway.audits.map((audit) => audit.action)).toEqual([
      AI_AUDIT_ACTIONS.RUN_REQUESTED,
      AI_AUDIT_ACTIONS.RUN_STARTED,
      AI_AUDIT_ACTIONS.RUN_COMPLETED
    ]);
  });

  it("writes a consent-blocked audit without creating a run", async () => {
    const gateway = new MemoryAiGateway();
    gateway.settings = settingsRow({ consent_granted_at: null, consent_granted_by: null, consent_document_version: null });
    const result = await new MockAiExecutionService(gateway).execute(executionInput());
    expect(result).toMatchObject({ ok: false, error: { code: "CONSENT_REQUIRED" } });
    expect(gateway.runs).toHaveLength(0);
    expect(gateway.audits[0].action).toBe(AI_AUDIT_ACTIONS.RUN_BLOCKED_BY_CONSENT);
  });

  it("does not store provider input or confidential payload text in ai_runs", async () => {
    const gateway = new MemoryAiGateway();
    await new MockAiExecutionService(gateway).execute(executionInput());
    const persisted = JSON.stringify(gateway.createdRunInputs[0]);
    expect(persisted).not.toContain("COMPLIAGENT_SAFE_MOCK_PAYLOAD_V1");
    expect(persisted).not.toContain("confidential");
    expect(Object.keys(gateway.createdRunInputs[0])).not.toContain("input");
  });

  it("never makes an external network request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const gateway = new MemoryAiGateway();
    await new MockAiExecutionService(gateway).execute(executionInput());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("organization settings and safe endpoint", () => {
  it("allows only admins to update scoped settings and writes an audit event", async () => {
    const gateway = new MemoryAiGateway();
    const service = new OrganizationAiSettingsService(gateway, () => new Date("2026-06-21T01:00:00.000Z"));
    const updated = await service.update(actor, {
      organizationId: ids.organization,
      aiEnabled: true,
      consentGranted: true,
      consentVersion: "consent-v2",
      defaultProvider: "openai",
      allowedProviders: ["openai"],
      allowedTaskTypes: ["condition_comparison"],
      externalDocumentTransmissionAllowed: false,
      multimodalTransmissionAllowed: false,
      retentionPreference: "no_storage",
      providerRoutes: {
        openai: { reasoning: "mock-reasoning-v1", taskModels: {} }
      }
    });
    expect(updated).toMatchObject({ aiEnabled: true, consentVersion: "consent-v2", consentRecordedBy: actor.id });
    expect(gateway.audits[0].action).toBe(AI_AUDIT_ACTIONS.SETTINGS_UPDATED);
  });

  it("treats missing settings as disabled and prevents cross-organization reads", async () => {
    const gateway = new MemoryAiGateway();
    gateway.settings = null;
    const service = new OrganizationAiSettingsService(gateway);
    await expect(service.getEffective(actor, ids.organization)).resolves.toMatchObject({ aiEnabled: false, consentGranted: false });
    await expect(service.get(actor, ids.otherOrganization)).rejects.toMatchObject({ code: "ORGANIZATION_ACCESS_DENIED" });
  });

  it("rejects settings mutations from non-admin users", async () => {
    const gateway = new MemoryAiGateway();
    const service = new OrganizationAiSettingsService(gateway);
    await expect(
      service.update(
        { ...actor, role: "engineer" },
        {
          organizationId: ids.organization,
          aiEnabled: false,
          consentGranted: false,
          consentVersion: null,
          defaultProvider: null,
          allowedProviders: [],
          allowedTaskTypes: [],
          externalDocumentTransmissionAllowed: false,
          multimodalTransmissionAllowed: false,
          retentionPreference: "no_storage",
          providerRoutes: {}
        }
      )
    ).rejects.toMatchObject({ code: "ADMIN_REQUIRED" });
    expect(gateway.settingsWrites).toHaveLength(0);
  });

  it("blocks the development test endpoint in production unless explicitly enabled", () => {
    expect(isMockAiTestEndpointEnabled("production", undefined)).toBe(false);
    expect(isMockAiTestEndpointEnabled("production", "false")).toBe(false);
    expect(isMockAiTestEndpointEnabled("production", "true")).toBe(true);
    expect(isMockAiTestEndpointEnabled("development", undefined)).toBe(true);
  });

  it("rejects arbitrary document text in the predefined endpoint payload", () => {
    expect(
      safeMockAiTestPayloadSchema.safeParse({
        projectId: ids.project,
        provider: "openai",
        taskType: "condition_comparison",
        scenario: "success",
        documentText: "confidential document"
      }).success
    ).toBe(false);
  });
});
