# Verification

Sema's release verification combines deterministic automated evaluation with real-browser Production QA. These results demonstrate implementation reliability; they are not clinical-accuracy, medical-safety, or provider-availability guarantees.

## Automated checks

| Area | Result |
| --- | ---: |
| Gemini Live architecture and state | 309/309 |
| Voice capture and readiness | 52/52 |
| Structured AI, agent, packet, and safety | 84/84 |
| Photo capture, privacy, and moderation boundaries | 85/85 |
| Live write-tool process lifecycle | 25/25 |
| **Total** | **555/555** |

The suites use deterministic providers, synthetic content, fake media tracks, and bounded browser dependencies. Default verification does not require real Gemini or Azure content calls.

## Covered system behavior

- Page-aware Live voice state, half-duplex microphone gating, ordered playback, interruption cleanup, retry, and typed fallback.
- Canonical tool validation, visible write permissions, cancellation without mutation, idempotency, and safe refusal behavior.
- Evidence-folder navigation, responsive viewport behavior, Review Board approval, concern-aware packet readiness, packet staleness, and export gating.
- Browser recording metadata, current-tab photo lifecycle, rejected-image destruction, session serialization exclusions, and AI/Live photo isolation.
- Browser-generated PDF layout, metadata-only missing-photo behavior, storage migration, accessibility announcements, and responsive presentation.

## Quality gates

The release gate also requires:

- ESLint completion without errors.
- TypeScript type checking without errors.
- A successful optimized Next.js Production build.
- `git diff --check` with no whitespace errors.
- Current-tree and reachable-history scans for secrets, authenticated URLs, private media, browser-storage exports, generated PDFs, and local-machine artifacts.

## Manual Production QA

Real-browser QA covered desktop and mobile navigation, folder scrolling, packet-readiness and Review Board workflows, stale-packet regeneration, Live voice lifecycle, permission approval and cancellation, safe medical-boundary refusals, mute/background behavior, Azure-moderated ordinary-object camera capture, photo cleanup, PDF output, and accessibility states.

Production route health is verified separately without minting unnecessary Live credentials or making unnecessary Gemini or Azure content requests.
