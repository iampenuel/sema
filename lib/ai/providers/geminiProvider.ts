import "server-only";
import { GeminiAIProviderCore, type GeminiOptions } from "./geminiProviderCore";

export class GeminiAIProvider extends GeminiAIProviderCore {
  constructor(options: GeminiOptions) {
    super(options);
  }
}
