import { z } from "zod";
import { Type, type FunctionDeclaration, type Schema } from "@google/genai";
import { createAgentAction } from "@/lib/agent/actionRegistry";
import { evaluatePermission } from "@/lib/agent/permissionGate";
import type { AgentAction, AgentActionType } from "@/lib/agent/agentTypes";
import type { SemaSession, SignalFolderId } from "@/lib/sema-session/types";
import type { LiveToolCall } from "./liveTypes";

export const LIVE_TOOL_NAMES = [
  "openSignalFolder", "showSignalFolderOverview", "readSignalFolder", "readCurrentPage", "readSafetyNote", "listMissingDetails",
  "generateStorySummary", "generateClinicianQuestions", "prepareEvidencePacket", "readPacketSection", "exportPacketPdf", "openVoiceDraftReview"
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
  generateStorySummary: emptySchema,
  generateClinicianQuestions: emptySchema,
  prepareEvidencePacket: emptySchema,
  readPacketSection: z.object({ section: sectionSchema }).strict(),
  exportPacketPdf: emptySchema,
  openVoiceDraftReview: z.object({ target: z.enum(["story", "audio"]).optional() }).strict()
};

export const LIVE_FUNCTION_DECLARATIONS: FunctionDeclaration[] = LIVE_TOOL_NAMES.map((name) => {
  const descriptions: Record<LiveToolName, string> = {
    openSignalFolder: "Navigate to one Sema signal folder without changing its saved content.",
    showSignalFolderOverview: "Return to the signal folder overview when the user asks to close a folder, go back, or see all folders.",
    readSignalFolder: "Read a concise description of saved content in one signal folder.",
    readCurrentPage: "Explain the current Sema session workspace.",
    readSafetyNote: "Read Sema's safety note and important disclaimers.",
    listMissingDetails: "List details that are currently missing from the evidence packet.",
    generateStorySummary: "Propose generating an organized story summary. Requires visible user permission.",
    generateClinicianQuestions: "Propose drafting clinician questions. Requires visible user permission.",
    prepareEvidencePacket: "Propose preparing the evidence packet draft. Requires visible user permission.",
    readPacketSection: "Read one section of the prepared evidence packet.",
    exportPacketPdf: "Propose downloading the prepared evidence packet as a PDF. Requires visible user permission; spoken agreement is not permission.",
    openVoiceDraftReview: "Navigate to the existing browser-local voice draft review. Never starts the microphone."
  };
  const properties: Record<string, Schema> = {};
  if (name === "openSignalFolder" || name === "readSignalFolder") properties.folderId = { type: Type.STRING, enum: ["story", "body_location", "audio", "motion_visual", "packet"] };
  if (name === "readPacketSection") properties.section = { type: Type.STRING, enum: ["patient_words", "summary", "timeline", "body_observations", "audio_observations", "missing_details", "clinician_questions", "safety"] };
  if (name === "openVoiceDraftReview") properties.target = { type: Type.STRING, enum: ["story", "audio"] };
  const required = name === "openSignalFolder" || name === "readSignalFolder" ? ["folderId"] : name === "readPacketSection" ? ["section"] : [];
  return { name, description: descriptions[name], parameters: { type: Type.OBJECT, properties, required } };
});

function eligibility(action: AgentAction, session: SemaSession): string | undefined {
  if (action.type === "generateStorySummary" && !session.story.rawText.trim()) return "Add a story before generating a summary.";
  if (action.type === "generateClinicianQuestions" && session.story.summaryStatus !== "approved") return "Approve the organized story summary before drafting clinician questions.";
  if (action.type === "prepareEvidencePacket" && session.story.summaryStatus !== "approved") return "Approve the organized story summary before preparing the packet.";
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
  const payload = "folderId" in args ? { folder: args.folderId as SignalFolderId } : args;
  const action = createAgentAction(name as AgentActionType, payload);
  if ((action.riskLevel === "high_impact" && action.type !== "exportPacketPdf") || action.riskLevel === "blocked") return { ok: false, message: "That action is not available to Sema Live." };
  const ineligible = eligibility(action, session);
  if (ineligible) return { ok: false, message: ineligible };
  return { ok: true, action, permissionRequired: evaluatePermission(action).outcome !== "not_required" };
}
