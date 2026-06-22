"use client";

import { AudioLines, Camera, Check, FolderOpen, MapPinned, MessageSquareText } from "lucide-react";
import type { SemaSession, SignalFolderId } from "@/lib/sema-session/types";

export type { SignalFolderId } from "@/lib/sema-session/types";

const folderDefinitions = [
  { id: "story" as const, icon: MessageSquareText, title: "Story Signal Folder", description: "Capture what happened in your own words." },
  { id: "body_location" as const, icon: MapPinned, title: "Body/Location Signal Folder", description: "Mark where you noticed a symptom or limitation." },
  { id: "audio" as const, icon: AudioLines, title: "Audio Signal Folder", description: "Record browser-local audio or add a manual observation." },
  { id: "motion_visual" as const, icon: Camera, title: "Motion/Visual Signal Folder", description: "Add notes or an optional privacy-checked, browser-local photo." }
];

export function SignalFolderGrid({ session, activeFolder, onOpen }: { session: SemaSession; activeFolder: SignalFolderId; onOpen: (folder: SignalFolderId) => void }) {
  const recommended: SignalFolderId = session.folderStatus.story !== "saved"
    ? "story"
    : session.folderStatus.body_location !== "saved"
      ? "body_location"
      : session.folderStatus.audio !== "saved"
        ? "audio"
        : "motion_visual";

  return (
    <section aria-labelledby="signal-folders-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold text-sema-blue">SIGNAL CASE FILE</p>
          <h2 id="signal-folders-title" className="mt-1 font-editorial text-3xl font-semibold text-ink">Build your evidence folders.</h2>
        </div>
        <p className="max-w-md text-sm leading-6 text-sema-slate">Open a folder, save what you noticed, and return here for the next step.</p>
      </div>

      <div className="mt-5 grid auto-rows-fr gap-4 md:grid-cols-2">
        {folderDefinitions.map((folder) => {
          const folderStatus = session.folderStatus[folder.id];
          const isSaved = folderStatus === "saved";
          const needsReview = folderStatus === "needs_review";
          const isActive = activeFolder === folder.id;
          const isRecommended = recommended === folder.id && !isSaved;
          const status = needsReview ? "Needs review" : isSaved ? "Saved" : folderStatus === "planned_later" ? "Planned later" : isRecommended ? "Next recommended" : folderStatus === "in_progress" ? "In progress" : "Empty";

          return (
            <article key={folder.id} className="relative h-full pt-4">
              <span className={`absolute left-0 top-0 h-5 w-32 rounded-t-md border border-b-0 ${isActive ? "border-sema-blue bg-[#bcdcf0]" : "border-[#b9d2e3] bg-[#d2e8f5]"}`} aria-hidden="true" />
              <button type="button" onClick={() => onOpen(folder.id)} aria-pressed={isActive} className={`group flex h-full min-h-[184px] w-full flex-col rounded-lg rounded-tl-none border bg-gradient-to-br from-[#e6f3fa] via-[#eef7fb] to-[#f8fbfd] p-5 text-left shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-sema-blue hover:shadow-soft ${isActive ? "border-sema-blue ring-2 ring-sema-blue/10" : isRecommended ? "border-sema-blue/60" : "border-[#b9d2e3]"}`}>
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-white/80 bg-white/70 text-sema-blue shadow-sm"><folder.icon className="h-5 w-5" aria-hidden="true" /></span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ${isSaved ? "bg-[#e8f4ef] text-sema-green" : needsReview ? "bg-[#fff5df] text-[#7b5a20]" : isRecommended ? "bg-sema-pale text-sema-blue-dark" : "bg-[#f1f5f8] text-sema-slate"}`}>
                    {isSaved && <Check className="h-3 w-3" aria-hidden="true" />}{status}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-bold text-ink">{folder.title}</h3>
                <p className="mt-1 min-h-10 text-sm leading-5 text-sema-slate">{folder.description}</p>
                <span className="mt-auto inline-flex min-h-10 items-center gap-2 pt-4 font-semibold text-sema-blue-dark transition group-hover:text-sema-blue"><FolderOpen className="h-4 w-4" aria-hidden="true" />{isActive ? "Folder open" : "Open folder"}</span>
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
