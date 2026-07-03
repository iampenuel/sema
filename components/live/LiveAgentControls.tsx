"use client";

import { Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, RotateCw, Trash2 } from "lucide-react";
import type { SemaLiveController } from "@/hooks/useSemaLiveSession";
import { AgentPermissionPrompt } from "@/components/agent/AgentPermissionPrompt";

const activeStates = new Set(["player_preparing", "requesting_microphone", "token_requesting", "socket_connecting", "setup_sending", "setup_waiting", "intro_requesting", "intro_waiting_for_audio", "intro_playing", "intro_drained", "ready_without_microphone", "completed_one_turn", "requesting_token", "connecting", "connected", "listening", "thinking", "speaking", "interrupted", "awaiting_confirmation", "action_running", "reconnecting", "ending"]);

export function LiveAgentControls({ live }: { live: SemaLiveController }) {
  const { state, publicStatus, voicePresentation } = live;
  if (!publicStatus?.uiEnabled) return null;
  const active = activeStates.has(state.status);
  const showDiagnostics = active || state.status === "error" || state.status === "unavailable" || state.status === "rate_limited";

  return (
    <section className="mt-3 rounded-md border border-[#bdd5e5] bg-[#f8fbfd] p-3" aria-label="Sema Live voice">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-xs font-bold text-sema-blue">
          <span className={`h-2 w-2 rounded-full ${active ? "animate-pulse bg-sema-green" : "bg-sema-blue"}`} aria-hidden="true" /> LIVE VOICE
        </p>
        {active ? <span className="rounded-full bg-[#e7f5ef] px-2 py-1 text-[10px] font-bold text-sema-green">{voicePresentation.badgeLabel}</span> : null}
      </div>

      {state.status === "idle" || state.status === "ended" ? (
        <div className="mt-2">
          <p className="text-xs leading-5 text-sema-slate">Start Sema’s deployed Live voice. This preview plays the introduction once, then supports a controlled multi-turn conversation until you end it.</p>
          <button type="button" onClick={live.requestStart} disabled={!publicStatus.available} className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-md bg-sema-blue px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9bb7ca]">
            <Mic className="h-4 w-4" aria-hidden="true" /> Start Live Sema
          </button>
          {!publicStatus.available ? <p className="mt-2 text-[11px] leading-4 text-sema-slate">{publicStatus.reason} Continue with text below.</p> : null}
        </div>
      ) : null}

      {state.status === "consent_required" ? (
        <div className="mt-2 rounded-md border border-sema-border bg-white p-3">
          <p className="text-xs font-semibold text-ink">Before Sema voice starts</p>
          <p className="mt-1 text-[11px] leading-4 text-sema-slate">This check connects to Google Gemini Live, plays Sema’s short introduction once, then uses your microphone only during visible Listening turns. Microphone audio is used only for this active Live session, is not stored, is not added to the evidence packet, and is not the same as an Audio Signal Folder recording.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={live.acceptConsent} className="min-h-9 rounded-md bg-sema-blue px-2 text-xs font-semibold text-white">Start Live Sema</button>
            <button type="button" onClick={live.declineConsent} className="min-h-9 rounded-md border border-sema-border bg-white px-2 text-xs font-semibold text-ink">Continue by text</button>
          </div>
        </div>
      ) : null}

      {active ? (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" onClick={() => live.setMicrophoneMuted(!state.microphoneMuted)} className="flex h-9 w-9 items-center justify-center rounded-md border border-sema-border bg-white text-sema-blue" aria-label={state.microphoneMuted ? "Unmute microphone" : "Mute microphone"} title={state.microphoneMuted ? "Unmute microphone" : "Mute microphone"}>
            {state.microphoneMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <button type="button" onClick={() => live.setSpeakerMuted(!state.speakerMuted)} className="flex h-9 w-9 items-center justify-center rounded-md border border-sema-border bg-white text-sema-blue" aria-label={state.speakerMuted ? "Unmute speaker" : "Mute speaker"} title={state.speakerMuted ? "Unmute speaker" : "Mute speaker"}>
            {state.speakerMuted ? <HeadphoneOff className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
          </button>
          <button type="button" onClick={live.end} className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-md border border-[#d9b7b7] bg-white px-2.5 text-xs font-semibold text-[#8b3e3e]">
            <PhoneOff className="h-4 w-4" aria-hidden="true" /> End
          </button>
        </div>
      ) : null}
      {active ? <p className="mt-2 text-[10px] font-semibold leading-4 text-sema-blue" aria-live="polite">{voicePresentation.detailLabel}</p> : null}
      {showDiagnostics ? (
        <button type="button" onClick={live.copyDiagnostics} className="mt-2 min-h-8 rounded-md border border-sema-border bg-white px-2 text-[11px] font-semibold text-sema-blue">
          Copy voice diagnostics
        </button>
      ) : null}

      {state.voiceNotice ? (
        <div className="mt-3 rounded-md border border-[#ead5bd] bg-[#fffaf2] p-2.5 text-[11px] leading-4 text-sema-slate" aria-live="polite">
          <p>{state.voiceNotice}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {live.canRetryVoiceOutput ? (
              <button type="button" onClick={live.retryVoiceOutput} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-sema-blue bg-white px-2 text-xs font-semibold text-sema-blue"><RotateCw className="h-3 w-3" /> Retry voice</button>
            ) : (
              <button type="button" onClick={live.reconnectVoice} className="inline-flex min-h-8 items-center gap-1 rounded-md border border-sema-blue bg-white px-2 text-xs font-semibold text-sema-blue"><RotateCw className="h-3 w-3" /> Reconnect voice</button>
            )}
            <button type="button" onClick={live.continueWithText} className="min-h-8 rounded-md border border-sema-border bg-white px-2 text-xs font-semibold text-ink">Continue with text</button>
          </div>
        </div>
      ) : null}

      {state.pendingAction && live.permissionDecision ? (
        <div className="mt-3">
          <AgentPermissionPrompt action={state.pendingAction.action} decision={live.permissionDecision} onConfirm={live.confirmPending} onCancel={live.denyPending} />
          <p className="mt-1 text-[10px] text-sema-slate">Spoken agreement does not approve this action. Use a button above.</p>
        </div>
      ) : null}

      {state.error ? (
        <div className="mt-2 rounded-md border border-[#ead5bd] bg-[#fffaf2] p-2.5 text-[11px] leading-4 text-sema-slate">
          <p>Live voice is unavailable right now. Sema&apos;s text and local session tools are still available.</p>
          <p className="mt-1">{state.error.message}</p>
          {state.reconnectAttempts < 1 && !["consent_declined", "disabled", "microphone_denied"].includes(state.error.code) ? (
            <button type="button" onClick={live.retry} className="mt-2 inline-flex items-center gap-1 font-semibold text-sema-blue"><RotateCw className="h-3 w-3" /> Try once more</button>
          ) : null}
        </div>
      ) : null}

      {state.transcript.length ? (
        <div className="mt-3 border-t border-sema-border pt-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold text-sema-blue">LIVE TRANSCRIPT</p>
            <button type="button" onClick={live.clearTranscript} className="flex h-7 w-7 items-center justify-center text-sema-slate" aria-label="Clear Live transcript" title="Clear transcript"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
          <div className="mt-1 max-h-28 space-y-1 overflow-y-auto" aria-live="polite">
            {state.transcript.map((line) => <p key={line.id} className="text-[11px] leading-4 text-sema-slate"><span className="font-semibold text-ink">{line.role === "user" ? "You" : line.role === "sema" ? "Sema" : "Notice"}:</span> {line.text}</p>)}
          </div>
          <p className="mt-2 text-[10px] leading-4 text-sema-slate">Live transcript may contain mistakes. Review any information before saving it to your Sema session. It stays in memory and clears when this page closes.</p>
        </div>
      ) : null}
    </section>
  );
}
