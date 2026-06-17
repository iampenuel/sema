"use client";

import { FileText, Sparkles } from "lucide-react";
import { SafetyBanner } from "@/components/layout/SafetyBanner";
import { StructuredSummaryCard } from "./StructuredSummaryCard";
import type { SemaSession, StructuredSummary } from "@/lib/sema-session/types";

export function StorySignalCard({
  session,
  onStoryChange,
  onGenerateSummary,
  onLoadDemo,
  onSummaryChange
}: {
  session: SemaSession;
  onStoryChange: (text: string) => void;
  onGenerateSummary: () => void;
  onLoadDemo: () => void;
  onSummaryChange: (summary: StructuredSummary) => void;
}) {
  return (
    <section className="card rounded-lg p-5" aria-labelledby="story-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.16em] text-sage">
            <FileText className="h-4 w-4" aria-hidden="true" />
            Story signal
          </p>
          <h2 id="story-title" className="mt-2 text-2xl font-bold text-ink">What happened?</h2>
          <p className="mt-1 text-sm text-muted">Patient-stated words stay separate from the AI-organized summary.</p>
        </div>
        <button type="button" onClick={onLoadDemo} className="rounded-lg border border-ink/10 bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-sage/40">
          Load demo story
        </button>
      </div>
      <div className="mt-5">
        <label htmlFor="story" className="text-sm font-semibold text-ink">Patient&apos;s own words</label>
        <textarea
          id="story"
          value={session.story.rawText}
          onChange={(event) => onStoryChange(event.target.value)}
          className="mt-2 min-h-44 w-full rounded-lg border border-ink/10 bg-white px-4 py-3 text-sm leading-6 text-ink"
          placeholder="Start by writing what happened in your own words. Sema can organize it, but it will not diagnose or decide urgency."
        />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onGenerateSummary} className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-ink/90" disabled={!session.story.rawText.trim()}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          Generate structured summary
        </button>
      </div>
      <div className="mt-5">
        <StructuredSummaryCard summary={session.story.structuredSummary} onChange={onSummaryChange} />
      </div>
      <div className="mt-5">
        <SafetyBanner compact />
      </div>
    </section>
  );
}
