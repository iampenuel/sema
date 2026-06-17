import type { SemaSession } from "./types";

export function createEmptySession(): SemaSession {
  return {
    id: `session-${Date.now()}`,
    story: {
      rawText: ""
    },
    bodyMap: [],
    audioSignals: [],
    safetyFlags: [],
    currentStep: "start",
    updatedAt: new Date().toISOString()
  };
}
