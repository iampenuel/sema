# Sema Project Starter Folder

This folder contains the planning and implementation context for building **Sema**, a multimodal patient-generated evidence reporter.

Sema helps users capture health-related observations before care begins and package them into a structured evidence packet. Sema is **not** a diagnostic, treatment, or triage tool.

## Current implementation

The repository now contains the Phase 1 workspace plus the stabilized Sema Live, permission-gated packet workflow, browser-local persistence, and direct packet-only PDF export. See `docs/project-status-2026-06-21.md` for the verified scope and current limitations. The files under `prompts/` and the numbered planning documents preserve the original build direction and may describe Live voice as a later phase.

## Folder contents

```txt
docs/
  00-master-context-from-idea-chat.txt
  01-mvp-feature-specification-v0.2.md
  02-technical-architecture-v0.1.md
  03-ui-route-component-map-v0.1.md
  04-agent-tool-permission-system-v0.1.md
  05-ux-decision-note-v0.1.md

prompts/
  codex-phase-1-session-prompt.md

references/
  layout-inspo-alethia-style.png
```

## Current product boundaries

Build Sema as:

- `/` intro/landing page.
- `/session` main guided workspace.
- Left Sema agent/session rail.
- Main workspace with progressive evidence-capture cards.
- Story, body/location, audio, packet preview, and page-aware text and Gemini Live agents.
- Browser-local session persistence with an explicit clear-session control; there is no account-based cloud clinical record.
- No authentication, EHR integration, diagnosis, treatment, triage, clinical-validation, HIPAA-compliance, or medical-device claims.
- No photo capture or intimate-content protection in this checkpoint.
