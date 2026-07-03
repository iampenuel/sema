# Architecture final

Sema keeps durable session state limited to patient-approved text metadata. Raw audio, raw photos, camera pixels, Live transcript, and playback diagnostics are page-memory only.

Photo flow:

1. Motion/Visual opens optional capture.
2. Azure disclosure appears before browser camera permission.
3. User checks the disclosure and chooses Continue to camera.
4. Browser opens video-only camera. Front/unknown cameras are mirrored in CSS preview only.
5. Capture freezes one unmirrored frame.
6. Browser sanitizes to JPEG.
7. Server validates and calls Azure AI Content Safety Sexual analysis.
8. Allowed image moves to review; every other result is rejected.
9. User may add note/tags/body location and explicitly approve.
10. Packet inclusion defaults off.

Voice flow:

Gemini Live remains the real-time voice provider using `gemini-3.1-flash-live-preview`, Kore voice, AUDIO response modality, output/input transcription, `medium` thinking, automatic VAD, `NO_INTERRUPTION`, low start/end sensitivity, 200 ms prefix padding, 650 ms silence duration, and turn coverage limited to detected activity. A single session-config builder is used for initial connection, retry, rollover, and token-constrained sessions.

Server events are normalized before they reach the UI. Sema iterates every `modelTurn.parts` item in order and separately collects valid PCM audio parts, text parts, transcripts, function calls, completion metadata, and interruption metadata. Image/video parts are not processed. Per-response deduplication prevents replaying audio chunks, duplicate transcript fragments, or repeated tool calls.

The browser enforces non-interruptible voice locally as well as through Gemini configuration. Microphone PCM is forwarded only while listening or while the user is actively speaking; PCM is dropped while Sema is thinking, buffering, speaking, draining, recovering, cooling down, muted, degraded, or errored. Speech during playback is not queued for later. Stop Sema is the manual local stop control: it stops playback, clears queued audio, preserves visible transcript text, enters the 400 ms post-playback cooldown, and then resumes listening without regenerating the response or rerunning tools.

The client tracks output playback with epochs, queue depth, AudioContext state, and a bounded recovery attempt. If browser playback fails after audio exists, Sema rebuilds or resumes the player and replays buffered PCM once without asking Gemini to regenerate. If transcript arrives without audio, Sema waits for the bounded first-audio deadline and may enter recovery/degraded text mode. The Live API is still preview technology, so this design improves reliability but does not claim perfect voice behavior.
