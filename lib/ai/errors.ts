import type { SemaAIErrorCode } from "./aiTypes";

export class SemaAIError extends Error {
  constructor(public code: SemaAIErrorCode, message: string, public retryable = false, public retryAfterMs?: number) {
    super(message);
    this.name = "SemaAIError";
  }
}

export const SAFE_AI_ERROR_MESSAGE = "AI organization is temporarily unavailable; a local draft was prepared instead.";
