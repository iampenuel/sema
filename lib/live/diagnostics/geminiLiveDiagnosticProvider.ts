import { GoogleGenAI, Modality, type LiveConnectConfig, type Session } from "@google/genai";
import { getLiveConfig } from "../liveConfig";
import { buildLiveTokenTimes } from "../liveTokenPolicy";
import {
  classifyDiagnosticFailure,
  DIRECT_LIVE_API_VERSION,
  LiveDiagnosticFailure,
  TOKEN_API_VERSION,
  withDiagnosticTimeout,
  type ConnectionOutcome,
  type DiagnosticDependencies,
  type DiagnosticToken
} from "./liveDiagnosticCore";

const DEFAULT_TIMEOUT_MS = 15_000;

function asErrorMessage(value: unknown, fallback: string) {
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message;
  return fallback;
}

async function connectUntilSetup(client: GoogleGenAI, model: string, config: LiveConnectConfig, timeoutMs: number): Promise<ConnectionOutcome> {
  let session: Session | undefined;
  let socketOpened = false;
  let setupAccepted = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let resolveSetup!: () => void;
  let rejectSetup!: (error: Error) => void;
  const setup = new Promise<void>((resolve, reject) => { resolveSetup = resolve; rejectSetup = reject; });
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new LiveDiagnosticFailure("Live diagnostic timeout", { socketOpened, setupAccepted })), timeoutMs);
  });
  try {
    const connection = client.live.connect({
      model,
      callbacks: {
        onopen() { socketOpened = true; },
        onmessage(message) {
          if (message.setupComplete) {
            setupAccepted = true;
            resolveSetup();
          }
        },
        onerror(event) {
          rejectSetup(new LiveDiagnosticFailure(asErrorMessage(event, "Live socket error"), { socketOpened, setupAccepted }));
        },
        onclose(event) {
          if (!setupAccepted) rejectSetup(new LiveDiagnosticFailure(event.reason || "Live socket closed before setup", { socketOpened, setupAccepted }));
        }
      },
      config
    });
    session = await Promise.race([connection, timeout]);
    await Promise.race([setup, timeout]);
    session.close();
    session = undefined;
    return { socketOpened, setupAccepted };
  } catch (error) {
    if (error instanceof LiveDiagnosticFailure) throw error;
    throw new LiveDiagnosticFailure(asErrorMessage(error, "Live connection failed"), { socketOpened, setupAccepted });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    session?.close();
  }
}

export function createGeminiLiveDiagnosticDependencies(timeoutMs = DEFAULT_TIMEOUT_MS): DiagnosticDependencies {
  const config = getLiveConfig();
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  return {
    model: config.model,
    hasApiKey: Boolean(apiKey),
    async checkModelVisibility() {
      try {
        const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: DIRECT_LIVE_API_VERSION } });
        const pager = await withDiagnosticTimeout(client.models.list({ config: { pageSize: 100 } }), timeoutMs, "Model visibility request");
        let matched = false;
        for await (const model of pager) if (model.name?.replace(/^models\//, "") === config.model) matched = true;
        return { modelListed: matched, modelNameMatched: matched, inconclusive: !matched };
      } catch (error) {
        const failure = classifyDiagnosticFailure(error, "model_visibility");
        if (["authentication_failed", "rate_limited", "timeout", "provider_unavailable"].includes(failure.code)) throw error;
        return { modelListed: false, modelNameMatched: false, inconclusive: true };
      }
    },
    async connectDirect() {
      const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: DIRECT_LIVE_API_VERSION } });
      return connectUntilSetup(client, config.model, { responseModalities: [Modality.AUDIO] }, timeoutMs);
    },
    async createMinimalToken() {
      const { expiresAt, newSessionExpiresAt } = buildLiveTokenTimes(Date.now(), config.maxSessionMinutes);
      const client = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: TOKEN_API_VERSION } });
      const token = await withDiagnosticTimeout(client.authTokens.create({
        config: {
          uses: 1,
          expireTime: expiresAt.toISOString(),
          newSessionExpireTime: newSessionExpiresAt.toISOString(),
          httpOptions: { apiVersion: TOKEN_API_VERSION }
        }
      }), timeoutMs, "Minimal token creation");
      return { name: token.name ?? "", expiresAt: expiresAt.toISOString() };
    },
    async connectConstrained(token: DiagnosticToken) {
      const client = new GoogleGenAI({ apiKey: token.name, httpOptions: { apiVersion: TOKEN_API_VERSION } });
      return connectUntilSetup(client, config.model, { responseModalities: [Modality.AUDIO] }, timeoutMs);
    }
  };
}
