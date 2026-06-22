import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isWriteProbeProcessEvent, JsonLineParser, redactProbeText, type WriteProbeLifecycleEvent, type WriteProbeProcessEvent } from "../write-tool-probe/probeEventProtocol";

export const PARENT_WATCHDOG_MS = 60_000;
export const TERMINATION_GRACE_MS = 2_000;

export type ParentProbeResult = {
  passed: boolean; errorCode?: string; failedStage?: string; lastObservedEvent: WriteProbeLifecycleEvent | "none";
  childTerminated: boolean; forcedKillRequired: boolean; cleanupCompleted: boolean; fallbackUsed: false;
  childResult?: Record<string, unknown>;
};

type ParentOptions = {
  childPath?: string; childArgs?: string[]; timeoutMs?: number; graceMs?: number;
  env?: NodeJS.ProcessEnv; writeOut?: (line: string) => void; writeErr?: (line: string) => void;
  spawnChild?: (command: string, args: string[], options: Parameters<typeof spawn>[2]) => ChildProcess;
};

function exitCodeFor(result: ParentProbeResult, childExitCode: number | null) {
  if (result.errorCode === "parent_watchdog_timeout") return 124;
  if (result.passed) return 0;
  if (["child_start_failed", "runner_load_failed", "child_exit_without_terminal_record", "invalid_event_protocol"].includes(result.errorCode ?? "") || childExitCode === 2) return 2;
  return 1;
}

export async function runWriteToolProbeParent(options: ParentOptions = {}): Promise<{ result: ParentProbeResult; exitCode: number }> {
  const writeOut = options.writeOut ?? ((line) => process.stdout.write(line));
  const writeErr = options.writeErr ?? ((line) => process.stderr.write(line));
  const childPath = options.childPath ?? fileURLToPath(new URL("./runWriteToolProbeChild.ts", import.meta.url));
  const args = options.childArgs ?? ["--import", "tsx", childPath];
  const timeoutMs = options.timeoutMs ?? PARENT_WATCHDOG_MS;
  const graceMs = options.graceMs ?? TERMINATION_GRACE_MS;
  let lastObservedEvent: WriteProbeLifecycleEvent | "none" = "none";
  let terminal: Extract<WriteProbeProcessEvent, { type: "terminal" }> | undefined;
  let invalidProtocol = false;
  let timedOut = false;
  let forcedKillRequired = false;
  let childTerminated = false;
  let childExitCode: number | null = null;
  let childStartFailed = false;
  let child: ChildProcess;
  let releaseForcedWait: (() => void) | undefined;

  try {
    child = (options.spawnChild ?? spawn)(process.execPath, args, {
      cwd: process.cwd(), env: { ...process.env, ...options.env }, stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    const result: ParentProbeResult = { passed: false, errorCode: "child_start_failed", lastObservedEvent, childTerminated: false, forcedKillRequired: false, cleanupCompleted: false, fallbackUsed: false };
    writeOut(`${JSON.stringify(result)}\n`);
    return { result, exitCode: 2 };
  }

  const parser = new JsonLineParser((line) => {
    try {
      const parsed: unknown = JSON.parse(line);
      if (!isWriteProbeProcessEvent(parsed)) { invalidProtocol = true; return; }
      if (parsed.type === "lifecycle") lastObservedEvent = parsed.event;
      if (parsed.type === "terminal") terminal = parsed;
      else writeOut(`${JSON.stringify(parsed)}\n`);
    } catch { invalidProtocol = true; }
  });
  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => parser.push(chunk));
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => writeErr(redactProbeText(chunk)));

  const closed = new Promise<void>((resolve) => {
    child.once("error", () => { childStartFailed = true; resolve(); });
    child.once("close", (code) => { childExitCode = code; parser.finish(); resolve(); });
  });
  const forcedBound = new Promise<void>((resolve) => { releaseForcedWait = resolve; });
  const watchdog = setTimeout(() => {
    timedOut = true; childTerminated = true;
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) { forcedKillRequired = true; child.kill("SIGKILL"); }
      setTimeout(() => {
        child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); releaseForcedWait?.();
      }, 250).unref();
    }, graceMs).unref();
  }, timeoutMs);
  await Promise.race([closed, forcedBound]);
  clearTimeout(watchdog);

  const result: ParentProbeResult = timedOut
    ? { passed: false, errorCode: "parent_watchdog_timeout", lastObservedEvent, childTerminated, forcedKillRequired, cleanupCompleted: terminal?.cleanupCompleted ?? false, fallbackUsed: false, childResult: terminal?.result }
    : terminal
      ? { passed: terminal.passed, ...(terminal.errorCode ? { errorCode: terminal.errorCode } : {}), ...(terminal.failedStage ? { failedStage: terminal.failedStage } : {}), lastObservedEvent, childTerminated, forcedKillRequired, cleanupCompleted: terminal.cleanupCompleted, fallbackUsed: false, childResult: terminal.result }
      : { passed: false, errorCode: childStartFailed ? "child_start_failed" : invalidProtocol ? "invalid_event_protocol" : "child_exit_without_terminal_record", lastObservedEvent, childTerminated, forcedKillRequired, cleanupCompleted: false, fallbackUsed: false };
  writeOut(`${JSON.stringify(result)}\n`);
  return { result, exitCode: exitCodeFor(result, childExitCode) };
}

async function main() {
  const { exitCode } = await runWriteToolProbeParent();
  await new Promise<void>((resolveFlush) => process.stdout.write("", () => resolveFlush()));
  process.exit(exitCode);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void main();
