import type { SemaAIProvider, SemaAIResult } from "./aiTypes";
import { LocalAIProvider } from "./providers/localProvider";

export async function runWithLocalFallback<T>(provider: SemaAIProvider, operation: (selected: SemaAIProvider) => Promise<SemaAIResult<T>>, fallbackAlreadyActive = false) {
  const primary = await operation(provider);
  if (primary.ok) return { ...primary, metadata: { ...primary.metadata, fallbackUsed: fallbackAlreadyActive } };
  if (primary.error?.code === "cancelled") return primary;
  if (provider.id === "local") return primary;
  const local = await operation(new LocalAIProvider());
  return { ...local, metadata: { ...local.metadata, fallbackUsed: true } };
}
