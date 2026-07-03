import type { PhotoObservationMetadata } from "@/lib/photo/types";

export type ConcernType =
  | "pain_injury"
  | "cough_respiratory"
  | "skin_visible"
  | "report_document"
  | "other";

export type SignalFolderId = "story" | "body_location" | "audio" | "motion_visual" | "packet";

export type FolderStatus = "empty" | "in_progress" | "saved" | "needs_review" | "optional" | "planned_later" | "not_applicable";

export type TimelineItem = {
  id: string;
  label: string;
  detail: string;
  source: "patient_stated" | "ai_organized" | "demo_generated";
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
  source: "ai_organized_from_patient_provided_information" | "demo_generated";
};

export type BodyMapObservation = {
  id: string;
  x?: number;
  y?: number;
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
  mimeType?: string;
  tags: string[];
  notes?: string;
  transcript?: string;
  transcriptSource?: "browser_transcribed_user_reviewed";
  createdAt: string;
  source: "browser_voice_capture" | "patient_recorded" | "demo_simulated" | "manual_note";
};

export type PacketAudioSignal = Pick<AudioSignal, "id" | "name" | "durationSeconds" | "mimeType" | "tags" | "notes" | "transcript" | "transcriptSource" | "createdAt" | "source">;

export type MotionVisualNote = {
  id: string;
  note: string;
  createdAt: string;
  source: "patient_stated";
};

export type EvidencePacket = {
  id: string;
  generatedAt: string;
  concernType?: ConcernType;
  patientWords: string;
  aiOrganizedSummary?: StructuredSummary;
  bodyLocationObservations: BodyMapObservation[];
  audioSignals: PacketAudioSignal[];
  motionVisualNotes: MotionVisualNote[];
  photoObservations: PhotoObservationMetadata[];
  missingDetails: string[];
  clinicianQuestions: string[];
  organizedNarrative?: string;
  organizationNotes?: string[];
  safetyNote: string;
  limitations: string[];
  label: "generated_from_patient_provided_information";
};

export type PacketNarrativeDraft = {
  conciseNarrative: string;
  missingDetails: string[];
  clinicianQuestions: string[];
  organizationNotes: string[];
  source: "ai_organized_from_approved_information" | "local_organized_from_approved_information";
  status: "needs_review" | "approved";
  contentFingerprint: string;
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
    | "image_interpretation_request"
    | "delay_care_request"
    | "privacy_warning"
    | "missing_context";
  message: string;
  severity: "info" | "caution" | "blocked";
};

export type DraftCapture = {
  id: string;
  targetFolder: SignalFolderId;
  title: string;
  content: string;
  createdAt: string;
  source: "agent_drafted" | "voice_drafted" | "demo_generated";
  status: "needs_review" | "approved" | "discarded";
};

export type SemaSession = {
  id: string;
  concernType?: ConcernType;
  activeFolder: SignalFolderId;
  folderStatus: Record<SignalFolderId, FolderStatus>;
  story: {
    rawText: string;
    structuredSummary?: StructuredSummary;
    summaryStatus?: "needs_review" | "approved";
  };
  bodyLocation: BodyMapObservation[];
  audioSignals: AudioSignal[];
  motionVisualNotes: MotionVisualNote[];
  photoObservations: PhotoObservationMetadata[];
  packetDraft?: EvidencePacket;
  packetNarrativeDraft?: PacketNarrativeDraft;
  draftCaptures: DraftCapture[];
  safetyFlags: SafetyFlag[];
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
