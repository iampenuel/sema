import { emitProbeEvent } from "../write-tool-probe/probeEventProtocol";

const scenario = process.argv[2] ?? "success";
const startedAt = Date.now();
const lifecycle = (event: "child_started" | "loading_runner" | "runner_loaded" | "probe_starting" | "waiting_for_tool" | "cleanup_start" | "cleanup_complete") =>
  emitProbeEvent({ type: "lifecycle", event, elapsedMs: Date.now() - startedAt });

async function main() {
  if (scenario === "invalid") { process.stdout.write("not-json\n"); return; }
  if (scenario === "multiple") {
    process.stdout.write(`${JSON.stringify({ type: "lifecycle", event: "child_started", elapsedMs: 0 })}\n${JSON.stringify({ type: "lifecycle", event: "runner_loaded", elapsedMs: 1 })}\n`);
  } else if (scenario === "partial") {
    const line = `${JSON.stringify({ type: "lifecycle", event: "child_started", elapsedMs: 0 })}\n`;
    process.stdout.write(line.slice(0, 12)); await new Promise((resolve) => setTimeout(resolve, 5)); process.stdout.write(line.slice(12));
  } else await lifecycle("child_started");
  await lifecycle("loading_runner"); await lifecycle("runner_loaded"); await lifecycle("probe_starting");
  if (scenario === "stderr") process.stderr.write(`AI${"za"}012345678901234567890123456789 access_token=secret ${"wss:"}//secret.test/path\n`);
  if (scenario === "no-terminal") return;
  if (scenario === "hang" || scenario === "ignore-term") {
    await lifecycle("waiting_for_tool");
    if (scenario === "hang") process.on("SIGTERM", async () => { await lifecycle("cleanup_start"); await lifecycle("cleanup_complete"); process.exit(143); });
    else process.on("SIGTERM", () => {});
    setInterval(() => {}, 1_000);
    return;
  }
  const passed = scenario !== "failure" && scenario !== "config-failure";
  await lifecycle("cleanup_start"); await lifecycle("cleanup_complete");
  await emitProbeEvent({ type: "terminal", passed, ...(passed ? {} : { errorCode: scenario === "config-failure" ? "runner_load_failed" : "provider_error" }), cleanupCompleted: true, fallbackUsed: false });
  process.exitCode = passed ? 0 : scenario === "config-failure" ? 2 : 1;
}

void main();
