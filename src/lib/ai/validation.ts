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
