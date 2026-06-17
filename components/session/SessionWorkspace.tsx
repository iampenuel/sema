"use client";

import { useRef, useState } from "react";
import { Camera, ChevronDown } from "lucide-react";
import { SemaAgentPanel } from "@/components/agent/SemaAgentPanel";
import { AudioSignalCard } from "@/components/audio/AudioSignalCard";
import { BodyMapSignalCard } from "@/components/body-map/BodyMapSignalCard";
import { EvidencePacketPreview } from "@/components/packet/EvidencePacketPreview";
import { PacketReadinessCard } from "@/components/packet/PacketReadinessCard";
import { StorySignalCard } from "@/components/story/StorySignalCard";
import { useAgentActions } from "@/hooks/useAgentActions";
import { useSemaSession } from "@/hooks/useSemaSession";
import { SafetyBanner } from "@/components/layout/SafetyBanner";
import { ConcernTypeSelector } from "./ConcernTypeSelector";
import { SessionProgress } from "./SessionProgress";

export function SessionWorkspace() {
  const {
    session,
    dispatch,
    setConcernType,
    updateStory,
    generateSummary,
    updateStructuredSummary,
    addBodyObservation,
    removeBodyObservation,
    addAudioSignal,
    removeAudioSignal,
    preparePacket,
    loadDemo
  } = useSemaSession();
  const [agentOpen, setAgentOpen] = useState(false);
  const storyRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLDivElement | null>(null);
  const packetRef = useRef<HTMLDivElement | null>(null);
  const agentActions = useAgentActions({
    dispatch,
    storyRef,
    bodyRef,
    audioRef,
    packetRef,
    getSession: () => session
  });

  return (
    <main className="mx-auto grid max-w-7xl gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[340px_1fr] lg:px-8">
      <div className="no-print space-y-4 lg:sticky lg:top-20 lg:self-start">
        <div className="rounded-lg border border-ink/10 bg-white/80 p-4 shadow-soft">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sage">Sema session</p>
          <h1 className="mt-2 text-3xl font-bold text-ink">Evidence capture workspace</h1>
          <p className="mt-2 text-sm leading-6 text-muted">A calm workspace for preserving the patient story, location notes, optional audio observations, and packet preview.</p>
        </div>
        <SessionProgress session={session} />
        <div className="hidden lg:block">
          <SemaAgentPanel session={session} onExecuteAction={agentActions.execute} />
        </div>
      </div>

      <div className="space-y-5">
        <SafetyBanner />
        <ConcernTypeSelector value={session.concernType} onChange={setConcernType} />

        <div ref={storyRef}>
          <StorySignalCard
            session={session}
            onStoryChange={updateStory}
            onGenerateSummary={generateSummary}
            onLoadDemo={loadDemo}
            onSummaryChange={updateStructuredSummary}
          />
        </div>

        <div ref={bodyRef}>
          <BodyMapSignalCard session={session} onAdd={addBodyObservation} onRemove={removeBodyObservation} />
        </div>

        <div ref={audioRef}>
          <AudioSignalCard session={session} onAdd={addAudioSignal} onRemove={removeAudioSignal} />
        </div>

        <MotionPlaceholder />

        <PacketReadinessCard session={session} onPrepare={preparePacket} />

        <div ref={packetRef}>
          <EvidencePacketPreview packet={session.packetDraft} />
        </div>

        <div className="no-print lg:hidden">
          <button
            type="button"
            onClick={() => setAgentOpen((open) => !open)}
            className="flex w-full items-center justify-between rounded-lg border border-ink/10 bg-white px-4 py-3 text-left font-semibold text-ink shadow-soft"
            aria-expanded={agentOpen}
          >
            Sema agent
            <ChevronDown className={`h-5 w-5 transition ${agentOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {agentOpen ? (
            <div className="mt-3">
              <SemaAgentPanel session={session} onExecuteAction={agentActions.execute} />
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function MotionPlaceholder() {
  return (
    <section className="card rounded-lg p-5" aria-labelledby="motion-title">
      <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-sage">
        <Camera className="h-4 w-4" aria-hidden="true" />
        Motion/visual signal later
      </p>
      <h2 id="motion-title" className="mt-2 text-2xl font-bold text-ink">Future movement observation card</h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        Phase 1 does not use camera tracking, heat sensing, X-ray-like claims, diagnostic overlays, or Grad-CAM-style visualization. A later version could help a user record motion observations or user-reported intensity notes with clear safety labels.
      </p>
    </section>
  );
}
