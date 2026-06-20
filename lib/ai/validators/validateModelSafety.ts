import { SAFE_REDIRECT } from "@/lib/safety/safetyCopy";

const unsafeOutput = [
  /\byou (have|likely have|probably have)\b/i,
  /\b(take|start|stop) (a |an |the )?(medication|medicine|antibiotic|dose)\b/i,
  /\byou (are|aren't) safe\b/i,
  /\b(wait|delay) (before|to|until) (seeking|get|going)\b/i,
  /\bthis (is|sounds like) (an? )?(emergency|disease|condition)\b/i
];

export function validateModelSafety(text: string) {
  const safe = !unsafeOutput.some((pattern) => pattern.test(text));
  return { safe, redirect: safe ? undefined : SAFE_REDIRECT };
}
