import { GoogleGenAI } from "@google/genai";
import { StoryExtractionDraftSchema } from "@/lib/ai/aiSchemas";
import { toGeminiJsonSchema } from "@/lib/ai/geminiSchema";
import { storyExtractionPrompt } from "@/lib/ai/prompts";
import { validateStoryExtraction } from "@/lib/ai/validators/validateStoryExtraction";
import { loadTestEnvironment } from "./loadTestEnvironment";

const STORY = "Yesterday afternoon, Jordan fell onto their left hand while playing basketball. Later that evening, the left wrist felt stiff and uncomfortable when rotating it or putting pressure on it. This morning, the stiffness was still present. Jordan has not entered any diagnosis and wants to organize these observations before speaking with a clinician.";

async function main() {
  loadTestEnvironment();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    process.stderr.write("CONFIGURATION_REQUIRED: GEMINI_API_KEY is not configured in .env.local.\n");
    process.exitCode = 2;
    return;
  }
  const model = process.env.SEMA_AI_MODEL || "gemini-3.5-flash";
  const client = new GoogleGenAI({ apiKey });
  const startedAt = Date.now();
  const response = await client.models.generateContent({
    model,
    contents: storyExtractionPrompt({ rawText: STORY, concernType: "pain_injury" }),
    config: { responseMimeType: "application/json", responseJsonSchema: toGeminiJsonSchema(StoryExtractionDraftSchema), temperature: 0.1 }
  });
  const responseText = response.text || "";
  let raw: unknown;
  try { raw = JSON.parse(responseText); }
  catch {
    process.stdout.write(`${JSON.stringify({ test: "story_debug", model, latencyMs: Date.now() - startedAt, jsonValid: false, responseLength: responseText.length })}\n`);
    process.exitCode = 1;
    return;
  }
  const parsed = StoryExtractionDraftSchema.safeParse(raw);
  const provenance = parsed.success ? validateStoryExtraction(STORY, parsed.data) : undefined;
  const safety = { safe: provenance?.ok === true };
  process.stdout.write(`${JSON.stringify({
    test: "story_debug", model, latencyMs: Date.now() - startedAt, jsonValid: true,
    resultShape: raw && typeof raw === "object" ? Object.fromEntries(Object.entries(raw as Record<string, unknown>).map(([key, value]) => [key, Array.isArray(value) ? `array(${value.length})` : value === null ? "null" : typeof value])) : typeof raw,
    schemaValid: parsed.success,
    schemaIssues: parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code, message: issue.message })),
    provenanceValid: provenance?.ok ?? false,
    provenanceIssues: provenance?.ok === false ? provenance.issues : [],
    safetyValid: safety.safe,
    sanitizedSyntheticResult: raw
  }, null, 2)}\n`);
  if (!parsed.success || !provenance?.ok || !safety.safe) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`STORY_DEBUG_FAILED: ${error instanceof Error ? error.message : "unknown error"}\n`);
  process.exitCode = 1;
});
