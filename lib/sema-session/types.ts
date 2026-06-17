export type ConcernType =
  | "pain_injury"
  | "cough_respiratory"
  | "skin_visible"
  | "report_document"
  | "other";

export type TimelineItem = {
  id: string;
  label: string;
  detail: string;
  source: "patient_stated" | "ai_organized";
};

export type StructuredSummary = {
  mainConcern: string;
  timeline: TimelineItem[];
  affectedAreas: string[];
  changesOverTime: string[];
  triggersOrPatterns: string[];
  patientConcerns: string[];
  missingDetails: string[];
  clinicianQuestions: string[];
  summaryNote: string;
};

export type BodyMapObservation = {
  id: string;
  regionLabel: string;
  signalType:
    | "pain"
    | "stiffness"
    | "swelling"
    | "numbness_tingling"
    | "rash_visible_change"
    | "discomfort"
    | "other";
  note?: string;
  intensity?: number;
  source: "patient_stated";
};

export type AudioSignal = {
  id: string;
  name: string;
  durationSeconds: number;
  objectUrl?: string;
  tags: string[];
  notes?: string;
  waveformPeaks?: number[];
  createdAt: string;
  source: "patient_recorded" | "demo_simulated";
};

export type EvidencePacket = {
  id: string;
  generatedAt: string;
  concernType?: ConcernType;
  patientWords: string;
  aiOrganizedSummary?: StructuredSummary;
  bodyMapObservations: BodyMapObservation[];
  audioSignals: AudioSignal[];
  safetyNote: string;
  limitations: string[];
  label: "generated_from_patient_provided_information";
};

export type SafetyFlag = {
  id: string;
  type:
    | "diagnosis_request"
    | "treatment_request"
    | "triage_request"
    | "safe_unsafe_request"
    | "audio_classification_request"
    | "body_map_overinterpretation"
    | "delay_care_request"
    | "privacy_warning"
    | "missing_context";
  message: string;
  severity: "info" | "caution" | "blocked";
};

export type SemaStep = "start" | "story" | "body_map" | "audio" | "packet";

export type SemaSession = {
  id: string;
  concernType?: ConcernType;
  story: {
    rawText: string;
    structuredSummary?: StructuredSummary;
  };
  bodyMap: BodyMapObservation[];
  audioSignals: AudioSignal[];
  packetDraft?: EvidencePacket;
  safetyFlags: SafetyFlag[];
  currentStep: SemaStep;
  updatedAt: string;
};

export const concernTypeLabels: Record<ConcernType, string> = {
  pain_injury: "Pain / injury",
  cough_respiratory: "Cough / respiratory",
  skin_visible: "Skin / visible change",
  report_document: "Report / document",
  other: "Other"
};

export const signalTypeLabels: Record<BodyMapObservation["signalType"], string> = {
  pain: "Pain",
  stiffness: "Stiffness",
  swelling: "Swelling",
  numbness_tingling: "Numbness / tingling",
  rash_visible_change: "Rash / visible change",
  discomfort: "Discomfort",
  other: "Other"
};
