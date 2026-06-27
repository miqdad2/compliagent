import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260620235900_controlled_ai_architecture_foundation.sql",
  "utf8"
);

describe("controlled AI architecture migration", () => {
  it("adds consent settings and an AI run ledger without provider secrets", () => {
    expect(migration).toContain("create table public.organization_ai_settings");
    expect(migration).toContain("create table public.ai_runs");
    expect(migration).toContain("consent_granted_at");
    expect(migration).not.toMatch(/api_key|secret_key|access_token/i);
  });

  it("enforces organization-scoped foreign keys and RLS", () => {
    expect(migration).toContain("ai_runs_project_organization_fk");
    expect(migration).toContain("ai_runs_document_scope_fk");
    expect(migration).toContain("alter table public.ai_runs enable row level security");
    expect(migration).toContain("organization_id = public.current_organization_id()");
  });

  it("requires consent and an enabled provider before an AI run can be inserted", () => {
    expect(migration).toContain("settings.ai_enabled = true");
    expect(migration).toContain("settings.consent_granted_at is not null");
    expect(migration).toContain("ai_runs.provider = any(settings.enabled_providers)");
  });
});
