import { validateModelSafety } from "@/lib/ai/validators/validateModelSafety";
import { SAFE_REDIRECT } from "@/lib/safety/safetyCopy";
import { detectUnsafeRequest } from "@/lib/safety/safetyRules";

export const LIVE_SAFE_REDIRECT = SAFE_REDIRECT;

export function screenLiveInput(text: string) {
  const flags = detectUnsafeRequest(text);
  return { safe: flags.length === 0, flags, redirect: flags.length ? LIVE_SAFE_REDIRECT : undefined };
}

export function screenLiveOutput(text: string) {
  const base = validateModelSafety(text);
  const crossesBoundary = /\b(you should|i recommend|go to (the )?(er|emergency room)|do not seek care|wait before seeking care|this proves|your recording (shows|means))\b/i.test(text);
  return { safe: base.safe && !crossesBoundary, redirect: base.safe && !crossesBoundary ? undefined : LIVE_SAFE_REDIRECT };
}
