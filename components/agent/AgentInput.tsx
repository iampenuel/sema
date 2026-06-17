"use client";

import { Send } from "lucide-react";

export function AgentInput({ onSend }: { onSend: (message: string) => void }) {
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
        className="min-w-0 flex-1 rounded-lg border border-ink/10 bg-white px-3 py-2 text-sm text-ink"
        placeholder="Ask Sema..."
      />
      <button type="submit" aria-label="Send message" className="rounded-lg bg-ink p-2 text-white hover:bg-ink/90">
        <Send className="h-4 w-4" aria-hidden="true" />
      </button>
    </form>
  );
}
