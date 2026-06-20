import type { AudioSignal, BodyMapObservation, ConcernType } from "@/lib/sema-session/types";

export const DEMO_CONCERN_TYPE: ConcernType = "pain_injury";

export const DEMO_STORY =
  "I fell during basketball practice yesterday and landed on my right hand. My wrist and the base of my thumb started hurting after practice. It feels stiff when I try to write or open a water bottle, and the pain seems worse when I bend the wrist backward. I am worried because I have class notes and practice this week. I want to ask whether I should get it checked and what details I should track.";

export const DEMO_BODY_OBSERVATION: BodyMapObservation = {
  id: "demo-body-right-wrist",
  regionLabel: "Right wrist / base of thumb",
  signalType: "pain",
  note: "Patient reported pain and stiffness after falling during basketball practice.",
  intensity: 6,
  source: "patient_stated"
};

export const DEMO_AUDIO_SIGNAL: AudioSignal = {
  id: "demo-audio-description",
  name: "Demo voice note placeholder",
  durationSeconds: 18,
  tags: ["voice note", "context noted"],
  notes: "Simulated note: patient describes wrist pain when moving the hand backward.",
  transcript: "Synthetic demo voice note about wrist discomfort with movement.",
  createdAt: new Date().toISOString(),
  source: "demo_simulated"
};
