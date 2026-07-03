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
    detail: "When Gemini features are configured and used, story text, agent messages with limited session context, and approved packet content may be sent to Google Gemini for processing. Photos are not sent to Gemini. Sema's diagnostic logs do not include story, packet, or prompt content."
  },
  {
    title: "Live voice",
    detail: "Live microphone audio is sent to Google Gemini for real-time processing only after you consent. Sema does not persist Live audio. Live transcript and voice-output diagnostics remain in page memory and are not automatically added to your saved session."
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
    title: "Optional photos and Azure screening",
    detail: "Photo capture begins only after you review the screening disclosure and grant browser camera permission. Sema does not upload live preview frames. After you select **Capture**, one sanitized temporary image is sent through Sema’s server to Microsoft Azure AI Content Safety to screen for potentially sensitive or private imagery.\n\nThe image leaves your device for processing by Microsoft. According to Microsoft’s documentation, Content Safety inputs are not stored during detection, are not used to train the service, and are processed in the selected Azure resource region. Automated screening can make mistakes.\n\nApproved photos remain in the current browser tab only. Approved metadata and notes you write may be stored locally, and photos you choose to include may appear in a browser-generated PDF. Sema does not medically analyze photos and does not provide user accounts, clinical records, or EHR integration."
  }
] as const;

export const SAFE_REDIRECT =
  "I cannot determine whether this is serious, diagnose, recommend treatment, classify audio as a disease, or medically interpret a photo. I can help organize what you noticed and prepare questions to discuss with a licensed clinician. If symptoms feel severe, urgent, rapidly worsening, or concerning to you, seek appropriate medical or emergency care.";
