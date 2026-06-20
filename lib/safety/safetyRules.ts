import type { SafetyFlag } from "@/lib/sema-session/types";
import { SAFE_REDIRECT } from "./safetyCopy";

const patterns: Array<{
  type: SafetyFlag["type"];
  severity: SafetyFlag["severity"];
  message: string;
  terms: RegExp[];
}> = [
  {
    type: "missing_context",
    severity: "blocked",
    message: "Sema cannot follow instructions that attempt to bypass its safety boundaries.",
    terms: [/\bignore (all )?(previous|safety|system|sema'?s safety) (rules|instructions|system)\b/i, /\bbypass (the )?(safety|guardrails|permission system)\b/i]
  },
  {
    type: "diagnosis_request",
    severity: "blocked",
    message: "Sema cannot diagnose or identify a medical condition.",
    terms: [/\bdiagnos(e|is)\b/i, /\bwhat do i have\b/i, /\bwhat'?s wrong with me\b/i, /\b(is|does) (this|it) (mean|sound like) .*(broken|fracture|sprain|disease|condition)\b/i, /\bis my .* (broken|fractured|sprained)\b/i]
  },
  {
    type: "treatment_request",
    severity: "blocked",
    message: "Sema cannot recommend treatment, medication, dosing, or prescribing.",
    terms: [/\bhow (do|should|can) i treat\b/i, /\bwhat treatment\b/i, /\b(what|which) (medicine|medication) should i take\b/i, /\bhow much should i take\b/i, /\bwhat dose\b/i, /\bcan you prescribe\b/i, /\bwhat should i take\b/i]
  },
  {
    type: "triage_request",
    severity: "blocked",
    message: "Sema cannot determine urgency or whether emergency care is needed.",
    terms: [/\bis this serious\b/i, /\b(should i go to|do i need) (the )?(er|emergency room|urgent care)\b/i, /\bemergency\b/i]
  },
  {
    type: "safe_unsafe_request",
    severity: "blocked",
    message: "Sema cannot determine whether someone is safe or unsafe.",
    terms: [/\bam i safe\b/i, /\bis it safe\b/i, /\bunsafe\b/i]
  },
  {
    type: "delay_care_request",
    severity: "blocked",
    message: "Sema cannot tell someone to delay or avoid care.",
    terms: [/\bcan i wait\b/i, /\bshould i wait\b/i, /\bwait until\b/i, /\bdelay care\b/i]
  },
  {
    type: "audio_classification_request",
    severity: "blocked",
    message: "Sema cannot classify audio as a disease or screen for a condition.",
    terms: [/\bcough.*sound/i, /\bwhat disease.*(cough|audio|recording)\b/i, /\bsound like (pneumonia|covid|asthma|bronchitis)\b/i, /\bclassify.*audio\b/i]
  },
  {
    type: "body_map_overinterpretation",
    severity: "blocked",
    message: "Sema cannot interpret body/location notes as proof of injury or diagnosis.",
    terms: [/\bbased on (the )?(map|body map)\b/i, /\bwhat injury\b/i, /\bproof of injury\b/i]
  }
];

export function detectUnsafeRequest(message: string): SafetyFlag[] {
  return patterns
    .filter((pattern) => pattern.terms.some((term) => term.test(message)))
    .map((pattern) => ({
      id: `safety-${pattern.type}-${Date.now()}`,
      type: pattern.type,
      message: pattern.message,
      severity: pattern.severity
    }));
}

export function getSafeRedirect(flags: SafetyFlag[]) {
  if (flags.length === 0) {
    return "";
  }

  return SAFE_REDIRECT;
}
