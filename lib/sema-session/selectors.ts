import type { SemaSession } from "./types";

export function getSessionReadiness(session: SemaSession) {
  return [
    { id: "concern", label: "Concern type selected", complete: Boolean(session.concernType) },
    { id: "story", label: "Story saved", complete: Boolean(session.story.rawText.trim()) },
    { id: "summary", label: "AI-organized summary generated", complete: Boolean(session.story.structuredSummary) },
    { id: "body", label: "Body/location observation added", complete: session.bodyMap.length > 0 },
    { id: "audio", label: "Audio observation added", complete: session.audioSignals.length > 0 },
    { id: "packet", label: "Packet draft prepared", complete: Boolean(session.packetDraft) }
  ];
}

export function getMissingFields(session: SemaSession) {
  const missing = [];

  if (!session.concernType) missing.push("Choose a concern type.");
  if (!session.story.rawText.trim()) missing.push("Add the story in the patient's own words.");
  if (!session.story.structuredSummary) missing.push("Generate or edit an AI-organized summary.");
  if (session.bodyMap.length === 0) missing.push("Add at least one body/location observation if relevant.");
  if (session.audioSignals.length === 0) missing.push("Add an audio observation or demo-safe placeholder if relevant.");
  if (!session.packetDraft) missing.push("Prepare the evidence packet preview.");

  return missing;
}
