import { loadEnvConfig } from "@next/env";
import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { getLiveConfig } from "../liveConfig";
import { mintGeminiLiveToken } from "../ephemeralToken";
import { classifyLiveError } from "../liveErrors";

async function main() {
  loadEnvConfig(process.cwd());
  const config = getLiveConfig();
  const startedAt = Date.now();
  let session: Session | undefined;
  try {
  const minted = await mintGeminiLiveToken();
  const client = new GoogleGenAI({ apiKey: minted.token, httpOptions: { apiVersion: "v1alpha" } });
  const result = await new Promise<{ audioChunks: number; transcripts: number; readOnlyToolCalled: boolean; writeProposed: boolean; writeExecutedBeforeConfirmation: boolean; fallbackUsed: false }>(async (resolve, reject) => {
    let audioChunks = 0;
    let transcripts = 0;
    let readOnlyToolCalled = false;
    let writeProposed = false;
    let writeExecutedBeforeConfirmation = false;
    let requestedWrite = false;
    const timeout = setTimeout(() => reject(new Error("Live smoke timeout")), 20_000);
    session = await client.live.connect({
      model: config.model,
      callbacks: {
        onmessage(message) {
          if (message.data) audioChunks += 1;
          if (message.serverContent?.inputTranscription?.text || message.serverContent?.outputTranscription?.text) transcripts += 1;
          for (const call of message.toolCall?.functionCalls ?? []) {
            if (!call.id || !call.name) continue;
            if (call.name === "openSignalFolder" && call.args?.folderId === "body_location") {
              readOnlyToolCalled = true;
              session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { output: "Opened the Body/Location Signal Folder." } }] });
            } else if (call.name === "prepareEvidencePacket") {
              writeProposed = true;
              writeExecutedBeforeConfirmation = false;
              setTimeout(() => session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { error: "Visible UI confirmation is required; no write was executed." } }] }), 100);
            } else {
              session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { error: "Unexpected tool in focused smoke test." } }] });
            }
          }
          if (message.serverContent?.turnComplete && readOnlyToolCalled && !requestedWrite) {
            requestedWrite = true;
            session?.sendClientContent({ turns: "Propose prepareEvidencePacket now. Do not claim it ran before the application confirms it.", turnComplete: true });
          } else if (message.serverContent?.turnComplete && readOnlyToolCalled && writeProposed && audioChunks > 0 && transcripts > 0) {
            clearTimeout(timeout);
            resolve({ audioChunks, transcripts, readOnlyToolCalled, writeProposed, writeExecutedBeforeConfirmation, fallbackUsed: false });
          }
        },
        onerror(event) { clearTimeout(timeout); reject(new Error(event.message)); },
        onclose(event) { if (!audioChunks) { clearTimeout(timeout); reject(new Error(event.reason || "Live session closed")); } }
      },
      config: { responseModalities: [Modality.AUDIO] }
    });
    session.sendClientContent({ turns: "Call openSignalFolder with folderId body_location, then briefly confirm only after its successful tool result.", turnComplete: true });
  });
  process.stdout.write(JSON.stringify({ ok: true, ...result, durationMs: Date.now() - startedAt }) + "\n");
  } catch (error) {
  const safe = classifyLiveError(error);
  process.stdout.write(JSON.stringify({ ok: false, code: safe.code, message: safe.message, durationMs: Date.now() - startedAt }) + "\n");
  process.exitCode = 1;
  } finally {
  session?.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
