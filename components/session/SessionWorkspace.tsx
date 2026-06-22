"use client";

import { useRef, useState } from "react";
import { ArrowLeft, ChevronDown, RotateCcw, ShieldCheck, X } from "lucide-react";
import { SemaAgentPanel } from "@/components/agent/SemaAgentPanel";
import { AudioSignalCard } from "@/components/audio/AudioSignalCard";
import { BodyMapSignalCard } from "@/components/body-map/BodyMapSignalCard";
import { EvidencePacketPreview } from "@/components/packet/EvidencePacketPreview";
import { PacketReadinessCard } from "@/components/packet/PacketReadinessCard";
import { StorySignalCard } from "@/components/story/StorySignalCard";
import { createAgentAction } from "@/lib/agent/actionRegistry";
import { AIClientError, draftPacketWithAI, extractStoryWithAI, storyDraftToSummary } from "@/lib/ai/client";
import { evaluatePermission } from "@/lib/agent/permissionGate";
import { useAgentActions } from "@/hooks/useAgentActions";
import { useSemaSession } from "@/hooks/useSemaSession";
import { useEphemeralPhotos } from "@/hooks/useEphemeralPhotos";
import { useVoiceCapture } from "@/hooks/useVoiceCapture";
import { useSemaLiveSession } from "@/hooks/useSemaLiveSession";
import { buildApprovedSessionContent, fingerprintApprovedSessionContent } from "@/lib/packet/approvedContent";
import { createPacketReviewDraft } from "@/lib/packet/reviewDraft";
import { ConcernTypeSelector } from "./ConcernTypeSelector";
import { MotionVisualSignalFolder } from "./MotionVisualSignalFolder";
import { ReviewBoard } from "./ReviewBoard";
import { SignalFolderGrid, type SignalFolderId } from "./SignalFolderGrid";
import type { AudioSignal } from "@/lib/sema-session/types";
import type { EphemeralPhotoDraft, PhotoObservationMetadata } from "@/lib/photo/types";
import type { VoiceTargetFolder } from "@/lib/voice/voiceTypes";

const folderLabels: Record<SignalFolderId, string> = {
  story: "Story Signal Folder",
  body_location: "Body/Location Signal Folder",
  audio: "Audio Signal Folder",
  motion_visual: "Motion/Visual Signal Folder",
  packet: "Evidence Packet"
};

