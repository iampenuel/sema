"use client";

import { Send } from "lucide-react";

export function AgentInput({ onSend, disabled = false }: { onSend: (message: string) => void | Promise<void>; disabled?: boolean }) {
  function handleSubmit(formData: FormData) {
    const message = String(formData.get("message") || "").trim();
    if (message) {
      onSend(message);
    }
  }

  return (
    <form action={handleSubmit} className="flex gap-2">
      <label htmlFor="agent-message" className="sr-only">Message Sema</label>
      <input
        id="agent-message"
        name="message"
        className="min-h-11 min-w-0 flex-1 rounded-md border border-sema-border bg-white px-3 py-2 text-sm text-ink shadow-sm placeholder:text-[#8294a4]"
        placeholder="Ask Sema..."
        disabled={disabled}
      />
      <button type="submit" disabled={disabled} aria-label="Send message" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-sema-blue text-white shadow-sm transition hover:bg-sema-blue-dark disabled:cursor-wait disabled:bg-muted">
        <Send className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}
