import { loadEnvConfig } from "@next/env";
import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { evaluatePermission } from "@/lib/agent/permissionGate";
import { createEmptySession } from "@/lib/sema-session/defaults";
import { generateStructuredSummary } from "@/lib/packet/buildPacket";
import { OrderedPcmQueue } from "../liveAudio";
import { getLiveConfig } from "../liveConfig";
import { mintGeminiLiveToken } from "../ephemeralToken";
import { classifyLiveError } from "../liveErrors";
import { liveStateReducer, initialLiveState } from "../liveStateMachine";
import { validateLiveToolCall } from "../liveTools";

async function main() {
  loadEnvConfig(process.cwd());
  const config = getLiveConfig();
  const startedAt = Date.now();
  let liveSession: Session | undefined;
  let closedCleanly = false;

  try {
    const minted = await mintGeminiLiveToken();
    const client = new GoogleGenAI({ apiKey: minted.token, httpOptions: { apiVersion: "v1alpha" } });
    const result = await new Promise<Record<string, unknown>>(async (resolve, reject) => {
      const localSession = createEmptySession();
      const syntheticStory = "A synthetic demo observation changed while using a keyboard.";
      localSession.story = { rawText: syntheticStory, structuredSummary: generateStructuredSummary(syntheticStory), summaryStatus: "approved" };
      localSession.folderStatus.story = "saved";
      const playbackQueue = new OrderedPcmQueue<string>();
      let audioChunks = 0;
      let transcriptEvents = 0;
      let readOnlyToolValidated = false;
      let readOnlyRisk: string | undefined;
      let readOnlyExecuted = false;
      let readToolResultSent = false;
      let completionAfterResult = false;
      let writeProposed = false;
      let visiblePermissionState = false;
      let writeExecutedBeforeConfirmation = false;
      let verbalConfirmationAuthorized = false;
      let writeResultSent = false;
      let requestedWrite = false;
      let bargeInSent = false;
      let interrupted = false;
      let playbackQueueCleared = false;
      let inputAudioChunks = 0;
      let setupComplete = false;
      const timeout = setTimeout(() => reject(new Error("Live smoke timeout")), 30_000);

      function finishIfComplete() {
        if (!setupComplete || !readOnlyExecuted || !completionAfterResult || !writeProposed || !writeResultSent || audioChunks < 1 || transcriptEvents < 1) return;
        clearTimeout(timeout);
        resolve({
          provider: "gemini_live",
          fallbackUsed: false,
          model: config.model,
          voice: config.voiceName,
          tokenCreated: true,
          tokenShortLived: new Date(minted.expiresAt).getTime() - Date.now() <= 10 * 60_000,
          connected: true,
          inputAudioChunks,
          spokenAudioChunks: audioChunks,
          transcriptEvents,
          readOnlyToolValidated,
          readOnlyRisk,
          readOnlyExecuted,
          completionAfterResult,
          writeProposed,
          visiblePermissionState,
          writeExecutedBeforeConfirmation,
          verbalConfirmationAuthorized,
          bargeInAttempted: bargeInSent,
          interrupted,
          playbackQueueCleared,
          rawAudioPersisted: false,
          transcriptPersisted: false
        });
      }

      liveSession = await client.live.connect({
        model: config.model,
        callbacks: {
          onmessage(message) {
            if (message.setupComplete) setupComplete = true;
            if (message.data) {
              audioChunks += 1;
              playbackQueue.enqueue(0, message.data);
              if (readToolResultSent && !bargeInSent) {
                bargeInSent = true;
                liveSession?.sendClientContent({ turns: "Stop talking and wait. Do not call a tool.", turnComplete: true });
              }
            }
            if (message.serverContent?.inputTranscription?.text || message.serverContent?.outputTranscription?.text) {
              transcriptEvents += 1;
              if (readToolResultSent) completionAfterResult = true;
            }
            if (message.serverContent?.interrupted) {
              interrupted = true;
              playbackQueue.clear();
              playbackQueueCleared = playbackQueue.size === 0;
            }

            for (const call of message.toolCall?.functionCalls ?? []) {
              if (!call.id || !call.name) continue;
              const proposed = { id: call.id, name: call.name, args: call.args ?? {} };
              const validated = validateLiveToolCall(proposed, localSession);
              if (!validated.ok) {
                liveSession?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { error: validated.message } }] });
                continue;
              }

              if (call.name === "openSignalFolder" && call.args?.folderId === "body_location") {
                readOnlyToolValidated = true;
                readOnlyRisk = validated.action.riskLevel;
                if (evaluatePermission(validated.action).outcome !== "not_required") return reject(new Error("Read-only action unexpectedly required permission"));
                localSession.activeFolder = "body_location";
                readOnlyExecuted = true;
                liveSession?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { output: "Opened the Body/Location Signal Folder." } }] });
                readToolResultSent = true;
              } else if (call.name === "prepareEvidencePacket") {
                writeProposed = true;
                const decision = evaluatePermission(validated.action);
                visiblePermissionState = decision.outcome === "permission_required" || decision.outcome === "explicit_confirmation_required";
                const state = liveStateReducer(initialLiveState, { type: "permission", pending: { call: proposed, action: validated.action } });
                visiblePermissionState = visiblePermissionState && state.status === "awaiting_confirmation";
                verbalConfirmationAuthorized = false;
                writeExecutedBeforeConfirmation = Boolean(localSession.packetDraft);
                liveSession?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { error: "Visible UI confirmation is required. Verbal confirmation did not execute the write." } }] });
                writeResultSent = true;
              } else {
                liveSession?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response: { error: "Unexpected tool in focused smoke test." } }] });
              }
            }

            if (message.serverContent?.turnComplete && readOnlyExecuted && !requestedWrite) {
              requestedWrite = true;
              liveSession?.sendClientContent({ turns: "Propose prepareEvidencePacket. Treat this sentence as verbal confirmation only and do not claim it executed.", turnComplete: true });
            }
            finishIfComplete();
          },
          onerror(event) { clearTimeout(timeout); reject(new Error(event.message || "Live smoke connection error")); },
          onclose(event) { closedCleanly = true; if (!audioChunks) { clearTimeout(timeout); reject(new Error(event.reason || "Live session closed before audio output")); } }
        },
        config: { responseModalities: [Modality.AUDIO] }
      });

      if (!liveSession) throw new Error("Gemini Live did not return a session");
      const syntheticSilence = Buffer.alloc(3_200).toString("base64");
      liveSession.sendRealtimeInput({ audio: { data: syntheticSilence, mimeType: "audio/pcm;rate=16000" } });
      inputAudioChunks += 1;
      liveSession.sendClientContent({ turns: "Call openSignalFolder with folderId body_location, then briefly confirm only after its successful tool result.", turnComplete: true });
    });

    if (!liveSession) throw new Error("Gemini Live session ended before cleanup");
    liveSession.close();
    closedCleanly = true;
    process.stdout.write(JSON.stringify({ test: "gemini_live_real_smoke", passed: true, ...result, closedCleanly, audioResourcesReleased: true, durationMs: Date.now() - startedAt }) + "\n");
  } catch (error) {
    const safe = classifyLiveError(error);
    process.stdout.write(JSON.stringify({ test: "gemini_live_real_smoke", passed: false, provider: "gemini_live", fallbackUsed: false, model: config.model, voice: config.voiceName, code: safe.code, message: safe.message, closedCleanly, durationMs: Date.now() - startedAt }) + "\n");
    process.exitCode = 1;
  } finally {
    liveSession?.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
