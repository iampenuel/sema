# Known limitations

- Sema is a research and educational prototype, not a clinically validated product or medical device.
- It does not diagnose, treat, prescribe, triage, determine seriousness, or provide emergency guidance.
- The public demo has no user accounts, EHR integration, or longitudinal clinical backend.
- Saved browser state is device- and browser-specific and should not be treated as a durable clinical record.
- Live voice sessions are bounded and strict half-duplex. Barge-in is not supported; the user must wait or stop Sema's playback.
- Live voice depends on browser audio, network conditions, and a provider preview API. Retry and typed fallback reduce disruption but do not guarantee availability.
- Sema does not claim provider session resumption or uninterrupted continuity across page reloads, devices, or expired Live sessions.
- Automated image screening can make mistakes, including rejecting benign images. Photo capture fails closed when screening is unavailable.
- Photos remain current-tab-only, are not retained after reload, and are never medically analyzed by Sema.
- Model output can be incomplete or incorrect. Review Board approval and deterministic safety checks reduce risk but do not replace clinician review.
