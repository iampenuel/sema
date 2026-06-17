"use client";

import type { AgentMessage } from "@/lib/agent/agentTypes";

export function AgentMessageList({ messages }: { messages: AgentMessage[] }) {
  return (
    <div className="space-y-3" aria-live="polite">
      {messages.map((message) => (
        <div
          key={message.id}
          className={`rounded-lg px-3 py-2 text-sm leading-6 ${
            message.role === "agent" ? "bg-white text-ink" : "bg-ink text-white"
          }`}
        >
          {message.content}
        </div>
      ))}
    </div>
  );
}
