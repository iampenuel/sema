"use client";

import { startTransition, useLayoutEffect, useRef, useState } from "react";
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
import { getPacketReadinessDecision, packetNotReadyMessage } from "@/lib/sema-session/selectors";
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

type ViewportTarget = "folder_grid" | "story" | "body_location" | "audio" | "motion_visual" | "review_board" | "packet";
type WorkspaceNavigationResult = {
  actionType: string;
  destination: ViewportTarget;
  stateCommitted: boolean;
  targetMounted: boolean;
  viewportAligned: boolean;
  focusApplied: boolean;
  success: boolean;
  failureReason?: "target_not_found" | "render_not_committed" | "navigation_cancelled" | "component_unmounted" | "unknown";
};
type PendingViewportIntent = {
  requestId: number;
  target: ViewportTarget;
  source: "voice_agent" | "text_agent" | "manual_card" | "next_step";
  behavior: "smooth" | "auto";
};

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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
  const motionRef = useRef<HTMLDivElement | null>(null);
  const folderGridRef = useRef<HTMLElement | null>(null);
  const folderGridHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const openFolderHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const reviewBoardRef = useRef<HTMLDivElement | null>(null);
  const packetHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const packetRef = useRef<HTMLDivElement | null>(null);
  const activePanelRef = useRef<HTMLDivElement | null>(null);
  const navigationRequestRef = useRef(0);
  const pendingNavigationResolverRef = useRef<((result: WorkspaceNavigationResult) => void) | null>(null);
  const [pendingViewportIntent, setPendingViewportIntent] = useState<PendingViewportIntent | null>(null);
  const agentActions = useAgentActions({
    dispatch,
    activePanelRef,
    packetRef,
    getSession: () => session,
    onNavigate: (folder) => openFolder(folder, { source: "voice_agent" }),
    onShowOverview: () => showFolderOverview("voice_agent"),
    onVoiceAction: handleVoiceAgentAction,
    onOpenPhotoCapture: () => {
      setActiveFolder("motion_visual");
      setPhotoCaptureOpen(true);
    },
    onClearEphemeralPhotos: ephemeralPhotos.clear,
    getRuntimePhotoAttachments: () => ephemeralPhotos.attachments()
  });
  const live = useSemaLiveSession({ session, executeAction: agentActions.execute, onSafetyFlags: (flags) => dispatch({ type: "add_safety_flags", flags }) });

  function resolveNavigation(result: WorkspaceNavigationResult) {
    pendingNavigationResolverRef.current?.(result);
    pendingNavigationResolverRef.current = null;
  }

  function targetElement(target: ViewportTarget) {
    if (target === "folder_grid") return folderGridRef.current;
    if (target === "packet") return packetRef.current;
    if (target === "review_board") return reviewBoardRef.current;
    return activePanelRef.current;
  }

  function targetHeading(target: ViewportTarget) {
    if (target === "folder_grid") return folderGridHeadingRef.current;
    if (target === "packet") return packetHeadingRef.current;
    if (target === "review_board") return reviewBoardRef.current?.querySelector<HTMLElement>("#review-board-title") ?? null;
    return openFolderHeadingRef.current;
  }

  function queueViewportIntent(target: ViewportTarget, source: PendingViewportIntent["source"]) {
    const requestId = navigationRequestRef.current + 1;
    navigationRequestRef.current = requestId;
    resolveNavigation({ actionType: "navigate", destination: target, stateCommitted: false, targetMounted: false, viewportAligned: false, focusApplied: false, success: false, failureReason: "navigation_cancelled" });
    setPendingViewportIntent({ requestId, target, source, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    return new Promise<WorkspaceNavigationResult>((resolve) => {
      pendingNavigationResolverRef.current = resolve;
    });
  }

  useLayoutEffect(() => {
    if (!pendingViewportIntent) return;
    const intent = pendingViewportIntent;
    let cancelled = false;
    const firstFrame = window.requestAnimationFrame(() => {
      const secondFrame = window.requestAnimationFrame(() => {
        if (cancelled || navigationRequestRef.current !== intent.requestId) return;
        const element = targetElement(intent.target);
        const heading = targetHeading(intent.target);
        if (!element || !heading) {
          resolveNavigation({ actionType: "navigate", destination: intent.target, stateCommitted: true, targetMounted: Boolean(element), viewportAligned: false, focusApplied: false, success: false, failureReason: "target_not_found" });
          setPendingViewportIntent(null);
          return;
        }
        element.scrollIntoView({ behavior: intent.behavior, block: "start" });
        heading.focus({ preventScroll: true });
        resolveNavigation({ actionType: "navigate", destination: intent.target, stateCommitted: true, targetMounted: true, viewportAligned: true, focusApplied: document.activeElement === heading, success: true });
        setPendingViewportIntent(null);
      });
      return () => window.cancelAnimationFrame(secondFrame);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
    };
  }, [pendingViewportIntent, session.activeFolder]);

  function openFolder(folder: SignalFolderId, options: { source?: PendingViewportIntent["source"]; scroll?: boolean } = {}) {
    const { source = "manual_card", scroll = true } = options;
    if (folder !== "motion_visual") setPhotoCaptureOpen(false);
    setAgentOpen(false);
    if (voicePanelTarget && folder !== voicePanelTarget) {
      const hasVoiceWork = Boolean(voiceCapture.state.audioBlob || voiceCapture.state.transcriptDraft.trim() || voiceCapture.state.elapsedSeconds);
      if (hasVoiceWork && !window.confirm("Leave voice capture and delete the unsaved browser-local draft?")) {
        return Promise.resolve<WorkspaceNavigationResult>({ actionType: "navigate", destination: folder, stateCommitted: false, targetMounted: false, viewportAligned: false, focusApplied: false, success: false, failureReason: "navigation_cancelled" });
      }
      voiceCapture.cancel();
      setVoicePanelTarget(null);
    }
    setActiveFolder(folder);
    return scroll ? queueViewportIntent(folder, source) : Promise.resolve<WorkspaceNavigationResult>({ actionType: "navigate", destination: folder, stateCommitted: true, targetMounted: true, viewportAligned: false, focusApplied: false, success: true });
  }

  function showFolderOverview(source: PendingViewportIntent["source"] = "manual_card") {
    setAgentOpen(false);
    return queueViewportIntent("folder_grid", source);
  }

  function markCurrentFolderNotApplicable() {
    if (session.activeFolder === "story" || session.activeFolder === "packet") return;
    dispatch({ type: "mark_folder_not_applicable", folder: session.activeFolder });
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
        void openFolder(requestedTarget, { source: "voice_agent" });
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
        void openFolder(voiceCapture.state.targetFolder, { source: "voice_agent" });
        setVoicePanelTarget(voiceCapture.state.targetFolder);
        return voiceCapture.state.status === "reviewing" ? "The voice draft is open for review." : "There is no completed voice draft yet. The recording controls are open.";
      case "saveVoiceDraftToFolder":
        voiceCapture.setTarget(requestedTarget);
        void openFolder(requestedTarget, { source: "voice_agent" });
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
      void openFolder("story", { source: "manual_card" });
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
      startTransition(() => {
        setSummaryDraft(storyDraftToSummary(response.draft));
        setStoryFallbackNotice(response.fallbackNotice ?? null);
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const mustNotFallback = error instanceof AIClientError && (error.code === "safety_blocked" || error.code === "validation_failed");
      if (!mustNotFallback) {
        startTransition(() => {
          generateSummary();
          setStoryFallbackNotice("AI organization is temporarily unavailable; a local draft was prepared instead.");
        });
      }
      setStoryAIError(error instanceof Error ? error.message : "Sema could not organize this story right now.");
    } finally {
      if (storyAbortRef.current === controller) storyAbortRef.current = null;
      setStoryOrganizing(false);
    }
  }

  async function requestPacketNarrative() {
    const readiness = getPacketReadinessDecision(session);
    if (!readiness.ready) {
      setPacketAIError(packetNotReadyMessage(readiness));
      return;
    }
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
      startTransition(() => {
        setPacketNarrativeDraft(createPacketReviewDraft(response.draft, response.metadata.provider, fingerprintApprovedSessionContent(approvedContent)));
        setPacketFallbackNotice(response.fallbackNotice ?? null);
      });
    } catch (error) {
      if (!controller.signal.aborted) setPacketAIError(error instanceof Error ? error.message : "Sema could not draft packet content right now.");
    } finally {
      if (packetAbortRef.current === controller) packetAbortRef.current = null;
      setPacketDrafting(false);
    }
  }

  function requestPreparePacket() {
    const readiness = getPacketReadinessDecision(session);
    if (!readiness.ready) {
      setPacketAIError(packetNotReadyMessage(readiness));
      return false;
    }
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

          <SignalFolderGrid session={session} activeFolder={session.activeFolder} onOpen={(folder) => void openFolder(folder, { source: "manual_card" })} sectionRef={folderGridRef} headingRef={folderGridHeadingRef} />

          {session.activeFolder !== "packet" && <section ref={activePanelRef} className="scroll-mt-24" aria-labelledby="open-folder-title" data-workspace-target={session.activeFolder}>
            <div className="mb-3 flex items-center justify-between gap-3 rounded-t-lg border border-b-0 border-sema-border border-l-sema-blue bg-[#f8fbfd] px-4 py-3 shadow-sm">
              <div>
                <p className="text-xs font-bold text-sema-blue">OPEN FOLDER</p>
                <h2 id="open-folder-title" ref={openFolderHeadingRef} tabIndex={-1} className="mt-1 text-lg font-bold text-ink outline-none focus-visible:ring-2 focus-visible:ring-sema-blue">{folderLabels[session.activeFolder]}</h2>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {session.activeFolder !== "story" && (
                  <button type="button" onClick={markCurrentFolderNotApplicable} className="inline-flex min-h-10 items-center rounded-md border border-sema-border bg-white px-3 text-sm font-semibold text-sema-blue-dark hover:border-sema-blue">
                    Not applicable
                  </button>
                )}
                <button type="button" onClick={() => void showFolderOverview("manual_card")} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-sema-blue-dark hover:text-sema-blue">
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                  Back to folders
                </button>
              </div>
            </div>

            {session.activeFolder === "story" && (
              <div ref={storyRef}>
                <StorySignalCard session={session} onStoryChange={updateStory} onSaveStory={saveStory} onGenerateSummary={requestGenerateSummary} onLoadDemo={loadDemo} onSummaryChange={updateStructuredSummary} organizing={storyOrganizing} onCancelOrganizing={() => storyAbortRef.current?.abort()} aiFallbackNotice={storyFallbackNotice} aiError={storyAIError} capture={voiceCapture} voiceOpen={voicePanelTarget === "story"} onOpenVoice={() => openVoicePanel("story")} onCloseVoice={closeVoicePanel} onSaveVoiceStory={saveVoiceToStory} onSaveVoiceAudio={saveVoiceToAudio} />
                <FolderContinue onClick={() => void openFolder("body_location", { source: "next_step" })} label="Save and continue to Body/Location Signal" />
              </div>
            )}
            {session.activeFolder === "body_location" && (
              <div ref={bodyRef}>
                <BodyMapSignalCard session={session} onAdd={addBodyObservation} onRemove={removeBodyObservation} />
                <FolderContinue onClick={() => void openFolder("audio", { source: "next_step" })} label="Save and continue to Audio Signal" />
              </div>
            )}
            {session.activeFolder === "audio" && (
              <div ref={audioRef}>
                <AudioSignalCard session={session} onAdd={addAudioSignal} onRemove={removeAudioSignal} capture={voiceCapture} voiceOpen={voicePanelTarget === "audio"} onOpenVoice={() => openVoicePanel("audio")} onCloseVoice={closeVoicePanel} onSaveVoiceStory={saveVoiceToStory} onSaveVoiceAudio={saveVoiceToAudio} />
                <FolderContinue onClick={() => void openFolder("motion_visual", { source: "next_step" })} label="Continue to Motion/Visual Signal" />
              </div>
            )}
            {session.activeFolder === "motion_visual" && <div ref={motionRef}><MotionVisualSignalFolder
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
            /></div>}
          </section>}

          <div ref={reviewBoardRef} className="scroll-mt-24" data-workspace-target="review_board">
          <ReviewBoard
            session={session}
            onApprove={approveStructuredSummary}
            onEdit={() => void openFolder("story", { source: "manual_card" })}
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
          </div>

          <PacketReadinessCard session={session} onPrepare={requestPreparePacket} onNavigate={(folder) => void openFolder(folder, { source: "manual_card" })} />

          <div ref={packetRef} className="scroll-mt-24" data-workspace-target="packet">
            <EvidencePacketPreview packet={session.packetDraft} readiness={getPacketReadinessDecision(session)} headingRef={packetHeadingRef} runtimePhotos={ephemeralPhotos.attachments(new Set(session.packetDraft?.photoObservations.filter((photo) => photo.includeInPacket).map((photo) => photo.id) ?? []))} />
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
