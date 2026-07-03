# Sema project starter

Sema is a demo patient-facing workspace for organizing patient-provided story, body/location, audio, motion/visual notes, and optional photos into a clinician-ready evidence packet. It is not a diagnosis, triage, treatment, or medical image interpretation tool.

## Current local MVP behavior

- Gemini text and Gemini Live voice remain available when configured.
- Gemini Live uses `gemini-3.1-flash-live-preview`, Kore voice, and `medium` thinking when configured.
- Live voice processes every supported part in each Gemini server event, uses strict no-barge-in voice behavior, tracks playback state, retries one buffered player recovery, and exposes a text fallback when audio cannot play.
- Camera capture is optional and never starts automatically.
- Sema does not upload preview frames and does not run continuous camera inspection.
- After the user captures one frame, the browser sanitizes it to JPEG and sends one temporary copy to Sema’s same-origin `/api/moderation/photo` route.
- The server calls Microsoft Azure AI Content Safety for Sexual-category moderation only.
- Allowed photos move to user review; uncertain, blocked, unavailable, malformed, timeout, or network results fail closed.
- No photo goes to Gemini Live, Gemini text prompts, diagnostics, localStorage, IndexedDB, or packet AI inputs.
- Approved raw photos remain in current-tab memory only. Reloading the page removes the original image and leaves metadata/note text only.

## Environment

- `GEMINI_API_KEY`: optional for Gemini text/Live features.
- `SEMA_LIVE_MODEL=gemini-3.1-flash-live-preview`: Gemini Live preview model.
- `SEMA_LIVE_VOICE_NAME=Kore`: Live voice.
- `SEMA_LIVE_THINKING_LEVEL=medium`: Live reasoning depth; this does not guarantee browser audio playback.
- `SEMA_LIVE_MAX_SESSION_MINUTES=10`: Live session rollover cap.
- `SEMA_ENABLE_AZURE_PHOTO_MODERATION=true`: enables Azure photo moderation.
- `AZURE_CONTENT_SAFETY_ENDPOINT`: server-only Azure Content Safety endpoint.
- `AZURE_CONTENT_SAFETY_KEY`: server-only Azure Content Safety key.
- `SEMA_AZURE_SEXUAL_ALLOW_MAX=0`: optional severity policy override.
- `SEMA_AZURE_SEXUAL_UNCERTAIN_MAX=2`: optional severity policy override.

If Azure moderation is not configured, photo capture is disabled by default and users can continue with text, body map, audio metadata, and motion notes.

## Verification

```bash
npm run verify
npm run test:azure-photo:live # opt-in; skips unless Azure env is configured
```

`npm run verify` is intentionally offline and does not call Azure or Gemini live providers.
