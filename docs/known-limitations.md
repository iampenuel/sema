# Known limitations

- Sema is not a diagnosis, triage, treatment, or emergency tool.
- Azure photo screening can make mistakes and may reject benign photos.
- Photo capture is disabled when Azure moderation is unavailable.
- Photos are not retained after reload; only metadata and user-authored notes remain.
- Sema does not medically analyze photos.
- Gemini Live voice uses a preview API. Medium thinking affects response reasoning depth, not browser playback reliability.
- Strict `NO_INTERRUPTION` and client-side PCM gating prevent barge-in by design; users must wait until Sema finishes or press Stop Sema.
- Gemini Live voice can still fail because browser audio playback and network sessions are fragile; Sema now exposes retry/text fallback but does not claim perfect voice reliability.
- No public deployment is approved until real-device voice and Azure camera QA pass.
