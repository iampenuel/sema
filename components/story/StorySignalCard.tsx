"use client";

import { FileText, Loader2, Sparkles, X } from "lucide-react";
import { AIFallbackNotice } from "@/components/ai/AIFallbackNotice";
import { AIErrorNotice } from "@/components/ai/AIErrorNotice";
import { SafetyBanner } from "@/components/layout/SafetyBanner";
import { StructuredSummaryCard } from "./StructuredSummaryCard";
import type { SemaSession, StructuredSummary } from "@/lib/sema-session/types";

export function StorySignalCard({
  session,
  onStoryChange,
  onSaveStory,
  onGenerateSummary,
  onLoadDemo,
  onSummaryChange,
  organizing = false,
  onCancelOrganizing,
  aiFallbackNotice,
  aiError
}: {
  session: SemaSession;
  onStoryChange: (text: string) => void;
  onSaveStory: () => void;
  onGenerateSummary: () => void | Promise<void>;
  onLoadDemo: () => void;
  onSummaryChange: (summary: StructuredSummary) => void;
  organizing?: boolean;
  onCancelOrganizing?: () => void;
  aiFallbackNotice?: string | null;
  aiError?: string | null;
}) {
  return (
    <section className="rounded-lg border border-sema-border bg-white p-5 shadow-card" aria-labelledby="story-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold text-sema-blue">
            <FileText className="h-4 w-4" aria-hidden="true" />
            Story signal
          </p>
          <h2 id="story-title" className="mt-2 text-2xl font-bold text-ink">What happened?</h2>
          <p className="mt-1 text-sm leading-6 text-sema-slate">Tell the story in your own words. Sema can organize it, but it will not diagnose or decide urgency.</p>
        </div>
        <button type="button" onClick={onLoadDemo} className="rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold text-sema-blue-dark hover:border-sema-blue/40">
          Load demo story
        </button>
      </div>
      <div className="mt-5">
        <label htmlFor="story" className="text-sm font-semibold text-ink">Patient&apos;s own words</label>
        <textarea
          id="story"
          value={session.story.rawText}
          onChange={(event) => onStoryChange(event.target.value)}
          className="mt-2 min-h-44 w-full rounded-md border border-sema-border bg-white px-4 py-3 text-sm leading-6 text-ink"
          placeholder="Start by writing what happened in your own words. Sema can organize it, but it will not diagnose or decide urgency."
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Story helper prompts">
        {["What happened?", "When did it start?", "What changed?", "What makes it better or worse?", "What are you worried about?", "What do you want to ask?"].map((prompt) => (
          <span key={prompt} className="rounded-full bg-sema-pale px-2.5 py-1 text-xs text-sema-blue-dark">{prompt}</span>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onSaveStory} disabled={!session.story.rawText.trim()} className="rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold text-sema-blue-dark disabled:cursor-not-allowed disabled:text-muted">Save story</button>
        <button type="button" onClick={onGenerateSummary} className="inline-flex items-center gap-2 rounded-md bg-sema-blue px-4 py-2 text-sm font-semibold text-white hover:bg-sema-blue-dark disabled:cursor-not-allowed disabled:bg-muted" disabled={!session.story.rawText.trim() || organizing}>
          {organizing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="h-4 w-4" aria-hidden="true" />}
          {organizing ? "Organizing..." : "Generate organized summary"}
        </button>
        {organizing && onCancelOrganizing ? <button type="button" onClick={onCancelOrganizing} className="inline-flex items-center gap-2 rounded-md border border-sema-border bg-white px-4 py-2 text-sm font-semibold text-sema-slate"><X className="h-4 w-4" aria-hidden="true" />Cancel</button> : null}
      </div>
      {organizing ? <p className="mt-3 text-xs font-medium text-sema-slate">Sema is organizing only the information you provided.</p> : null}
      {aiFallbackNotice ? <div className="mt-3"><AIFallbackNotice message={aiFallbackNotice} /></div> : null}
      {aiError ? <div className="mt-3"><AIErrorNotice message={aiError} /></div> : null}
      <div className="mt-5">
        <StructuredSummaryCard summary={session.story.structuredSummary} onChange={onSummaryChange} />
      </div>
      <div className="mt-5">
        <SafetyBanner compact />
      </div>
    </section>
  );
}
