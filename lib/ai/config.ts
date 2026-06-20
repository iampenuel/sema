import "server-only";
import { resolveAIConfig, type SemaAIConfig } from "./configCore";
export type { SemaAIConfig } from "./configCore";

export function getAIConfig(): SemaAIConfig {
  return resolveAIConfig(process.env);
}
