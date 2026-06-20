import type { AgentAIInput, AgentAIProposal, PacketAIDraft, PacketAIInput, SemaAIProvider, SemaAIResult, StoryExtractionDraft, StoryExtractionInput } from "../aiTypes";

export class Gemma4Provider implements SemaAIProvider {
  id = "gemma4" as const;

  private unavailable<T>(): SemaAIResult<T> {
    return {
      ok: false,
      error: { code: "provider_not_configured", message: "Gemma 4 is not configured in this phase." },
      metadata: { provider: "gemma4", model: process.env.GEMMA4_MODEL || "unconfigured", fallbackUsed: false }
    };
  }

  async extractStory(input: StoryExtractionInput): Promise<SemaAIResult<StoryExtractionDraft>> { void input; return this.unavailable(); }
  async proposeAgentResponse(input: AgentAIInput): Promise<SemaAIResult<AgentAIProposal>> { void input; return this.unavailable(); }
  async draftPacketContent(input: PacketAIInput): Promise<SemaAIResult<PacketAIDraft>> { void input; return this.unavailable(); }
}
