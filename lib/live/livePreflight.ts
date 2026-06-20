import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { getLiveConfig } from "./liveConfig";
import { mintGeminiLiveToken } from "./ephemeralToken";
import { classifyLiveError } from "./liveErrors";

export async function preflightGeminiLive(timeoutMs = 15_000) {
  const config = getLiveConfig();
  const startedAt = Date.now();
  if (!config.hasApiKey) return { ok: false, code: "configuration_missing", model: config.model, modelListed: false, tokenMinted: false, connected: false, durationMs: 0 };
  let session: Session | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timeoutHandle = setTimeout(() => reject(new Error("Live preflight timeout")), timeoutMs); });
  try {
    const work = (async () => {
      const permanentClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const pager = await permanentClient.models.list({ config: { pageSize: 100 } });
      let modelListed = false;
      for await (const model of pager) if (model.name?.replace(/^models\//, "") === config.model) modelListed = true;
      const minted = await mintGeminiLiveToken();
      const ephemeralClient = new GoogleGenAI({ apiKey: minted.token, httpOptions: { apiVersion: "v1alpha" } });
      session = await ephemeralClient.live.connect({
        model: config.model,
        callbacks: { onmessage() {}, onerror() {}, onclose() {} },
        config: { responseModalities: [Modality.AUDIO] }
      });
      session.close();
      session = undefined;
      return { ok: true, model: config.model, voiceName: config.voiceName, modelListed, tokenMinted: true, constraintsAccepted: true, connected: true, durationMs: Date.now() - startedAt };
    })();
    return await Promise.race([work, timeout]);
  } catch (error) {
    const safe = classifyLiveError(error);
    return { ok: false, code: safe.code === "connection_failed" ? "model_unavailable" : safe.code, model: config.model, modelListed: false, tokenMinted: false, connected: false, durationMs: Date.now() - startedAt };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    session?.close();
  }
}
