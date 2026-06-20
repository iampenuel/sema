import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { toGeminiJsonSchema } from "./geminiSchema";

const PreflightSchema = z.object({ ok: z.literal(true) });

export type ModelPreflightResult = {
  ok: boolean;
  model: string;
  modelListed: boolean;
  generateContentSupported: boolean;
  structuredOutputValid: boolean;
  latencyMs: number;
  availableStableFlashModels: string[];
  errorCode?: "configuration_missing" | "model_not_found" | "generation_unsupported" | "structured_output_failed" | "rate_limited" | "provider_unavailable";
};

function modelId(name = "") { return name.replace(/^models\//, ""); }

export async function preflightGeminiModel({ apiKey, model, timeoutMs = 15000 }: { apiKey?: string; model: string; timeoutMs?: number }): Promise<ModelPreflightResult> {
  const startedAt = Date.now();
  if (!apiKey) return { ok: false, model, modelListed: false, generateContentSupported: false, structuredOutputValid: false, latencyMs: 0, availableStableFlashModels: [], errorCode: "configuration_missing" };
  const client = new GoogleGenAI({ apiKey });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const pager = await client.models.list({ config: { pageSize: 100, abortSignal: controller.signal } });
    const models: Array<{ name?: string; supportedActions?: string[] }> = [];
    for await (const available of pager) models.push(available);
    const selected = models.find((available) => modelId(available.name) === model);
    const stableFlashModels = models.map((available) => modelId(available.name)).filter((name) => /^gemini-[\d.]+-flash(?:-lite)?$/.test(name)).sort();
    if (!selected) return { ok: false, model, modelListed: false, generateContentSupported: false, structuredOutputValid: false, latencyMs: Date.now() - startedAt, availableStableFlashModels: stableFlashModels, errorCode: "model_not_found" };
    const generateContentSupported = !selected.supportedActions?.length || selected.supportedActions.includes("generateContent");
    if (!generateContentSupported) return { ok: false, model, modelListed: true, generateContentSupported: false, structuredOutputValid: false, latencyMs: Date.now() - startedAt, availableStableFlashModels: stableFlashModels, errorCode: "generation_unsupported" };
    const response = await client.models.generateContent({
      model,
      contents: "Return the requested synthetic preflight result.",
      config: { abortSignal: controller.signal, responseMimeType: "application/json", responseJsonSchema: toGeminiJsonSchema(PreflightSchema), temperature: 0 }
    });
    const structuredOutputValid = PreflightSchema.safeParse(JSON.parse(response.text || "null")).success;
    return { ok: structuredOutputValid, model, modelListed: true, generateContentSupported, structuredOutputValid, latencyMs: Date.now() - startedAt, availableStableFlashModels: stableFlashModels, errorCode: structuredOutputValid ? undefined : "structured_output_failed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { ok: false, model, modelListed: false, generateContentSupported: false, structuredOutputValid: false, latencyMs: Date.now() - startedAt, availableStableFlashModels: [], errorCode: /429|rate limit|resource exhausted/i.test(message) ? "rate_limited" : "provider_unavailable" };
  } finally {
    clearTimeout(timeout);
  }
}
