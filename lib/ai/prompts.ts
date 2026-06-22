import type { AgentAIInput, PacketAIInput, StoryExtractionInput } from "./aiTypes";

const SAFETY_BOUNDARY = `Sema is a patient signal-organization system, not a medical decision system. Never diagnose, suggest a condition, treat, prescribe, recommend medication, triage, decide urgency, decide whether someone is safe, recommend waiting, classify audio as disease, interpret body markers clinically, medically analyze a photo, or invent facts.`;

export function storyExtractionPrompt(input: StoryExtractionInput) {
  return `${SAFETY_BOUNDARY}\nOrganize only the patient-provided text and preserve its meaning. Return every required schema field. Use empty arrays when no supported value exists and never return null. This is an extractive task: mainConcern, every timeline detail, and every factual value must be copied verbatim from the patient story rather than paraphrased. For every factual field, copy 1-3 short exact quotations from the patient story into supportingText. Each quotation must contain enough context to directly support the complete factual value; do not use a pronoun-only fragment when the value adds a body location or event. Do not paraphrase supportingText. Do not combine separate facts into a new claim. Do not infer symptoms, severity, dates, diagnosis, urgency, treatment, or medication. Missing details and clinician questions are suggestions, not facts, and clinician questions must end with a question mark. Set summaryNote exactly to: \"AI-organized from patient-provided information only. Review before saving.\" Return only schema-valid JSON.\nConcern category: ${input.concernType ?? "not selected"}\nPatient-provided story:\n${input.rawText}`;
}

export function agentPrompt(input: AgentAIInput) {
  return `${SAFETY_BOUNDARY}\nYou are Sema, a page-aware signal-capture co-pilot. You may explain the page and propose only registered actions. Never claim an action completed; the client decides risk, permission, and execution. Do not output risk levels or permission fields. Return only the requested JSON schema.\nCompact session context:\n${JSON.stringify(input.context)}\nUser message:\n${input.message}`;
}

export function packetDraftPrompt(input: PacketAIInput) {
  return `${SAFETY_BOUNDARY}\nDraft only optional concise narrative, missing-detail suggestions, clinician questions, and organization notes from approved content. Audio metadata is observational only. Keep missing information clearly framed as suggestions, never as patient facts. Every clinician question must end with a question mark. Do not invent symptoms, dates, events, severity, urgency, conclusions, treatments, medications, clinician review, or medical certainty. Return every required field, use empty arrays when needed, never return null, and return only the requested JSON schema.\nApproved session content:\n${JSON.stringify(input.approvedSessionContent)}`;
}
