/**
 * deployment-17l.test.ts
 *
 * Regression tests for Unit 17L: Prepare CompliAgent for Vercel Web +
 * Railway Worker Deployment.
 *
 * Test strategy:
 *  - Source-file inspection for structural contracts (env loading, Zod schema,
 *    package.json fields, deployment docs, messaging guards, liveness migration).
 *  - Direct invocation for pure / injectable functions
 *    (loadLocalEnv, validateWorkerEnv).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

import { loadLocalEnv } from "@/server/workers/load-env";
import { validateWorkerEnv } from "@/server/workers/worker-env";

const ROOT = resolve(__dirname, "../..");

function readSrc(rel: string): string {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) return "";
  return readFileSync(p, "utf8");
}

// ── 1. loadLocalEnv ────────────────────────────────────────────────────────────

describe("Unit 17L: loadLocalEnv — sets missing vars", () => {
  it("loads a variable from the .env file when the key is absent from process.env", () => {
    const tmp = join(tmpdir(), ".env-test-17l-a");
    writeFileSync(tmp, "TEST_VAR_17L_LOAD_A=hello-world\n");
    delete process.env.TEST_VAR_17L_LOAD_A;

    loadLocalEnv(tmp);

    expect(process.env.TEST_VAR_17L_LOAD_A).toBe("hello-world");

    delete process.env.TEST_VAR_17L_LOAD_A;
    unlinkSync(tmp);
  });

  it("does not overwrite an existing process.env value", () => {
    const tmp = join(tmpdir(), ".env-test-17l-b");
    writeFileSync(tmp, "TEST_VAR_17L_LOAD_B=from-file\n");
    process.env.TEST_VAR_17L_LOAD_B = "original";

    loadLocalEnv(tmp);

    expect(process.env.TEST_VAR_17L_LOAD_B).toBe("original");

    delete process.env.TEST_VAR_17L_LOAD_B;
    unlinkSync(tmp);
  });

  it("returns silently and does not throw when the file does not exist", () => {
    const absent = join(tmpdir(), ".env-test-17l-absent-xxxxxxxxx");
    expect(() => loadLocalEnv(absent)).not.toThrow();
  });

  it("treats shell substitution syntax as a literal string — never executes it", () => {
    const tmp = join(tmpdir(), ".env-test-17l-c");
    writeFileSync(tmp, "TEST_VAR_17L_SHELL=$(echo injected)\n");
    delete process.env.TEST_VAR_17L_SHELL;

    loadLocalEnv(tmp);

    // Value must be the literal string, not the result of shell expansion.
    expect(process.env.TEST_VAR_17L_SHELL).toBe("$(echo injected)");

    delete process.env.TEST_VAR_17L_SHELL;
    unlinkSync(tmp);
  });
});

// ── 2. validateWorkerEnv (Zod) ────────────────────────────────────────────────

describe("Unit 17L: validateWorkerEnv — Zod boundary validation", () => {
  it("accepts a fully-specified valid worker environment", () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL:           "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY:          "eyJ_test_key",
      SUPABASE_STORAGE_BUCKET_DOCUMENTS:  "documents",
    };
    expect(() => validateWorkerEnv(env)).not.toThrow();
  });

  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", () => {
    const env = { SUPABASE_SERVICE_ROLE_KEY: "eyJ_test_key" };
    expect(() => validateWorkerEnv(env)).toThrow();
  });

  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", () => {
    const env = { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" };
    expect(() => validateWorkerEnv(env)).toThrow();
  });

  it("error message contains the missing field name but not any secret value", () => {
    const secretValue = "super-secret-key-value-12345";
    const env = {
      NEXT_PUBLIC_SUPABASE_URL:  "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: secretValue,
      // SUPABASE_STORAGE_BUCKET_DOCUMENTS will use its default
    };
    // Override: make URL blank to trigger a validation error
    const bad = { ...env, NEXT_PUBLIC_SUPABASE_URL: "" };
    try {
      validateWorkerEnv(bad);
      expect(true).toBe(false); // must have thrown
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toContain(secretValue);
      // Must mention the field name
      expect(msg).toContain("NEXT_PUBLIC_SUPABASE_URL");
    }
  });

  it("SUPABASE_STORAGE_BUCKET_DOCUMENTS defaults to 'documents' when absent", () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL:  "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "eyJ_test_key",
    };
    const result = validateWorkerEnv(env);
    expect(result.SUPABASE_STORAGE_BUCKET_DOCUMENTS).toBe("documents");
  });
});

// ── 3. packageManager field ───────────────────────────────────────────────────

describe("Unit 17L: packageManager field in package.json", () => {
  const pkg = readSrc("package.json");

  it("package.json has a packageManager field", () => {
    expect(pkg).toContain('"packageManager"');
  });

  it("packageManager value matches pnpm@X.Y.Z format", () => {
    const match = pkg.match(/"packageManager":\s*"(pnpm@[\d.]+)"/);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  });
});

// ── 4. Railway deployment separation ─────────────────────────────────────────

describe("Unit 17L: Railway deployment separation", () => {
  const pkg = readSrc("package.json");
  const pkgJson = JSON.parse(pkg) as { scripts: Record<string, string> };

  it("worker:documents script does not use --env-file flag", () => {
    expect(pkgJson.scripts["worker:documents"]).toBeDefined();
    expect(pkgJson.scripts["worker:documents"]).not.toContain("--env-file");
  });

  it("worker:documents:watch script does not use --env-file flag", () => {
    expect(pkgJson.scripts["worker:documents:watch"]).toBeDefined();
    expect(pkgJson.scripts["worker:documents:watch"]).not.toContain("--env-file");
  });

  it("watch-document-worker.ts calls loadLocalEnv for optional local .env loading", () => {
    const src = readSrc("src/server/workers/watch-document-worker.ts");
    expect(src).toContain("loadLocalEnv");
  });

  it("run-document-worker.ts calls loadLocalEnv for optional local .env loading", () => {
    const src = readSrc("src/server/workers/run-document-worker.ts");
    expect(src).toContain("loadLocalEnv");
  });
});

// ── 5. Worker startup diagnostics ────────────────────────────────────────────

describe("Unit 17L: Worker startup diagnostics", () => {
  const src = readSrc("src/server/workers/watch-document-worker.ts");

  it("startup log includes batch size", () => {
    expect(src).toContain("batchSize");
  });

  it("startup diagnostics log 'Supabase configuration: present' — not the URL value", () => {
    // The word "present" must appear alongside the Supabase var reference.
    expect(src).toContain("present");
    // The URL itself must never appear in a console.log call.
    const logLines = src.split("\n").filter((l) => l.includes("console.log"));
    const urlLogged = logLines.some((l) =>
      l.includes("NEXT_PUBLIC_SUPABASE_URL") && !l.includes("?") && !l.includes("Boolean")
    );
    // It's fine to reference the var name in a conditional, but never log the value raw.
    expect(urlLogged).toBe(false);
  });
});

// ── 6. Worker liveness migration ─────────────────────────────────────────────

describe("Unit 17L: Worker liveness migration", () => {
  it("worker_liveness migration file exists", () => {
    expect(
      existsSync(resolve(ROOT, "supabase/migrations/20260703000000_worker_liveness.sql"))
    ).toBe(true);
  });

  it("migration creates worker_liveness table with last_heartbeat_at column", () => {
    const sql = readSrc("supabase/migrations/20260703000000_worker_liveness.sql");
    expect(sql).toContain("worker_liveness");
    expect(sql).toContain("last_heartbeat_at");
  });
});

// ── 7. Processing-status route — worker liveness ───────────────────────────

describe("Unit 17L: processing-status route — worker liveness integration", () => {
  const src = readSrc("src/app/api/projects/[projectId]/processing-status/route.ts");

  it("route queries the worker_liveness table", () => {
    expect(src).toContain("worker_liveness");
  });

  it("route returns a workerLiveness field in the response", () => {
    expect(src).toContain("workerLiveness");
  });
});

// ── 8. Vercel separation — no long-running loops in route handlers ────────

describe("Unit 17L: Vercel separation — no long-running loops in routes", () => {
  it("processing-status route does not import runWatchWorkerLoop", () => {
    const src = readSrc("src/app/api/projects/[projectId]/processing-status/route.ts");
    expect(src).not.toContain("runWatchWorkerLoop");
  });
});

// ── 9. Production progress messaging ─────────────────────────────────────────

describe("Unit 17L: Production progress page messaging", () => {
  const src = readSrc("src/components/projects/project-progress-client.tsx");

  it("terminal command is guarded by a NODE_ENV check — not shown in production", () => {
    // Both NODE_ENV and the pnpm command must be present in the source.
    expect(src).toContain("NODE_ENV");
    expect(src).toContain("pnpm worker:documents:watch");
    // The IS_PRODUCTION / NODE_ENV check must appear before the pnpm command.
    const nodeEnvIdx = src.indexOf("IS_PRODUCTION");
    const pnpmIdx    = src.indexOf("pnpm worker:documents:watch");
    expect(nodeEnvIdx).toBeGreaterThan(-1);
    expect(pnpmIdx).toBeGreaterThan(-1);
    expect(nodeEnvIdx).toBeLessThan(pnpmIdx);
  });

  it("production active message 'Processing uploaded documents.' is present in source", () => {
    expect(src).toContain("Processing uploaded documents.");
  });

  it("production unavailable message is present in source", () => {
    expect(src).toContain("temporarily unavailable");
  });

  it("workerLiveness state is tracked in the client component", () => {
    expect(src).toContain("workerLiveness");
    expect(src).toContain("setWorkerLiveness");
  });
});

// ── 10. deploy:check script ───────────────────────────────────────────────────

describe("Unit 17L: deploy:check script", () => {
  const pkg = readSrc("package.json");
  const pkgJson = JSON.parse(pkg) as { scripts: Record<string, string> };

  it("deploy:check script exists in package.json", () => {
    expect(pkgJson.scripts["deploy:check"]).toBeDefined();
  });

  it("check-deployment-readiness.ts source file exists", () => {
    expect(
      existsSync(resolve(ROOT, "src/server/workers/check-deployment-readiness.ts"))
    ).toBe(true);
  });
});

// ── 11. Deployment documentation ─────────────────────────────────────────────

describe("Unit 17L: Deployment documentation", () => {
  it("context/deployment-railway-worker.md exists", () => {
    expect(existsSync(resolve(ROOT, "context/deployment-railway-worker.md"))).toBe(true);
  });

  it("Railway doc contains start command pnpm worker:documents:watch", () => {
    const doc = readSrc("context/deployment-railway-worker.md");
    expect(doc).toContain("pnpm worker:documents:watch");
  });

  it("context/deployment-vercel.md exists", () => {
    expect(existsSync(resolve(ROOT, "context/deployment-vercel.md"))).toBe(true);
  });

  it("Vercel doc lists required NEXT_PUBLIC_SUPABASE_URL environment variable", () => {
    const doc = readSrc("context/deployment-vercel.md");
    expect(doc).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(doc).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });
});

// ── 12. Secret-safety invariants ─────────────────────────────────────────────

describe("Unit 17L: Secret-safety invariants", () => {
  it("worker-env.ts never references process.env directly when printing errors", () => {
    const src = readSrc("src/server/workers/worker-env.ts");
    // The module must not log or print env var values — only field names.
    expect(src).not.toContain("console.log");
    expect(src).not.toContain("console.error");
  });

  it("load-env.ts does not contain eval() or dynamic code execution", () => {
    const src = readSrc("src/server/workers/load-env.ts");
    expect(src).not.toContain("eval(");
    expect(src).not.toContain("Function(");
    expect(src).not.toContain("execSync");
    expect(src).not.toContain("exec(");
  });

  it("check-deployment-readiness.ts does not print secret values", () => {
    const src = readSrc("src/server/workers/check-deployment-readiness.ts");
    // Must never log SUPABASE_SERVICE_ROLE_KEY value directly
    expect(src).not.toMatch(/console\.log[^;]*SUPABASE_SERVICE_ROLE_KEY[^;]*;/);
    // Must reference the key only for existence checks, not value printing
    expect(src).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
