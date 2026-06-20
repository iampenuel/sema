import { loadEnvConfig } from "@next/env";
import { preflightGeminiLive } from "../livePreflight";

async function main() {
  loadEnvConfig(process.cwd());
  const result = await preflightGeminiLive();
  process.stdout.write(JSON.stringify({ test: "gemini_live_preflight", ...result }) + "\n");
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
