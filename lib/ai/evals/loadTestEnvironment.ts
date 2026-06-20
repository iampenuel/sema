import { loadEnvConfig } from "@next/env";

export function loadTestEnvironment() {
  loadEnvConfig(process.cwd(), true, { info: () => undefined, error: () => undefined });
}
