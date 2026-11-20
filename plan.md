# JARVIS Reply Assistant v0

## Product shape
A draft-first, JARVIS-style reply assistant for messenger conversations. The v0 is a browser prototype: it simulates voice input, demonstrates context-aware multi-turn reply drafting, and never sends messages automatically.

## Design direction
- **Movement:** cinematic command-center interface, closer to a calm spacecraft console than a generic chatbot.
- **Principles:** conversation first; clear draft ownership; restrained motion; visible context; one electric accent.
- **Palette:** graphite black surfaces, warm silver text, muted blue-gray panels, electric cyan for active intelligence states.
- **Layout:** a two-column workspace with message history and composer on the left, intelligence/context rail on the right.
- **Signature elements:** breathing orb, thin telemetry labels, context chips, approval gate.
- **Interaction:** every generated reply is editable and remains a draft until the user explicitly approves it.
- **Typography:** Space Grotesk for display and IBM Plex Mono for telemetry and system labels.
- **Brand essence:** a discreet communications co-pilot for people who want sharper replies without losing control.

## Implementation
- Plain HTML, CSS, and JavaScript served by Vite for a lightweight, portable prototype.
- Client-side state holds the current conversation, selected tone, generated suggestions, voice simulation phase, and context chips.
- `server.mjs` exposes `POST /api/reply`, validates the request, sends the conversation and context to the managed OpenAI-compatible LLM endpoint using server-only credentials, and returns three draft options plus an explanation.
- The browser calls the real API first and falls back to local demo suggestions only when the endpoint is unavailable; the approval gate remains client-side and no send action exists.
- `Dockerfile` installs from the lockfile, builds the Vite assets, prunes development dependencies, and starts the same server in production; `/api/health` is the deployment readiness path.
- Responsive layout collapses to a single column on narrow screens.
- `public/manus-routes.json` declares the root route.

## Project structure
- `index.html`: application shell and semantic UI regions.
- `styles.css`: design tokens, responsive layout, motion, and component states.
- `app.js`: state, seeded multi-turn conversation, simulated voice flow, draft generation, editing, copying, and approval behavior.
- `public/manus-routes.json`: route manifest.
- `app.config.ts`: project logo metadata.
