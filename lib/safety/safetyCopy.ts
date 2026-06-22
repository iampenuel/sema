export const SEMAPHASE_SAFETY_NOTE =
  "Sema is not a diagnosis, treatment plan, or emergency guidance. It organizes patient-provided observations so they can be reviewed with a licensed clinician.";

export const PACKET_SAFETY_NOTE =
  "This packet is generated from patient-provided information. It is not a diagnosis, treatment plan, or emergency guidance. Review it with a licensed clinician.";

export const IMPORTANT_DISCLAIMERS_LABEL = "Important disclaimers";

// Keep the EvidencePacket.limitations field for compatibility. This copy is
// presented to users under the clearer "Important disclaimers" label.
export const PACKET_LIMITATIONS = [
  "Based only on information the user provided.",
  "Does not diagnose, treat, prescribe, or triage.",
  "Does not classify audio or identify diseases.",
  "Does not interpret body/location markers as clinical proof.",
  "Intended for clinical conversation support only."
];

export const DEMO_PRIVACY_COPY =
  "For this public demo, avoid entering real sensitive medical information. Sema shows how patient-generated observations can be organized; it does not provide medical advice.";

export const PRIVACY_DISCLOSURES = [
  {
    title: "Saved in this browser",
    detail: "Your session content is saved in this browser's local storage so it can remain available after a refresh. Clearing the session replaces that saved content with an empty session."
  },
  {
    title: "AI processing",
    detail: "When Gemini features are configured and used, story text, agent messages with limited session context, and approved packet content may be sent to Google Gemini for processing. Sema's diagnostic logs do not include that content."
  },
  {
    title: "Live voice",
    detail: "Live microphone audio is sent to Google Gemini for real-time processing only after you consent. Sema does not persist Live audio, and the Live transcript remains in page memory and is not automatically added to your saved session."
  },
  {
    title: "Browser recording and dictation",
    detail: "Browser-recorded audio remains ephemeral in the current page. Only reviewed metadata, notes, and transcript text are saved. Dictation may be processed by your browser, device, or its speech-service provider."
  },
  {
    title: "PDF downloads",
    detail: "Evidence packet PDFs are generated in your browser from the prepared packet and downloaded to your device. The rest of the webpage and Live transcript are not included."
  },
  {
    title: "Current phase boundaries",
    detail: "Photo capture and camera access start only after you choose Allow camera. Sampled preview frames are checked on this device and are not uploaded for the privacy check. The safeguard can make mistakes, so blocked and uncertain frames cannot be captured. Approved raw photos remain in current-tab memory only; approved metadata and user-authored notes may be stored locally, and opted-in photos may enter a PDF generated in your browser. Images are not sent to Gemini and Sema does not medically analyze them. Sema has no user accounts, account-based cloud clinical record, or EHR integration."
  }
] as const;

export const SAFE_REDIRECT =
  "I cannot determine whether this is serious, diagnose, recommend treatment, classify audio as a disease, or medically interpret a photo. I can help organize what you noticed and prepare questions to discuss with a licensed clinician. If symptoms feel severe, urgent, rapidly worsening, or concerning to you, seek appropriate medical or emergency care.";