export function SessionWorkspace() {
  const {
    session,
    dispatch,
    setConcernType,
    openFolder: setActiveFolder,
    updateStory,
    applyVoiceStoryText,
    saveStory,
    generateSummary,
    setSummaryDraft,
    updateStructuredSummary,
    approveStructuredSummary,
    discardStructuredSummary,
    setPacketNarrativeDraft,
    updatePacketNarrativeDraft,
    approvePacketNarrativeDraft,
    discardPacketNarrativeDraft,
    addBodyObservation,
    removeBodyObservation,
    addAudioSignal,
    removeAudioSignal,
    addMotionVisualNote,
    addPhotoObservation,
    updatePhotoObservation,
    removePhotoObservation,
    preparePacket,
    loadDemo,
    clearSession
  } = useSemaSession();
  const ephemeralPhotos = useEphemeralPhotos();
  const voiceCapture = useVoiceCapture();
  const [voicePanelTarget, setVoicePanelTarget] = useState<VoiceTargetFolder | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [photoCaptureOpen, setPhotoCaptureOpen] = useState(false);
  const [storyOrganizing, setStoryOrganizing] = useState(false);
  const [storyFallbackNotice, setStoryFallbackNotice] = useState<string | null>(null);
  const [storyAIError, setStoryAIError] = useState<string | null>(null);
  const [packetDrafting, setPacketDrafting] = useState(false);
  const [packetFallbackNotice, setPacketFallbackNotice] = useState<string | null>(null);
  const [packetAIError, setPacketAIError] = useState<string | null>(null);
  const storyAbortRef = useRef<AbortController | null>(null);
  const packetAbortRef = useRef<AbortController | null>(null);
  const storyRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLDivElement | null>(null);
  const packetRef = useRef<HTMLDivElement | null>(null);
  const activePanelRef = useRef<HTMLDivElement | null>(null);
  const agentActions = useAgentActions({
    dispatch,
    activePanelRef,
    packetRef,
    getSession: () => session,
    onNavigate: (folder) => openFolder(folder),
    onVoiceAction: handleVoiceAgentAction,
    onOpenPhotoCapture: () => {
      setActiveFolder("motion_visual");
      setPhotoCaptureOpen(true);
    },
    onClearEphemeralPhotos: ephemeralPhotos.clear,
    getRuntimePhotoAttachments: () => ephemeralPhotos.attachments()
  });
  const live = useSemaLiveSession({ session, executeAction: agentActions.execute, onSafetyFlags: (flags) => dispatch({ type: "add_safety_flags", flags }) });

  function openFolder(folder: SignalFolderId, scroll = true) {
    if (folder !== "motion_visual") setPhotoCaptureOpen(false);
    if (voicePanelTarget && folder !== voicePanelTarget) {
      const hasVoiceWork = Boolean(voiceCapture.state.audioBlob || voiceCapture.state.transcriptDraft.trim() || voiceCapture.state.elapsedSeconds);
      if (hasVoiceWork && !window.confirm("Leave voice capture and delete the unsaved browser-local draft?")) return;
      voiceCapture.cancel();
      setVoicePanelTarget(null);
    }
    setActiveFolder(folder);
    if (scroll) window.setTimeout(() => (folder === "packet" ? packetRef.current : activePanelRef.current)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function openVoicePanel(target: VoiceTargetFolder) {
    voiceCapture.setTarget(target);
    setVoicePanelTarget(target);
  }

  function closeVoicePanel() {
    voiceCapture.reset();
    setVoicePanelTarget(null);
  }

  function handleVoiceAgentAction(action: import("@/lib/agent/agentTypes").AgentAction) {
    const requestedTarget = action.payload?.target === "story" ? "story" : "audio";
    switch (action.type) {
      case "requestMicrophonePermission":
      case "startVoiceCapture":
        setActiveFolder(requestedTarget);
        openVoicePanel(requestedTarget);
        return "Voice controls are open. Use Allow microphone and Start recording when you are ready; Sema cannot start the microphone for you.";
      case "stopVoiceCapture":
        voiceCapture.stop();
        return voiceCapture.state.status === "recording" || voiceCapture.state.status === "paused" ? "Recording stopped. Your browser-local draft is moving to review." : "There is no active recording to stop.";
      case "cancelVoiceCapture": {
        const hasDraft = Boolean(voiceCapture.state.audioBlob || voiceCapture.state.transcriptDraft.trim() || voiceCapture.state.elapsedSeconds);
        if (hasDraft && !window.confirm("Cancel this recording and delete the unsaved browser-local draft?")) return "The recording draft was kept.";
        voiceCapture.cancel();
        setVoicePanelTarget(null);
        return "The browser-local recording was cancelled. Nothing was added to the session.";
      }
      case "openVoiceDraftReview":
        setActiveFolder(voiceCapture.state.targetFolder);
        setVoicePanelTarget(voiceCapture.state.targetFolder);
        return voiceCapture.state.status === "reviewing" ? "The voice draft is open for review." : "There is no completed voice draft yet. The recording controls are open.";
      case "saveVoiceDraftToFolder":
        voiceCapture.setTarget(requestedTarget);
        setActiveFolder(requestedTarget);
        setVoicePanelTarget(requestedTarget);
        return "The voice review is open with the requested folder selected. Review the text and use the approval control before saving.";
      case "discardVoiceDraft":
        voiceCapture.cancel();
        setVoicePanelTarget(null);
        return "The unsaved voice draft was discarded.";
      default:
        return "Voice controls are ready.";
    }
  }

  function saveVoiceToStory(transcript: string, mode: "append" | "replace") {
    const action = mode === "replace" ? "replace the existing story" : "append this reviewed text to the story";
    if (!window.confirm(`Save the reviewed voice transcript and ${action}? Existing summaries and packet drafts will be cleared because the story changed.`)) return false;
    applyVoiceStoryText(transcript, mode);
    return true;
  }

  function saveVoiceToAudio(signal: AudioSignal) {
    if (!window.confirm("Save this reviewed transcript and recording metadata to the Audio Signal Folder? Raw audio will not be stored in the session.")) return false;
    addAudioSignal(signal);
    return true;
  }

  function confirmClearSession() {
    const decision = evaluatePermission(createAgentAction("clearSession"));
    const confirmed = window.confirm(decision.message);
    if (confirmed) {
      ephemeralPhotos.clear();
      setPhotoCaptureOpen(false);
      clearSession();
      setActiveFolder("story");
    }
  }

  function approvePhoto(draft: EphemeralPhotoDraft, metadata: PhotoObservationMetadata) {
    ephemeralPhotos.add(draft);
    addPhotoObservation(metadata);
  }

  function removePhoto(id: string) {
    if (!window.confirm("Remove this photo observation and delete its current-tab image?")) return;
    ephemeralPhotos.remove(id);
    removePhotoObservation(id);
  }

  async function requestGenerateSummary() {
    const decision = evaluatePermission(createAgentAction("generateStorySummary"));
    if (!window.confirm(decision.message)) return;
    storyAbortRef.current?.abort();
    const controller = new AbortController();
    storyAbortRef.current = controller;
    setStoryOrganizing(true);
    setStoryAIError(null);
    setStoryFallbackNotice(null);
    try {
      const response = await extractStoryWithAI(session.story.rawText, session.concernType, controller.signal);
      if (controller.signal.aborted) return;
      setSummaryDraft(storyDraftToSummary(response.draft));
      setStoryFallbackNotice(response.fallbackNotice ?? null);
    } catch (error) {
      if (controller.signal.aborted) return;
      const mustNotFallback = error instanceof AIClientError && (error.code === "safety_blocked" || error.code === "validation_failed");
      if (!mustNotFallback) {
        generateSummary();
        setStoryFallbackNotice("AI enhancement is temporarily unavailable. Sema is continuing in local mode, and your saved session data is still available.");
      }
      setStoryAIError(error instanceof Error ? error.message : "Sema could not organize this story right now.");
    } finally {
      if (storyAbortRef.current === controller) storyAbortRef.current = null;
      setStoryOrganizing(false);
    }
  }

  async function requestPacketNarrative() {
    if (session.story.summaryStatus !== "approved") {
      setPacketAIError("Approve the story draft before drafting packet narrative content.");
      return;
    }
    const decision = evaluatePermission(createAgentAction("prepareEvidencePacket"));
    if (!window.confirm(decision.message)) return;
    packetAbortRef.current?.abort();
    const controller = new AbortController();
    packetAbortRef.current = controller;
    setPacketDrafting(true);
    setPacketAIError(null);
    setPacketFallbackNotice(null);
    try {
      const approvedContent = buildApprovedSessionContent(session);
      const response = await draftPacketWithAI(approvedContent, controller.signal);
      if (controller.signal.aborted) return;
      setPacketNarrativeDraft(createPacketReviewDraft(response.draft, response.metadata.provider, fingerprintApprovedSessionContent(approvedContent)));
      setPacketFallbackNotice(response.fallbackNotice ?? null);
    } catch (error) {
      if (!controller.signal.aborted) setPacketAIError(error instanceof Error ? error.message : "Sema could not draft packet content right now.");
    } finally {
      if (packetAbortRef.current === controller) packetAbortRef.current = null;
      setPacketDrafting(false);
    }
  }

  function requestPreparePacket() {
    const decision = evaluatePermission(createAgentAction("prepareEvidencePacket"));
    if (!window.confirm(decision.message)) return true;
    return preparePacket();
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start">
        <aside className="no-print hidden lg:sticky lg:top-20 lg:block" aria-label="Sema agent rail">
          <SemaAgentPanel session={session} onExecuteAction={agentActions.execute} onSafetyFlags={(flags) => dispatch({ type: "add_safety_flags", flags })} live={live} rail />
        </aside>

        <div className="min-w-0 space-y-6">
          <section className="rounded-lg border border-sema-border bg-white/90 p-4 shadow-card sm:p-5" aria-labelledby="session-title">
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div>
                <p className="text-xs font-bold text-sema-blue">ACTIVE SEMA SESSION</p>
                <h1 id="session-title" className="mt-1 font-editorial text-2xl font-semibold text-ink sm:text-3xl">Signal Case File Workspace</h1>
                <p className="mt-1 max-w-2xl text-sm leading-5 text-sema-slate">Build a patient-generated evidence packet from saved signal folders.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 md:justify-end">
                <span className="inline-flex items-center gap-2 rounded-full bg-[#edf5f9] px-3 py-2 text-xs font-semibold text-sema-slate">
                  <ShieldCheck className="h-4 w-4 text-sema-green" aria-hidden="true" />
                  Patient-provided information · Not a diagnosis
                </span>
                <button type="button" onClick={confirmClearSession} className="no-print inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-sema-border bg-white px-3 py-1.5 text-xs font-semibold text-sema-slate transition hover:border-[#d6a9a9] hover:text-[#9b4141]">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Clear
                </button>
              </div>
            </div>
            <p className="mt-4 rounded-md border border-[#c5dbe9] bg-sema-pale/70 px-3 py-2.5 text-sm leading-5 text-sema-blue-dark">Open any signal folder, save what you noticed, then prepare the evidence packet.</p>
          </section>

          <ConcernTypeSelector value={session.concernType} onChange={setConcernType} />

          <SignalFolderGrid session={session} activeFolder={session.activeFolder} onOpen={openFolder} />

          {session.activeFolder !== "packet" && <section ref={activePanelRef} className="scroll-mt-24" aria-labelledby="open-folder-title">
            <div className="mb-3 flex items-center justify-between gap-3 rounded-t-lg border border-b-0 border-sema-border border-l-sema-blue bg-[#f8fbfd] px-4 py-3 shadow-sm">
              <div>
                <p className="text-xs font-bold text-sema-blue">OPEN FOLDER</p>
                <h2 id="open-folder-title" className="mt-1 text-lg font-bold text-ink">{folderLabels[session.activeFolder]}</h2>
              </div>
              <button type="button" onClick={() => document.getElementById("signal-folders-title")?.scrollIntoView({ behavior: "smooth", block: "start" })} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-sema-blue-dark hover:text-sema-blue">
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                Back to folders
              </button>
            </div>

            {session.activeFolder === "story" && (
              <div ref={storyRef}>
                <StorySignalCard session={session} onStoryChange={updateStory} onSaveStory={saveStory} onGenerateSummary={requestGenerateSummary} onLoadDemo={loadDemo} onSummaryChange={updateStructuredSummary} organizing={storyOrganizing} onCancelOrganizing={() => storyAbortRef.current?.abort()} aiFallbackNotice={storyFallbackNotice} aiError={storyAIError} capture={voiceCapture} voiceOpen={voicePanelTarget === "story"} onOpenVoice={() => openVoicePanel("story")} onCloseVoice={closeVoicePanel} onSaveVoiceStory={saveVoiceToStory} onSaveVoiceAudio={saveVoiceToAudio} />
                <FolderContinue onClick={() => openFolder("body_location")} label="Save and continue to Body/Location Signal" />
              </div>
            )}
            {session.activeFolder === "body_location" && (
              <div ref={bodyRef}>
                <BodyMapSignalCard session={session} onAdd={addBodyObservation} onRemove={removeBodyObservation} />
                <FolderContinue onClick={() => openFolder("audio")} label="Save and continue to Audio Signal" />
              </div>
            )}
            {session.activeFolder === "audio" && (
              <div ref={audioRef}>
                <AudioSignalCard session={session} onAdd={addAudioSignal} onRemove={removeAudioSignal} capture={voiceCapture} voiceOpen={voicePanelTarget === "audio"} onOpenVoice={() => openVoicePanel("audio")} onCloseVoice={closeVoicePanel} onSaveVoiceStory={saveVoiceToStory} onSaveVoiceAudio={saveVoiceToAudio} />
                <FolderContinue onClick={() => openFolder("motion_visual")} label="Continue to optional Motion/Visual Signal" />
              </div>
            )}
            {session.activeFolder === "motion_visual" && <MotionVisualSignalFolder
              notes={session.motionVisualNotes}
              photos={session.photoObservations}
              photoCaptureOpen={photoCaptureOpen}
              onOpenPhotoCapture={() => setPhotoCaptureOpen(true)}
              onClosePhotoCapture={() => setPhotoCaptureOpen(false)}
              onApprovePhoto={approvePhoto}
              onUpdatePhoto={updatePhotoObservation}
              onRemovePhoto={removePhoto}
              getRuntimePhoto={ephemeralPhotos.get}
              onSave={addMotionVisualNote}
            />}
          </section>}

          <ReviewBoard
            session={session}
            onApprove={approveStructuredSummary}
            onEdit={() => openFolder("story")}
            onDiscard={discardStructuredSummary}
            onRegenerateStory={requestGenerateSummary}
            onPrepare={requestPreparePacket}
            onDraftPacket={requestPacketNarrative}
            onApprovePacketDraft={approvePacketNarrativeDraft}
            onUpdatePacketDraft={updatePacketNarrativeDraft}
            onDiscardPacketDraft={discardPacketNarrativeDraft}
            packetDrafting={packetDrafting}
            onCancelPacketDraft={() => packetAbortRef.current?.abort()}
            packetFallbackNotice={packetFallbackNotice}
            packetError={packetAIError}
          />

          <PacketReadinessCard session={session} onPrepare={requestPreparePacket} />

          <div ref={packetRef} className="scroll-mt-24">
            <EvidencePacketPreview packet={session.packetDraft} runtimePhotos={ephemeralPhotos.attachments(new Set(session.packetDraft?.photoObservations.filter((photo) => photo.includeInPacket).map((photo) => photo.id) ?? []))} />
          </div>
        </div>
      </div>

      <div className="no-print lg:hidden">
        <button type="button" onClick={() => setAgentOpen(true)} className="fixed bottom-4 left-4 right-4 z-40 flex min-h-12 items-center justify-between rounded-lg bg-sema-blue px-4 py-3 font-semibold text-white shadow-blue" aria-expanded={agentOpen}>
          Message Sema
          <ChevronDown className="h-5 w-5 rotate-180" aria-hidden="true" />
        </button>
        {agentOpen && (
          <div className="fixed inset-0 z-50 bg-ink/25 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Sema agent">
            <div className="absolute inset-x-0 bottom-0 max-h-[86vh] overflow-y-auto rounded-t-lg bg-paper p-4 shadow-soft">
              <div className="mb-3 flex items-center justify-between">
                <p className="font-bold text-ink">Sema agent</p>
                <button type="button" onClick={() => setAgentOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-md border border-sema-border bg-white text-sema-slate" aria-label="Close Sema agent">
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
              <SemaAgentPanel session={session} onExecuteAction={agentActions.execute} onSafetyFlags={(flags) => dispatch({ type: "add_safety_flags", flags })} live={live} />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function FolderContinue({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <div className="mt-3 flex justify-end">
      <button type="button" onClick={onClick} className="inline-flex min-h-11 items-center rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-sema-blue-dark">{label}</button>
    </div>
  );
}
