# Sema Project Starter Folder

This folder contains the planning and implementation context for building **Sema**, a multimodal patient-generated evidence reporter.

Sema helps users capture health-related observations before care begins and package them into a structured evidence packet. Sema is **not** a diagnostic, treatment, or triage tool.

## Recommended first step

Open `prompts/codex-phase-1-session-prompt.md` and paste it into your first Codex session.

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

## Core build direction

Build Sema as:

- `/` intro/landing page.
- `/session` main guided workspace.
- Left Sema agent/session rail.
- Main workspace with progressive evidence-capture cards.
- Story, body map, audio, packet preview, and page-aware text agent.
- No live voice in Phase 1.
- No auth, database, EHR integration, real patient storage, diagnosis, treatment, triage, or medical-device claims.
