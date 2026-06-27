import { createSupabaseServerClient } from "@/lib/supabase/server";
import { AiServiceError } from "./errors";
import type {
  AiAuditRecord,
  AiPersistenceGateway,
  AiProjectScope,
  AiRunInsert,
  AiRunRow,
  AiRunUpdate,
  OrganizationAiSettingsInsert,
  OrganizationAiSettingsRow
} from "./gateway";

type SupabaseServerClient = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;

function persistenceError(): never {
  throw new AiServiceError("PERSISTENCE_ERROR", "The requested AI metadata operation could not be completed.", true);
}

export class SupabaseAiPersistenceGateway implements AiPersistenceGateway {
  constructor(private readonly client: SupabaseServerClient) {}

  async getOrganizationAiSettings(organizationId: string): Promise<OrganizationAiSettingsRow | null> {
    const { data, error } = await this.client
      .from("organization_ai_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) persistenceError();
    return (data as OrganizationAiSettingsRow | null) ?? null;
  }

  async upsertOrganizationAiSettings(input: OrganizationAiSettingsInsert): Promise<OrganizationAiSettingsRow> {
    const { data, error } = await this.client
      .from("organization_ai_settings")
      .upsert(input, { onConflict: "organization_id" })
      .select("*")
      .single();
    if (error || !data) persistenceError();
    return data as OrganizationAiSettingsRow;
  }

  async getProjectScope(projectId: string): Promise<AiProjectScope | null> {
    const { data, error } = await this.client
      .from("projects")
      .select("id, organization_id")
      .eq("id", projectId)
      .maybeSingle();
    if (error) persistenceError();
    return data ? { id: data.id as string, organizationId: data.organization_id as string } : null;
  }

  async createAiRun(input: AiRunInsert): Promise<AiRunRow> {
    const { data, error } = await this.client.from("ai_runs").insert(input).select("*").single();
    if (error || !data) persistenceError();
    return data as AiRunRow;
  }

  async updateAiRun(organizationId: string, runId: string, input: AiRunUpdate): Promise<AiRunRow> {
    const { data, error } = await this.client
      .from("ai_runs")
      .update(input)
      .eq("organization_id", organizationId)
      .eq("id", runId)
      .select("*")
      .single();
    if (error || !data) persistenceError();
    return data as AiRunRow;
  }

  async writeAudit(record: AiAuditRecord): Promise<void> {
    const { error } = await this.client.from("audit_logs").insert({
      organization_id: record.organizationId,
      project_id: record.projectId,
      user_id: record.userId,
      action: record.action,
      entity_type: record.entityType,
      entity_id: record.entityId,
      metadata: record.metadata
    });
    if (error) persistenceError();
  }
}
