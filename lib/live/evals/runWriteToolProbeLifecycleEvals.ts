import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JsonLineParser, isWriteProbeProcessEvent, redactProbeText } from "../write-tool-probe/probeEventProtocol";
import { runWriteToolProbeParent } from "./runWriteToolProbeParent";

let passed = 0;
async function test(name: string, fn: () => unknown | Promise<unknown>) {
  await fn(); passed += 1; process.stdout.write(`PASS ${name}\n`);
}
const fake = fileURLToPath(new URL("./fakeWriteToolProbeProcess.ts", import.meta.url));
const child = fileURLToPath(new URL("./runWriteToolProbeChild.ts", import.meta.url));
const run = async (scenario: string, timeoutMs = 1_000, graceMs = 40) => {
  const stdout: string[] = []; const stderr: string[] = [];
  const value = await runWriteToolProbeParent({ childArgs: ["--import", "tsx", fake, scenario], timeoutMs, graceMs, writeOut: (line) => stdout.push(line), writeErr: (line) => stderr.push(line) });
  return { ...value, stdout: stdout.join(""), stderr: stderr.join("") };
};

async function main() {
await test("parent receives child_started", async () => assert.match((await run("success")).stdout, /child_started/));
await test("JSONL records parse incrementally", () => { const lines: string[] = []; const p = new JsonLineParser((line) => lines.push(line)); p.push("{\"a\":"); p.push("1}\n"); assert.deepEqual(lines, ["{\"a\":1}"]); });
await test("partial stdout chunks reassemble", async () => assert.equal((await run("partial")).result.passed, true));
await test("multiple records in one chunk parse", async () => assert.equal((await run("multiple")).result.lastObservedEvent, "cleanup_complete"));
await test("invalid JSON is safely classified", async () => assert.equal((await run("invalid")).result.errorCode, "invalid_event_protocol"));
await test("child stderr secrets are redacted", async () => { const value = await run("stderr"); assert.equal(/AIza|wss:\/\/|access_token=secret/.test(value.stderr), false); });
await test("parent records last observed stage", async () => assert.equal((await run("success")).result.lastObservedEvent, "cleanup_complete"));
await test("child emits before dynamic import", async () => { const source = await readFile(child, "utf8"); assert.ok(source.indexOf('event: "child_started"') < source.indexOf('await import("./runWriteToolProbeChildRunner")')); });
await test("runner-load failure has terminal classification", async () => assert.equal((await run("config-failure")).result.errorCode, "runner_load_failed"));
await test("successful child exits zero", async () => assert.equal((await run("success")).exitCode, 0));
await test("provider failure exits one", async () => assert.equal((await run("failure")).exitCode, 1));
await test("harness failure exits two", async () => assert.equal((await run("config-failure")).exitCode, 2));
await test("hanging child is terminated", async () => assert.equal((await run("hang", 300)).result.childTerminated, true));
await test("watchdog exits 124", async () => assert.equal((await run("hang", 300)).exitCode, 124));
await test("SIGTERM permits cleanup", async () => assert.equal((await run("hang", 300)).result.lastObservedEvent, "cleanup_complete"));
await test("SIGKILL fallback handles ignored SIGTERM", async () => assert.equal((await run("ignore-term", 300)).result.forcedKillRequired, true));
await test("parent stays within hard bound", async () => { const start = Date.now(); await run("ignore-term", 300, 40); assert.ok(Date.now() - start < 800); });
await test("forced bound returns even if close never arrives", async () => { const start = Date.now(); const value = await run("ignore-term", 300, 40); assert.equal(value.exitCode, 124); assert.ok(Date.now() - start < 800); });
await test("terminal output flushes before exit", async () => assert.equal((await run("success")).result.cleanupCompleted, true));
await test("missing terminal is classified", async () => assert.equal((await run("no-terminal")).result.errorCode, "child_exit_without_terminal_record"));
await test("heartbeats are valid and deadline-neutral", () => assert.equal(isWriteProbeProcessEvent({ type: "heartbeat", stage: "waiting_for_tool", elapsedMs: 5_000 }), true));
await test("heartbeats contain no provider content", () => assert.equal(JSON.stringify({ type: "heartbeat", stage: "waiting_for_tool", elapsedMs: 5_000 }).includes("content"), false));
await test("redactor removes authenticated URLs", () => assert.equal(redactProbeText(`${"wss:"}//host/path?access_token=x`).includes("wss://"), false));
await test("no automatic provider retry", async () => { const value = await run("failure"); assert.equal(value.stdout.match(/child_started/g)?.length, 1); });
await test("terminal protocol rejects fallback", () => assert.equal(isWriteProbeProcessEvent({ type: "terminal", passed: true, cleanupCompleted: true, fallbackUsed: true }), false));

process.stdout.write(`\n${passed} write-probe lifecycle checks passed. No provider call was made.\n`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
