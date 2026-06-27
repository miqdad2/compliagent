import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260620233000_requirement_condition_evaluation_foundation.sql"),
  "utf8"
);

describe("condition-level migration contract", () => {
  it("creates scoped condition, evaluation, and evidence-link tables", () => {
    expect(migration).toContain("create table public.requirement_conditions");
    expect(migration).toContain("create table public.condition_evaluations");
    expect(migration).toContain("create table public.condition_evidence_regions");
    expect(migration).toContain("condition_evaluations_finding_scope_fk");
    expect(migration).toContain("condition_evaluations_condition_scope_fk");
    expect(migration).toContain("condition_evidence_regions_region_scope_fk");
  });

  it("enables organization-aware RLS on every new table", () => {
    for (const table of ["requirement_conditions", "condition_evaluations", "condition_evidence_regions"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }

    expect(migration).toContain("organization_id = public.current_organization_id()");
    expect(migration).toContain("public.current_user_role() = 'super_admin'");
    expect(migration).not.toContain("security definer");
  });
});
