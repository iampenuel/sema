# Final architecture

Sema is a browser-centered Next.js application for organizing patient-provided observations into a reviewable evidence packet. The system separates capture, model-assisted organization, user approval, packet preparation, and export so provider output never becomes saved evidence automatically.

## Application and session state

The React workspace owns the active session, evidence-folder state, Review Board, packet readiness, pending permissions, temporary media, and PDF preview. Approved text and metadata can be saved in browser storage. Raw audio, camera pixels, approved photo blobs, Live transcript, and voice diagnostics remain ephemeral.

The session reducer and selectors enforce folder resolution, concern-dependent requirements, packet staleness, and export readiness. Changes to approved evidence invalidate an older packet until the user prepares it again.

## Structured AI and review

Server routes call Gemini for bounded story extraction, agent proposals, and packet drafting. Responses are schema-validated and checked against deterministic safety and provenance rules. Local deterministic behavior keeps the workspace usable when provider-backed generation is unavailable.

Generated content enters the Review Board as `needs_review`. The user can approve, edit, regenerate, or remove it. Only approved content is eligible for packet preparation.

## Agent actions and permissions

Typed and Live interactions share a canonical action registry. Model output proposes an action; it does not mutate session state directly. Deterministic safety rules reject medical diagnosis, treatment, medication, seriousness, triage, and unsafe photo-interpretation requests before execution.

Navigation and read-only actions can execute within their declared scope. Writes and high-impact actions pass through a visible permission gate. Idempotency controls ensure one approved proposal produces at most one intended mutation.

## Live voice reliability

Gemini Live connects from the browser using a short-lived credential minted by a same-origin server route, leaving the permanent provider key server-side. Incoming frames are normalized and processed in order. Audio, transcripts, function calls, completion metadata, and interruption state are handled separately.

Sema uses strict half-duplex audio. Microphone PCM is forwarded only during the authoritative Listening state and is dropped while Sema is processing, speaking, recovering, cooling down, muted, or awaiting permission. Output-turn, connection, and cooldown generations reject stale events. Playback uses ordered PCM scheduling, bounded recovery, and cleanup of sources, timers, listeners, streams, and audio contexts.

The Live API remains provider preview technology. These controls reduce duplicate speech, echo loops, stale state, and repeated tool execution without claiming perfect real-time reliability.

## Optional photo boundary

Photo capture begins only after disclosure and browser camera permission. The browser does not upload preview frames. Capture freezes one unmirrored frame, sanitizes and re-encodes it, and sends one temporary image through a same-origin moderation route to Azure AI Content Safety.

Only an allowed result proceeds to user review. Other outcomes fail closed and destroy the rejected image. Approval and packet inclusion are separate choices, with packet inclusion off by default. Approved raw photos remain in current-tab memory and are resolved separately for browser-generated PDF export.

## Packet and PDF

Packet readiness is deterministic and concern-aware. Required or unresolved folders block preparation, pending Review Board content blocks finalization, and stale packets cannot be exported. PDF generation runs in the browser and includes only approved packet content and currently available, explicitly opted-in photos with non-clinical labels.

## Trust boundary

The browser owns interaction state and ephemeral media. Same-origin server routes protect provider credentials and perform bounded provider calls. Gemini and Azure are treated as feature-specific processors, not clinical authorities. Sema has no account system, clinical record backend, EHR integration, or autonomous medical decision layer.
