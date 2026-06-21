export type LiveDiagnosticCode =
  | "configuration_missing"
  | "model_not_listed"
  | "direct_live_connect_failed"
  | "direct_live_setup_rejected"
  | "token_create_failed"
  | "token_constraint_rejected"
  | "token_missing_name"
  | "constrained_socket_failed"
  | "constrained_setup_rejected"
  | "voice_config_rejected"
  | "thinking_config_rejected"
  | "tool_config_rejected"
  | "transcription_config_rejected"
  | "rate_limited"
  | "timeout"
  | "authentication_failed"
  | "region_or_account_unavailable"
  | "provider_unavailable"
  | "unknown_error";

export type LiveDiagnosticStage =
  | "model_visibility"
  | "direct_live_connection"
  | "minimal_token_creation"
  | "constrained_live_connection";

export type LiveApiVersion = "v1beta" | "v1alpha";

export type LiveDiagnosticResult = {
  stage: LiveDiagnosticStage;
  passed: boolean;
  code?: LiveDiagnosticCode;
  providerStatus?: number;
  providerReason?: string;
  model: string;
  apiVersion: LiveApiVersion;
  tokenCreated: boolean;
  socketOpened: boolean;
  setupAccepted: boolean;
  fallbackUsed: false;
  modelListed?: boolean;
  modelNameMatched?: boolean;
  listingStatus?: "model_listing_inconclusive";
  tokenNamePresent?: boolean;
  expirationPresent?: boolean;
};

export type DiagnosticToken = {
  name: string;
  expiresAt: string;
};

export type ConnectionOutcome = {
  socketOpened: boolean;
  setupAccepted: boolean;
};

export type ModelVisibilityOutcome = {
  modelListed: boolean;
  modelNameMatched: boolean;
  inconclusive: boolean;
};

export type DiagnosticDependencies = {
  model: string;
  hasApiKey: boolean;
  checkModelVisibility(): Promise<ModelVisibilityOutcome>;
  connectDirect(): Promise<ConnectionOutcome>;
  createMinimalToken(): Promise<DiagnosticToken>;
  connectConstrained(token: DiagnosticToken, config?: import("@google/genai").LiveConnectConfig): Promise<ConnectionOutcome>;
};

export type DiagnosticReport = {
  passed: boolean;
  model: string;
  stages: LiveDiagnosticResult[];
  fallbackUsed: false;
};

export const CONSTRAINED_LIVE_ENDPOINT =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
export const CONSTRAINED_TOKEN_QUERY_PARAMETER = "access_token";
export const DIRECT_LIVE_API_VERSION = "v1beta" as const;
export const TOKEN_API_VERSION = "v1alpha" as const;

export class LiveDiagnosticFailure extends Error {
  constructor(
    message: string,
    readonly context: { providerStatus?: number; socketOpened?: boolean; setupAccepted?: boolean } = {}
  ) {
    super(message);
    this.name = "LiveDiagnosticFailure";
  }
}

export async function withDiagnosticTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new LiveDiagnosticFailure(`${label} timed out`)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function rawErrorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const value = error as Record<string, unknown>;
    return [value.message, value.reason, value.statusText].filter((item) => typeof item === "string").join(" ");
  }
  return "";
}

export function getProviderStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  const candidates = [value.status, value.statusCode, value.code, (value.cause as Record<string, unknown> | undefined)?.status];
  return candidates.find((candidate): candidate is number => typeof candidate === "number");
}

