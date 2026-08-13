# Privacy and data flow

Sema is a research and educational prototype with explicit feature-level trust boundaries. This document describes implemented behavior; it is not a formal privacy policy, HIPAA claim, or clinical-data assurance.

## Browser state

The browser owns the active evidence session, Review Board, packet preview, pending permission proposals, and temporary media state. Approved text observations, metadata, notes, and packet choices may be stored locally so the session can survive a refresh.

Raw audio, camera pixels, Live transcript, voice diagnostics, and approved photo blobs are not written into the saved `SemaSession`. Clearing the session replaces saved browser content with an empty session.

## Gemini processing

When configured and explicitly used, bounded story text, agent messages with limited session context, and approved packet content may be sent through Sema's server routes to Google Gemini for organization. Provider responses are schema-validated and reviewed before they become packet content.

Gemini Live receives microphone audio only after Live consent and browser microphone permission. Live transcript and playback diagnostics remain in page memory and clear with the page. Photos are excluded from Gemini prompts, Live context, and diagnostics.

## Azure photo screening

Camera capture is optional and begins only after the user reviews the disclosure and grants browser permission. The browser requests video with audio disabled and does not upload live preview frames.

After Capture, one unmirrored frame is sanitized and sent through a same-origin server route to Microsoft Azure AI Content Safety for automated screening. The route validates the image and does not save the moderation copy to application storage. Rejected, uncertain, unavailable, and invalid results are discarded.

Allowed photos enter review but are not approved or packet-enabled automatically. Approved raw photos remain in current-tab memory. Saved session data contains only approved metadata and user-authored notes, tags, body location, and packet-inclusion choice.

## Packet and PDF

Only approved evidence enters the prepared packet. PDF generation runs in the browser. Runtime photo blobs are resolved separately and included only when they are still available and the user explicitly opted in; after reload, the packet presents a not-retained note instead of a photo.

## Product boundary

Sema has no user accounts, EHR integration, longitudinal clinical backend, or medical-image analysis. Third-party providers support narrow organization, voice, and content-safety functions and are not treated as clinical decision systems.
