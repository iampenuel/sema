import { z } from "zod";
import { Type, type FunctionDeclaration, type Schema } from "@google/genai";
import { createAgentAction } from "@/lib/agent/actionRegistry";
import { evaluatePermission } from "@/lib/agent/permissionGate";
import { getPacketReadinessDecision, packetNotReadyMessage } from "@/lib/sema-session/selectors";
import type { AgentAction, AgentActionType } from "@/lib/agent/agentTypes";
import type { SemaSession, SignalFolderId } from "@/lib/sema-session/types";
import type { LiveToolCall } from "./liveTypes";

export const LIVE_TOOL_NAMES = [
  "openSignalFolder", "showSignalFolderOverview", "readSignalFolder", "readCurrentPage", "readSafetyNote", "listMissingDetails",
  "explainCurrentStep", "listMissingFields",
  "navigateToStory", "navigateToBodyMap", "navigateToAudio", "navigateToMotionVisual", "navigateToPacket",
  "generateStorySummary", "generateEvidenceSummary", "updatePatientStory", "generateClinicianQuestions", "prepareEvidencePacket", "preparePacketDraft", "readPacketSection", "exportPacketPdf", "openVoiceDraftReview", "openPhotoCapture", "readPhotoObservation"
] as const;

export type LiveToolName = typeof LIVE_TOOL_NAMES[number];

const folderSchema = z.enum(["story", "body_location", "audio", "motion_visual", "packet"]);
const sectionSchema = z.enum(["patient_words", "summary", "timeline", "body_observations", "audio_observations", "missing_details", "clinician_questions", "safety"]);
const emptySchema = z.object({}).strict();
const schemas: Record<LiveToolName, z.ZodType<Record<string, unknown>>> = {
  openSignalFolder: z.object({ folderId: folderSchema }).strict(),
  showSignalFolderOverview: emptySchema,
  readSignalFolder: z.object({ folderId: folderSchema }).strict(),
  readCurrentPage: emptySchema,
  readSafetyNote: emptySchema,
  listMissingDetails: emptySchema,
  explainCurrentStep: emptySchema,
  listMissingFields: emptySchema,
  navigateToStory: emptySchema,
  navigateToBodyMap: emptySchema,
  navigateToAudio: emptySchema,
  navigateToMotionVisual: emptySchema,
  navigateToPacket: emptySchema,
  generateStorySummary: emptySchema,
  generateEvidenceSummary: emptySchema,
  updatePatientStory: z.object({ text: z.string().min(1).max(1000) }).strict(),
  generateClinicianQuestions: emptySchema,
  prepareEvidencePacket: emptySchema,
  preparePacketDraft: emptySchema,
  readPacketSection: z.object({ section: sectionSchema }).strict(),
  exportPacketPdf: emptySchema,
  openVoiceDraftReview: z.object({ target: z.enum(["story", "audio"]).optional() }).strict(),
  openPhotoCapture: emptySchema,
  readPhotoObservation: emptySchema
};

