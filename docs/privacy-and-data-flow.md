# Privacy and data flow

## Photos

Camera capture is optional. Sema shows an Azure disclosure and requires an unchecked checkbox before calling `getUserMedia`. The browser requests video only, with audio disabled.

Sema does not upload preview frames. On Capture, the browser draws one unmirrored frame to canvas, re-encodes it as metadata-stripped JPEG, limits it to 1600 px long edge and 4 MB, then sends exactly one temporary image to `/api/moderation/photo`.

The server validates MIME, signature, dimensions, size, and consent, then calls Azure AI Content Safety with `categories: ["Sexual"]`. It does not write the file to disk, database, blob storage, logs, Gemini, packet AI prompts, Live context, localStorage, or IndexedDB.

Allowed photos enter user review only. Rejected or unavailable results are discarded. Approved raw photos stay in current-tab memory; saved session data contains only metadata and the user-authored note/tags/body location/packet inclusion.

## Voice

Gemini Live microphone audio is sent only after Live consent and browser microphone permission. Live transcript and output diagnostics remain page-memory only. Output diagnostics contain playback state and timing/count metadata, not PCM, prompts, model text, credentials, device identifiers, or user wording.

## Packets

Packet text and PDF export include approved patient-authored information. Runtime photo blobs are resolved separately at export time and omitted after reload with a not-retained note.
