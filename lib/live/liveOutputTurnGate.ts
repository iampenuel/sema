import { LIVE_POST_PLAYBACK_COOLDOWN_MS } from "./liveTurnState";

export type LiveOutputTurnGateSnapshot = {
  outputTurnId: number;
  serverTurnCompleteReceivedForOutputTurn: boolean;
  playerDrainedForOutputTurn: boolean;
  cooldownActive: boolean;
  cooldownStarted: boolean;
};

export class LiveOutputTurnGate {
  private outputTurnId = 0;
  private serverTurnCompleteReceivedForOutputTurn = false;
  private playerDrainedForOutputTurn = false;
  private cooldownStarted = false;

  startOutputTurn(outputTurnId: number) {
    if (outputTurnId <= this.outputTurnId) return;
    this.outputTurnId = outputTurnId;
    this.serverTurnCompleteReceivedForOutputTurn = false;
    this.playerDrainedForOutputTurn = false;
    this.cooldownStarted = false;
  }

  markServerTurnComplete(outputTurnId: number) {
    if (outputTurnId !== this.outputTurnId) return false;
    this.serverTurnCompleteReceivedForOutputTurn = true;
    return this.canStartCooldown();
  }

  markPlayerDrained(outputTurnId: number) {
    if (outputTurnId !== this.outputTurnId) return false;
    this.playerDrainedForOutputTurn = true;
    return this.canStartCooldown();
  }

  startCooldown(outputTurnId: number) {
    if (outputTurnId !== this.outputTurnId || !this.canStartCooldown()) return false;
    this.cooldownStarted = true;
    return true;
  }

  cancelCooldown() {
    this.cooldownStarted = false;
  }

  snapshot(): LiveOutputTurnGateSnapshot {
    return {
      outputTurnId: this.outputTurnId,
      serverTurnCompleteReceivedForOutputTurn: this.serverTurnCompleteReceivedForOutputTurn,
      playerDrainedForOutputTurn: this.playerDrainedForOutputTurn,
      cooldownActive: this.cooldownStarted,
      cooldownStarted: this.cooldownStarted
    };
  }

  private canStartCooldown() {
    return this.serverTurnCompleteReceivedForOutputTurn && this.playerDrainedForOutputTurn && !this.cooldownStarted;
  }
}

export function phase1CCooldownMs() {
  return LIVE_POST_PLAYBACK_COOLDOWN_MS;
}
