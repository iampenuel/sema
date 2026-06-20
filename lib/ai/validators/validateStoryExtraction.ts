import { StoryExtractionDraftSchema } from "../aiSchemas";
import type { StoryExtractionDraft } from "../aiTypes";
import { validateStoryProvenance } from "../provenance";
import { validateModelSafety } from "./validateModelSafety";

function factualStoryText(value: StoryExtractionDraft) {
  return [
    value.mainConcern,
    ...value.timeline.map((item) => item.detail),
    ...value.affectedAreas.map((item) => item.value),
    ...value.changesOverTime.map((item) => item.value),
    ...value.triggersOrPatterns.map((item) => item.value),
    ...value.patientConcerns.map((item) => item.value),
    value.summaryNote
  ].join("\n");
}

export function validateStoryExtraction(rawText: string, value: unknown) {
  const parsed = StoryExtractionDraftSchema.safeParse(value);
  if (!parsed.success) return { ok: false as const, reason: "schema", issues: parsed.error.issues };
  const provenance = validateStoryProvenance(rawText, parsed.data);
  if (!provenance.ok) return { ok: false as const, reason: "provenance", issues: provenance.failures };
  const allowedReviewNotes = new Set([
    "AI-organized from patient-provided information only. Review before saving.",
    "AI-organized from patient-provided information only. No diagnosis, treatment, or urgency level was generated."
  ]);
  if (!allowedReviewNotes.has(parsed.data.summaryNote)) return { ok: false as const, reason: "provenance", issues: ["summaryNote"] };
  if (parsed.data.clinicianQuestions.some((question) => !question.trim().endsWith("?"))) return { ok: false as const, reason: "schema", issues: ["clinicianQuestions"] };
  if (!validateModelSafety(factualStoryText(parsed.data)).safe) return { ok: false as const, reason: "safety", issues: ["factualFields"] };
  return { ok: true as const, data: parsed.data };
}
