import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { AgentAIProposalSchema, PacketAIDraftSchema, StoryExtractionDraftSchema } from "../aiSchemas";
import { SemaAIError } from "../errors";
import { toGeminiJsonSchema } from "../geminiSchema";
import { agentPrompt, packetDraftPrompt, storyExtractionPrompt } from "../prompts";
import type { AgentAIInput, AgentAIProposal, PacketAIDraft, SemaAIProvider, SemaAIRequestOptions, SemaAIResult, StoryExtractionDraft, StoryExtractionInput } from "../aiTypes";

export type GeminiOptions = { apiKey: string; model: string; timeoutMs: number };

function parseRetryAfterMs(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const direct = typeof record.retryAfterMs === "number" ? record.retryAfterMs : undefined;
  if (direct !== undefined) return direct;
  const headers = record.headers ?? (record.response && typeof record.response === "object" ? (record.response as Record<string, unknown>).headers : undefined);
  if (!headers || typeof headers !== "object") return undefined;
  const get = (headers as { get?: (name: string) => unknown }).get;
  if (typeof get !== "function") return undefined;
  const value = get.call(headers, "retry-after");
  if (typeof value !== "string" || !value.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export function classifyGeminiError(error: unknown, externallyAborted = false) {
  if (externallyAborted) return new SemaAIError("cancelled", "The AI request was cancelled.");
  if (error instanceof SemaAIError) return error;
  const message = error instanceof Error ? error.message : "Unknown provider error";
  if (/429|rate limit|resource exhausted/i.test(message)) {
    const retryAfterMs = parseRetryAfterMs(error);
    const shortRetry = retryAfterMs !== undefined && retryAfterMs > 0 && retryAfterMs <= 2000;
    return new SemaAIError("rate_limited", "The AI provider is temporarily rate limited.", shortRetry, retryAfterMs);
  }
  if (/abort|timeout/i.test(message)) return new SemaAIError("timeout", "The AI provider request timed out.", true);
  if (/5\d\d|unavailable|network/i.test(message)) return new SemaAIError("provider_unavailable", "The AI provider is temporarily unavailable.", true);
  return new SemaAIError("unknown_error", "The AI provider request failed.");
}

function retryDelay(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const finish = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, delayMs);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

function boundedTransientRetryDelay() {
  return 350 + Math.floor(Math.random() * 250);
}

export class GeminiAIProviderCore implements SemaAIProvider {
  id = "gemini" as const;
  private client: GoogleGenAI;

  constructor(private options: GeminiOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
  }

  private async generate<T>(prompt: string, schema: z.ZodType<T>, requestOptions?: SemaAIRequestOptions): Promise<SemaAIResult<T>> {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    let lastError: SemaAIError | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (requestOptions?.signal?.aborted) {
        return { ok: false, error: { code: "cancelled", message: "The AI request was cancelled." }, metadata: { provider: "gemini", model: this.options.model, fallbackUsed: false, latencyMs: Date.now() - startedAt, requestId } };
      }
      const controller = new AbortController();
      const forwardAbort = () => controller.abort();
      requestOptions?.signal?.addEventListener("abort", forwardAbort, { once: true });
      const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
      try {
        const response = await this.client.models.generateContent({
          model: this.options.model,
          contents: prompt,
          config: {
            abortSignal: controller.signal,
            responseMimeType: "application/json",
            responseJsonSchema: toGeminiJsonSchema(schema),
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            temperature: 0.1
          }
        });
        const raw = JSON.parse(response.text || "null") as unknown;
        const parsed = schema.safeParse(raw);
        if (!parsed.success) throw new SemaAIError("validation_failed", "The AI response did not match the required structure.");
        return { ok: true, data: parsed.data, metadata: { provider: "gemini", model: this.options.model, fallbackUsed: false, latencyMs: Date.now() - startedAt, requestId } };
      } catch (error) {
        lastError = classifyGeminiError(error, Boolean(requestOptions?.signal?.aborted));
        if (!lastError.retryable || attempt === 1) break;
        await retryDelay(lastError.retryAfterMs ?? boundedTransientRetryDelay(), requestOptions?.signal);
      } finally {
        clearTimeout(timeout);
        requestOptions?.signal?.removeEventListener("abort", forwardAbort);
      }
    }

    return { ok: false, error: { code: lastError?.code ?? "unknown_error", message: lastError?.message ?? "The AI provider request failed." }, metadata: { provider: "gemini", model: this.options.model, fallbackUsed: false, latencyMs: Date.now() - startedAt, requestId } };
  }

  extractStory(input: StoryExtractionInput, options?: SemaAIRequestOptions): Promise<SemaAIResult<StoryExtractionDraft>> {
    return this.generate(storyExtractionPrompt(input), StoryExtractionDraftSchema, options);
  }

  proposeAgentResponse(input: AgentAIInput, options?: SemaAIRequestOptions): Promise<SemaAIResult<AgentAIProposal>> {
    return this.generate(agentPrompt(input), AgentAIProposalSchema, options);
  }

  draftPacketContent(input: Parameters<SemaAIProvider["draftPacketContent"]>[0], options?: SemaAIRequestOptions): Promise<SemaAIResult<PacketAIDraft>> {
    return this.generate(packetDraftPrompt(input), PacketAIDraftSchema, options);
  }
}
