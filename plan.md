# JARVIS Reply Assistant v0

## Product shape
A JARVIS-style reply assistant for messenger conversations. The v0 is a browser prototype: it simulates voice input, demonstrates context-aware multi-turn replies, and never connects to messenger services.

## Design direction
- **Movement:** cinematic command-center interface, closer to a calm spacecraft console than a generic chatbot.
- **Principles:** conversation first; clear user control; restrained motion; visible context; one electric accent.
- **Palette:** graphite black surfaces, warm silver text, muted blue-gray panels, electric cyan for active intelligence states.
- **Layout:** a ChatGPT-style application shell with a left conversation-history sidebar, a focused central message workspace and composer, plus a compact JARVIS intelligence rail that keeps tone and context available without competing with the chat.
- **Signature elements:** breathing orb, thin telemetry labels, context chips, live response status.
- **Interaction:** every generated reply appears directly in the conversation for the user to review.
- **Typography:** Space Grotesk for display and IBM Plex Mono for telemetry and system labels.
- **Brand essence:** a discreet communications co-pilot for people who want sharper replies without losing control.

## Implementation
- Plain HTML, CSS, and JavaScript served by Vite for a lightweight, portable prototype.
- Client-side state holds the current conversation, selected tone, generated reply, voice simulation phase, and context chips.
- `server.mjs` exposes `POST /api/reply`, validates the request, sends the conversation and context to the managed OpenAI-compatible LLM endpoint using server-only credentials, and returns one reply plus an explanation.
- The browser calls the real API first and falls back to one local demo reply only when the endpoint is unavailable; the app has no messenger send action.
- `Dockerfile` installs from the lockfile, builds the Vite assets, prunes development dependencies, and starts the same server in production; `/api/health` is the deployment readiness path.
- GitHub Pages uses project-relative assets and calls the published Manus API through a hostname-specific base URL. The API accepts CORS only from the GitHub Pages origin and the Manus app origin.
- Responsive layout collapses the intelligence rail below the conversation and turns the history sidebar into a compact mobile header on narrow screens.
- `public/manus-routes.json` declares the root route.

## Project structure
- `index.html`: application shell and semantic UI regions.
- `styles.css`: design tokens, responsive layout, motion, and component states.
- `app.js`: state, seeded multi-turn conversation, simulated voice flow, direct reply generation, and conversation rendering.
- `public/manus-routes.json`: route manifest.
- `app.config.ts`: project logo metadata.