export function sanitizeDiagnosticText(value: string, secrets: string[] = []) {
  let sanitized = value;
  for (const secret of secrets.filter(Boolean)) sanitized = sanitized.split(secret).join("[redacted]");
  sanitized = sanitized
    .replace(/wss?:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]")
    .replace(/(authorization|api[-_ ]?key|access_token|token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/auth_tokens\/[A-Za-z0-9._~+\/-]+/g, "auth_tokens/[redacted]")
    .replace(/AIza[A-Za-z0-9_-]{20,}/g, "[redacted-key]");
  return sanitized.slice(0, 240);
}

function providerReason(code: LiveDiagnosticCode, status?: number) {
  const suffix = status ? ` (status ${status})` : "";
  const reasons: Record<LiveDiagnosticCode, string> = {
    configuration_missing: "Required Live configuration is missing.",
    model_not_listed: "The configured Live model was not available to this account.",
    direct_live_connect_failed: "The direct Live socket could not be opened.",
    direct_live_setup_rejected: "The provider rejected the minimal direct Live setup.",
    token_create_failed: "The provider did not create an ephemeral token.",
    token_constraint_rejected: "The provider rejected the ephemeral-token constraints.",
    token_missing_name: "The token response did not include a token name.",
    constrained_socket_failed: "The constrained Live socket could not be opened.",
    constrained_setup_rejected: "The provider rejected the minimal constrained Live setup.",
    voice_config_rejected: "The provider rejected the requested voice configuration.",
    thinking_config_rejected: "The provider rejected the requested thinking configuration.",
    tool_config_rejected: "The provider rejected the requested tool configuration.",
    transcription_config_rejected: "The provider rejected the requested transcription configuration.",
    rate_limited: "The provider rate limited the diagnostic request.",
    timeout: "The provider operation timed out.",
    authentication_failed: "The provider rejected authentication.",
    region_or_account_unavailable: "Gemini Live is unavailable for this region or account.",
    provider_unavailable: "The Gemini Live provider is unavailable.",
    unknown_error: "The provider returned an unclassified diagnostic failure."
  };
  return `${reasons[code]}${suffix}`;
}

export function classifyDiagnosticFailure(
  error: unknown,
  stage: LiveDiagnosticStage | "constraint_probe",
  feature?: string
): { code: LiveDiagnosticCode; providerStatus?: number; providerReason: string } {
  const text = rawErrorText(error).toLowerCase();
  const status = getProviderStatus(error) ?? (error instanceof LiveDiagnosticFailure ? error.context.providerStatus : undefined);
  let code: LiveDiagnosticCode;
  if (status === 429 || /rate.?limit|resource_exhausted|quota/.test(text)) code = "rate_limited";
  else if (/timeout|timed out|deadline/.test(text)) code = "timeout";
  else if (status === 401 || status === 403 || /unauthenticated|invalid api key|permission denied|authentication/.test(text)) code = "authentication_failed";
  else if (/region|country|location|account.+(?:not enabled|unavailable|not supported)/.test(text)) code = "region_or_account_unavailable";
  else if (/model.+(?:not found|not available|not supported)|unsupported model/.test(text)) code = "model_not_listed";
  else if (status === 503 || /service unavailable|temporarily unavailable|provider unavailable/.test(text)) code = "provider_unavailable";
  else if (stage === "minimal_token_creation") code = /constraint|field.?mask|liveconnectconstraints/.test(text) ? "token_constraint_rejected" : "token_create_failed";
  else if (stage === "direct_live_connection") {
    const opened = error instanceof LiveDiagnosticFailure && error.context.socketOpened;
    code = opened || /setup|invalid argument|schema/.test(text) ? "direct_live_setup_rejected" : "direct_live_connect_failed";
  } else if (stage === "constrained_live_connection") {
    if (/constraint|locked|token.+(?:invalid|rejected)/.test(text)) code = "token_constraint_rejected";
    else {
      const opened = error instanceof LiveDiagnosticFailure && error.context.socketOpened;
      code = opened || /setup|invalid argument|schema/.test(text) ? "constrained_setup_rejected" : "constrained_socket_failed";
    }
  } else if (stage === "constraint_probe") {
    if (feature === "voice_kore") code = "voice_config_rejected";
    else if (feature === "thinking_low") code = "thinking_config_rejected";
    else if (feature === "one_read_only_tool" || feature === "full_approved_tools") code = "tool_config_rejected";
    else if (feature === "input_transcription" || feature === "output_transcription") code = "transcription_config_rejected";
    else code = "token_constraint_rejected";
  } else code = "unknown_error";
  return { code, providerStatus: status, providerReason: providerReason(code, status) };
}

function baseResult(stage: LiveDiagnosticStage, model: string, apiVersion: LiveApiVersion): LiveDiagnosticResult {
  return { stage, passed: false, model, apiVersion, tokenCreated: false, socketOpened: false, setupAccepted: false, fallbackUsed: false };
}

function failureResult(stage: LiveDiagnosticStage, model: string, apiVersion: LiveApiVersion, error: unknown, tokenCreated = false) {
  const failure = classifyDiagnosticFailure(error, stage);
  const context = error instanceof LiveDiagnosticFailure ? error.context : {};
  return { ...baseResult(stage, model, apiVersion), ...failure, tokenCreated, socketOpened: Boolean(context.socketOpened), setupAccepted: Boolean(context.setupAccepted) };
}

export async function runLiveDiagnosticLadder(
  dependencies: DiagnosticDependencies,
  onStage?: (result: LiveDiagnosticResult) => void
): Promise<DiagnosticReport> {
  const stages: LiveDiagnosticResult[] = [];
  const record = (result: LiveDiagnosticResult) => { stages.push(result); onStage?.(result); };
  if (!dependencies.hasApiKey) {
    const result = { ...baseResult("model_visibility", dependencies.model, DIRECT_LIVE_API_VERSION), code: "configuration_missing" as const, providerReason: providerReason("configuration_missing") };
    record(result);
    return { passed: false, model: dependencies.model, stages, fallbackUsed: false };
  }

  try {
    const visibility = await dependencies.checkModelVisibility();
    record({
      ...baseResult("model_visibility", dependencies.model, DIRECT_LIVE_API_VERSION),
      passed: true,
      modelListed: visibility.modelListed,
      modelNameMatched: visibility.modelNameMatched,
      ...(visibility.inconclusive ? { listingStatus: "model_listing_inconclusive" as const } : {})
    });
  } catch (error) {
    record(failureResult("model_visibility", dependencies.model, DIRECT_LIVE_API_VERSION, error));
    return { passed: false, model: dependencies.model, stages, fallbackUsed: false };
  }

  try {
    const outcome = await dependencies.connectDirect();
    record({ ...baseResult("direct_live_connection", dependencies.model, DIRECT_LIVE_API_VERSION), passed: true, ...outcome });
  } catch (error) {
    record(failureResult("direct_live_connection", dependencies.model, DIRECT_LIVE_API_VERSION, error));
    return { passed: false, model: dependencies.model, stages, fallbackUsed: false };
  }

  let token: DiagnosticToken;
  try {
    token = await dependencies.createMinimalToken();
    if (!token.name) throw new LiveDiagnosticFailure("Token response missing name");
    record({
      ...baseResult("minimal_token_creation", dependencies.model, TOKEN_API_VERSION),
      passed: true,
      tokenCreated: true,
      tokenNamePresent: true,
      expirationPresent: Boolean(token.expiresAt)
    });
  } catch (error) {
    const result = failureResult("minimal_token_creation", dependencies.model, TOKEN_API_VERSION, error);
    if (/missing name/i.test(rawErrorText(error))) {
      result.code = "token_missing_name";
      result.providerReason = providerReason("token_missing_name", result.providerStatus);
    }
    record(result);
    return { passed: false, model: dependencies.model, stages, fallbackUsed: false };
  }

  try {
    const outcome = await dependencies.connectConstrained(token);
    record({ ...baseResult("constrained_live_connection", dependencies.model, TOKEN_API_VERSION), passed: true, tokenCreated: true, ...outcome });
  } catch (error) {
    record(failureResult("constrained_live_connection", dependencies.model, TOKEN_API_VERSION, error, true));
    return { passed: false, model: dependencies.model, stages, fallbackUsed: false };
  }
  return { passed: true, model: dependencies.model, stages, fallbackUsed: false };
}

export type TokenSetupSemantics = "connection_supplies_setup" | "token_replaces_setup" | "field_mask_overrides_connection";

export function resolveTokenSetupSemantics(options: { hasEmbeddedSetup: boolean; fieldMask?: string[] }): TokenSetupSemantics {
  if (options.fieldMask?.length) return "field_mask_overrides_connection";
  return options.hasEmbeddedSetup ? "token_replaces_setup" : "connection_supplies_setup";
}
