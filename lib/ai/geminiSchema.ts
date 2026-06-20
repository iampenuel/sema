import { z } from "zod";

const unsupportedGeminiKeywords = new Set(["$schema", "minLength", "maxLength", "minItems", "maxItems"]);

function sanitizeSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !unsupportedGeminiKeywords.has(key))
      .map(([key, entry]) => [key, sanitizeSchema(entry)])
  );
}

export function toGeminiJsonSchema<T>(schema: z.ZodType<T>) {
  return sanitizeSchema(z.toJSONSchema(schema));
}
