import { PacketAIDraftSchema } from "../aiSchemas";
import type { ApprovedSessionContent, PacketAIDraft } from "../aiTypes";
import { validateModelSafety } from "./validateModelSafety";

const unsupportedFacts = [
  { label: "swelling", pattern: /\b(swell(?:ing|en)?)\b/i },
  { label: "bruising", pattern: /\b(bruis(?:e|ed|ing))\b/i },
  { label: "numbness", pattern: /\bnumb(?:ness)?\b/i },
  { label: "tingling", pattern: /\btingl(?:e|ing)\b/i },
  { label: "weakness", pattern: /\bweak(?:ness)?\b/i },
  { label: "painScore", pattern: /\b(?:pain|discomfort)\s*(?:score|rating|level)|\b\d+\s*\/\s*10\b/i },
  { label: "rangeOfMotion", pattern: /\b(?:reduced|limited|decreased) range of motion\b/i },
  { label: "fracture", pattern: /\bfractur(?:e|ed)\b/i },
  { label: "sprain", pattern: /\bsprain(?:ed)?\b/i }
];

const unsafePacketClaims = [
  /\b(?:diagnos(?:is|ed)|treat(?:ment|ed)?|medication|medicine|prescri(?:be|bed|ption))\b/i,
  /\b(?:urgent|urgency|emergency|safe|unsafe)\b/i,
  /\b(?:wait|delay) (?:before|to|until)\b/i,
  /\b(?:audio|recording|sound)\b.{0,40}\b(?:indicates?|suggests?|shows?|sounds like)\b/i,
  /\b(?:body|location|marker|observation)\b.{0,40}\b(?:indicates?|proves?|confirms?|shows?)\b/i,
  /\b(?:clinician|doctor|medical professional) (?:reviewed|confirmed|verified|approved)\b/i,
  /\b(?:medically certain|clinical certainty|definitely|certainly)\b/i
];

function approvedSourceText(content?: ApprovedSessionContent) {
  if (!content) return "";
  return JSON.stringify(content);
}

export function assessPacketDraft(value: unknown, approvedContent?: ApprovedSessionContent) {
  const parsed = PacketAIDraftSchema.safeParse(value);
  if (!parsed.success) return { schemaValid: false, contentBoundaryValid: false, safetyValid: false, schemaIssues: parsed.error.issues.map((issue) => issue.path.join(".")), contentIssues: [], safetyIssues: [] };

  const draft = parsed.data;
  const factualFields = [draft.conciseNarrative, ...draft.organizationNotes].join("\n");
  const sourceText = approvedSourceText(approvedContent);
  const contentIssues = unsupportedFacts
    .filter(({ pattern }) => pattern.test(factualFields) && !pattern.test(sourceText))
    .map(({ label }) => `unsupported.${label}`);
  const safetyIssues = unsafePacketClaims.filter((pattern) => pattern.test(factualFields)).map((_, index) => `unsafe.${index}`);
  if (!validateModelSafety(factualFields).safe) safetyIssues.push("modelSafety");
  draft.clinicianQuestions.forEach((question, index) => {
    if (!question.trim().endsWith("?")) safetyIssues.push(`clinicianQuestions.${index}`);
  });
  return {
    schemaValid: true,
    contentBoundaryValid: contentIssues.length === 0,
    safetyValid: safetyIssues.length === 0,
    schemaIssues: [],
    contentIssues,
    safetyIssues,
    data: draft
  };
}

export function validatePacketDraft(value: unknown, approvedContent?: ApprovedSessionContent) {
  const assessment = assessPacketDraft(value, approvedContent);
  if (!assessment.schemaValid) return { ok: false as const, reason: "schema", issues: assessment.schemaIssues };
  if (!assessment.contentBoundaryValid) return { ok: false as const, reason: "content_boundary", issues: assessment.contentIssues };
  if (!assessment.safetyValid) return { ok: false as const, reason: "safety", issues: assessment.safetyIssues };
  return { ok: true as const, data: assessment.data as PacketAIDraft };
}
