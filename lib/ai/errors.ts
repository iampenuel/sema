import type { SemaAIErrorCode } from "./aiTypes";

export class SemaAIError extends Error {
  constructor(public code: SemaAIErrorCode, message: string, public retryable = false, public retryAfterMs?: number) {
    super(message);
    this.name = "SemaAIError";
  }
}

export const SAFE_AI_ERROR_MESSAGE = "AI enhancement is temporarily unavailable. Sema is continuing in local mode, and your saved session data is still available.";
