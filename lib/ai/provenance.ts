import type { StoryExtractionDraft } from "./aiTypes";

export function normalizeEvidenceText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function supported(rawText: string, excerpts: string[]) {
  const raw = normalizeEvidenceText(rawText);
  return excerpts.length > 0 && excerpts.every((excerpt) => {
    const normalized = normalizeEvidenceText(excerpt);
    return normalized.length >= 3 && raw.includes(normalized);
  });
}

const stopWords = new Set(["a", "an", "and", "at", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "their", "this", "to", "was", "when", "while", "with"]);

function factualValueSupported(value: string, excerpts: string[]) {
  const normalizedValue = normalizeEvidenceText(value);
  const normalizedEvidence = normalizeEvidenceText(excerpts.join(" "));
  if (normalizedEvidence.includes(normalizedValue) || normalizedValue.includes(normalizedEvidence)) return true;
  const valueTokens = Array.from(new Set(normalizedValue.split(" ").filter((token) => token.length > 2 && !stopWords.has(token))));
  if (!valueTokens.length) return false;
  const evidenceTokens = new Set(normalizedEvidence.split(" "));
  const overlap = valueTokens.filter((token) => evidenceTokens.has(token)).length / valueTokens.length;
  return overlap >= 0.7;
}

export function validateStoryProvenance(rawText: string, draft: StoryExtractionDraft) {
  const failures: string[] = [];
  if (!supported(rawText, draft.mainConcernSupportingText) || !factualValueSupported(draft.mainConcern, draft.mainConcernSupportingText)) failures.push("mainConcern");
  draft.timeline.forEach((item, index) => { if (!supported(rawText, item.supportingText) || !factualValueSupported(item.detail, item.supportingText)) failures.push(`timeline.${index}`); });
  (["affectedAreas", "changesOverTime", "triggersOrPatterns", "patientConcerns"] as const).forEach((key) => {
    draft[key].forEach((item, index) => { if (!supported(rawText, item.supportingText) || !factualValueSupported(item.value, item.supportingText)) failures.push(`${key}.${index}`); });
  });
  return { ok: failures.length === 0, failures };
}
