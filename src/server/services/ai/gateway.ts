import type { Database, Json } from "@/types/database";

export type OrganizationAiSettingsRow = Database["public"]["Tables"]["organization_ai_settings"]["Row"];
export type OrganizationAiSettingsInsert = Database["public"]["Tables"]["organization_ai_settings"]["Insert"];
export type AiRunRow = Database["public"]["Tables"]["ai_runs"]["Row"];
export type AiRunInsert = Database["public"]["Tables"]["ai_runs"]["Insert"];
export type AiRunUpdate = Database["public"]["Tables"]["ai_runs"]["Update"];

export type AiProjectScope = {
  id: string;
  organizationId: string;
};

export type AiAuditRecord = {
  organizationId: string;
  projectId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Json;
};

export interface AiPersistenceGateway {
  getOrganizationAiSettings(organizationId: string): Promise<OrganizationAiSettingsRow | null>;
  upsertOrganizationAiSettings(input: OrganizationAiSettingsInsert): Promise<OrganizationAiSettingsRow>;
  getProjectScope(projectId: string): Promise<AiProjectScope | null>;
  createAiRun(input: AiRunInsert): Promise<AiRunRow>;
  updateAiRun(organizationId: string, runId: string, input: AiRunUpdate): Promise<AiRunRow>;
  writeAudit(record: AiAuditRecord): Promise<void>;
}
