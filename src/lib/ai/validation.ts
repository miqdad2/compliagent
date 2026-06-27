import { z } from "zod";

export async function validateAiJsonWithRepair<T>(
  output: unknown,
  schema: z.ZodType<T>,
  repair: (validationError: string) => Promise<unknown>
): Promise<T> {
  const parsed = schema.safeParse(output);
  if (parsed.success) {
    return parsed.data;
  }

  const repairedOutput = await repair(parsed.error.message);
  return schema.parse(repairedOutput);
}

export async function parseAndValidateAiJson<T>(
  rawOutput: string,
  schema: z.ZodType<T>,
  repair: (rawOutput: string, validationError: string) => Promise<string>
): Promise<{ data: T; repaired: boolean }> {
  const firstAttempt = parseJson(rawOutput);
  if (firstAttempt.success) {
    const parsed = schema.safeParse(firstAttempt.value);
    if (parsed.success) return { data: parsed.data, repaired: false };
    const repaired = await repair(rawOutput, parsed.error.message);
    return { data: schema.parse(parseJsonOrThrow(repaired)), repaired: true };
  }

  const repaired = await repair(rawOutput, firstAttempt.error);
  return { data: schema.parse(parseJsonOrThrow(repaired)), repaired: true };
}

function parseJson(rawOutput: string): { success: true; value: unknown } | { success: false; error: string } {
  try {
    return { success: true, value: JSON.parse(stripCodeFence(rawOutput)) as unknown };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Invalid JSON output." };
  }
}

function parseJsonOrThrow(rawOutput: string): unknown {
  return JSON.parse(stripCodeFence(rawOutput)) as unknown;
}

function stripCodeFence(rawOutput: string) {
  return rawOutput.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}
