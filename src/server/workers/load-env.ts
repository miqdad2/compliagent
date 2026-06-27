import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Optionally loads a .env file from the project root (or the given path) into
 * process.env. Designed for local development — in production (Railway), env
 * vars are injected directly into process.env and no .env file is needed.
 *
 * Safety guarantees:
 *  - Silently no-ops when the file is absent — never throws.
 *  - Never overwrites vars that are already set in process.env.
 *  - Does not evaluate shell syntax ($(…), backticks, or command substitution).
 *  - Strips surrounding single or double quotes from values.
 *  - Skips blank lines and comment lines (# …).
 */
export function loadLocalEnv(envPath?: string): void {
  const path = envPath ?? resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;

  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return; // best-effort: ignore unreadable files
  }

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    // Skip malformed keys (spaces, empty)
    if (!key || /\s/.test(key)) continue;

    // Never overwrite — Railway-injected vars take precedence
    if (key in process.env) continue;

    const rawVal = line.slice(eqIdx + 1);
    // Strip surrounding quotes (single or double) — never executes shell syntax
    const val = rawVal.replace(/^(["'])([\s\S]*)\1$/m, "$2");

    process.env[key] = val;
  }
}