export const LIVE_FUNCTION_DECLARATIONS: FunctionDeclaration[] = LIVE_TOOL_NAMES.map((name) => {
  const descriptions: Record<LiveToolName, string> = {
    openSignalFolder: "Navigate to one Sema signal folder without changing its saved content.",
    showSignalFolderOverview: "Return to the signal folder overview when the user asks to close a folder, go back, or see all folders.",
    readSignalFolder: "Read a concise description of saved content in one signal folder.",
    readCurrentPage: "Explain the current Sema session workspace.",
    readSafetyNote: "Read Sema's safety note and important disclaimers.",
    listMissingDetails: "List details that are currently missing from the evidence packet.",
    explainCurrentStep: "Explain what the user can do on the current Sema page or folder.",
    listMissingFields: "List details that are currently missing from the evidence packet.",
    navigateToStory: "Navigate to the Story Signal Folder once.",
    navigateToBodyMap: "Navigate to the Body/Location Signal Folder once.",
    navigateToAudio: "Navigate to the Audio Signal Folder once.",
    navigateToMotionVisual: "Navigate to the Motion/Visual Signal Folder once.",
    navigateToPacket: "Navigate to the Evidence Packet preview once.",
    generateStorySummary: "Propose generating an organized story summary. Requires visible user permission.",
    generateEvidenceSummary: "Propose generating an organized story summary. Requires visible user permission.",
    updatePatientStory: "Propose adding concise user-provided wording to the Story review queue. Requires visible user permission.",
    generateClinicianQuestions: "Propose drafting clinician questions. Requires visible user permission.",
    prepareEvidencePacket: "Propose preparing the evidence packet draft. Requires visible user permission.",
    preparePacketDraft: "Propose preparing the evidence packet draft. Requires visible user permission.",
    readPacketSection: "Read one section of the prepared evidence packet.",
    exportPacketPdf: "Propose downloading the prepared evidence packet as a PDF. Requires visible user permission; spoken agreement is not permission.",
    openVoiceDraftReview: "Navigate to the existing browser-local voice draft review. Never starts the microphone.",
    openPhotoCapture: "Open the Motion/Visual photo explanation. Never requests camera access, starts the camera, captures, saves, or approves a photo.",
    readPhotoObservation: "Read only user-authored metadata for the latest approved photo. Never analyze or interpret the image."
  };
  const properties: Record<string, Schema> = {};
  if (name === "openSignalFolder" || name === "readSignalFolder") properties.folderId = { type: Type.STRING, enum: ["story", "body_location", "audio", "motion_visual", "packet"] };
  if (name === "readPacketSection") properties.section = { type: Type.STRING, enum: ["patient_words", "summary", "timeline", "body_observations", "audio_observations", "missing_details", "clinician_questions", "safety"] };
  if (name === "openVoiceDraftReview") properties.target = { type: Type.STRING, enum: ["story", "audio"] };
  if (name === "updatePatientStory") properties.text = { type: Type.STRING };
  const required = name === "openSignalFolder" || name === "readSignalFolder" ? ["folderId"] : name === "readPacketSection" ? ["section"] : [];
  if (name === "updatePatientStory") required.push("text");
  return { name, description: descriptions[name], parameters: { type: Type.OBJECT, properties, required } };
});

function eligibility(action: AgentAction, session: SemaSession): string | undefined {
  if (action.type === "generateStorySummary" && !session.story.rawText.trim()) return "Add a story before generating a summary.";
  if (action.type === "generateClinicianQuestions" && session.story.summaryStatus !== "approved") return "Approve the organized story summary before drafting clinician questions.";
  if (action.type === "prepareEvidencePacket") {
    const readiness = getPacketReadinessDecision(session);
    if (!readiness.ready) return packetNotReadyMessage(readiness);
  }
  if (action.type === "readPacketSection" && !session.packetDraft) return "Prepare an evidence packet before reading a packet section.";
  if (action.type === "exportPacketPdf" && !session.packetDraft) return "Prepare an evidence packet before downloading a PDF.";
  return undefined;
}

export function validateLiveToolCall(call: LiveToolCall, session: SemaSession):
  | { ok: true; action: AgentAction; permissionRequired: boolean }
  | { ok: false; message: string } {
  if (!LIVE_TOOL_NAMES.includes(call.name as LiveToolName)) return { ok: false, message: "That action is not available to Sema Live." };
  const name = call.name as LiveToolName;
  const parsed = schemas[name].safeParse(call.args ?? {});
  if (!parsed.success) return { ok: false, message: "The requested action did not include valid parameters." };

  const args = parsed.data;
  const folderByTool: Partial<Record<LiveToolName, SignalFolderId>> = {
    navigateToStory: "story",
    navigateToBodyMap: "body_location",
    navigateToAudio: "audio",
    navigateToMotionVisual: "motion_visual",
    navigateToPacket: "packet"
  };
  const canonicalTypeByTool: Partial<Record<LiveToolName, AgentActionType>> = {
    explainCurrentStep: "readCurrentPage",
    listMissingFields: "listMissingDetails",
    generateEvidenceSummary: "generateStorySummary",
    preparePacketDraft: "prepareEvidencePacket",
    navigateToStory: "openSignalFolder",
    navigateToBodyMap: "openSignalFolder",
    navigateToAudio: "openSignalFolder",
    navigateToMotionVisual: "openSignalFolder",
    navigateToPacket: "openSignalFolder"
  };
  const canonicalType = canonicalTypeByTool[name] ?? name as AgentActionType;
  const payload = folderByTool[name]
    ? { folder: folderByTool[name] }
    : "folderId" in args
      ? { folder: args.folderId as SignalFolderId }
      : args;
  const action = createAgentAction(canonicalType, payload);
  if ((action.riskLevel === "high_impact" && action.type !== "exportPacketPdf") || action.riskLevel === "blocked") return { ok: false, message: "That action is not available to Sema Live." };
  const ineligible = eligibility(action, session);
  if (ineligible) return { ok: false, message: ineligible };
  return { ok: true, action, permissionRequired: evaluatePermission(action).outcome !== "not_required" };
}
