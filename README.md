# JARVIS Reply Assistant

JARVIS Reply Assistant is a draft-first AI co-pilot for messenger conversations. It helps a person understand an incoming message, generate several tone-aware reply options, review the context used, and choose an editable draft.

> **Important:** JARVIS does not connect to or read personal WhatsApp chats. The WhatsApp-style conversation shown in the interface is a manual context workflow: paste the incoming message or relevant conversation text into the app, then review the generated draft yourself.

## Live versions

- GitHub Pages frontend: <https://jonathanolum415-lab.github.io/jarvis-reply-assistant/>
- Manus full-stack deployment: <https://jarvisreply-dvh8yfjn.manus.space>

## How it works

1. Paste an incoming message into the composer, or use browser voice input.
2. JARVIS combines the message with the visible multi-turn conversation, tracked context signals, and the selected response mode.
3. The backend sends that request to the managed LLM service through server-side credentials.
4. The interface displays three reply suggestions and an explanation of why they fit.
5. Choose **use as draft** to place a suggestion back in the editable composer. Sending remains the user's responsibility.

The app never sends a WhatsApp, Messenger, SMS, or other chat message automatically.

## Main features

### Draft-first reply assistance

The available response modes are Professional, Friendly, Funny, Short, Apologetic, Romantic, and JARVIS. Each mode produces three alternatives, while the context panel shows the conversation summary and tracked signals used for drafting.

### Voice input and live voice

- **Simulate voice** demonstrates the transcript-to-draft flow.
- **Live voice** uses the browser's Web Speech API where supported, commonly Chrome or Edge.
- Captured speech is converted into a draft request and the first generated reply can be read aloud with browser speech synthesis.
- Voice conversations can be paused or stopped. Nothing is sent automatically.

Microphone permission and browser support are controlled by the browser; the app does not upload or store a recording as a chat message.

### Source intelligence

The source panel accepts up to five public `http://` or `https://` URLs. The backend reads accessible HTML, text, or JSON, extracts short excerpts, and asks the managed LLM to create a concise brief with citation markers such as `[1]` and `[2]`.

Each result includes the source title, excerpt, availability status, and an **open source** link. Localhost and common private-network address ranges are rejected. Sources that require login, block automated requests, or return non-readable media may be unavailable.

### Media dock

The media dock runs in the browser and supports:

- Direct audio URLs: MP3, WAV, OGG, M4A, and AAC
- Direct video URLs: MP4, WebM, MOV, M4V, and OGV
- YouTube embeds
- Vimeo embeds

The browser loads the media from the supplied URL. Third-party autoplay, embedding, CORS, paywalls, and privacy settings can still prevent playback. Live voice commands containing a media URL can load it into the dock, and commands such as “pause media” pause native audio or video players.

### Installable PWA

The app includes a web manifest, standalone display mode, install icons, and a service worker for the interface shell. Live AI requests still require an internet connection. Supported browsers may show an install button; other browsers can use their normal **Add to Home Screen** or **Install** menu.

## Architecture

```text
Browser frontend
  ├─ index.html       Interface shell and accessible controls
  ├─ app.js           UI state, draft workflow, voice, source research, media, PWA install
  ├─ styles.css       Responsive dark command-center layout
  ├─ manifest.webmanifest / sw.js
  └─ icons/

Node.js server
  ├─ server.mjs       Static serving, CORS, API routes, source reader, LLM calls
  └─ dist/             Vite production output

Managed AI service
  └─ Server-only MANUS_API_URL and MANUS_API_KEY credentials
```

The GitHub Pages frontend routes its AI requests to the public Manus backend. When the app is served from the Manus deployment, the frontend uses same-origin API paths.

## API endpoints

### `GET /api/health`

Returns deployment health and whether managed AI credentials are configured.

```json
{
  "ok": true,
  "aiConfigured": true
}
```

### `POST /api/reply`

Generates three draft replies from the selected mode, incoming message, visible turns, and context signals. The response includes an explanation and provider status.

### `POST /api/research`

Accepts a JSON body containing `urls` and an optional `question`. It reads up to five safe public sources and returns a synthesized answer plus source excerpts and availability flags.

## Local development

Requirements:

- Node.js 22 or a compatible current Node.js release
- npm
- Managed AI runtime credentials for live AI responses

Install dependencies and start the development server:

```bash
npm ci
MANUS_API_URL="https://your-managed-ai-endpoint" \\
MANUS_API_KEY="your-server-only-key" \\
npm run dev
```

Open <http://localhost:3000>.

Build and run the production container locally:

```bash
npm ci
npm run build
NODE_ENV=production \\
MANUS_API_URL="https://your-managed-ai-endpoint" \\
MANUS_API_KEY="your-server-only-key" \\
npm start
```

The Dockerfile performs the equivalent production build with Node 22, serves the compiled `dist/` output, and listens on port `3000` unless `PORT` is supplied.

## Deployment notes

For the Manus deployment, keep `MANUS_API_URL` and `MANUS_API_KEY` configured as server-side runtime secrets. Never place the API key in `app.js`, HTML, or any other browser-delivered asset.

For GitHub Pages, the root-level frontend files are intentionally kept alongside the `public/` copies because GitHub Pages serves the repository root directly. The Pages frontend uses the Manus deployment as its API origin; GitHub Pages itself does not run the Node backend.

After changing the frontend or backend:

```bash
npm run build
git diff --check
git add .
git commit -m "Describe the change"
git push origin main
```

The public GitHub mirror should also be updated when the Pages frontend is intended to change.

## Privacy and safety boundaries

- Conversation text is only sent to the configured AI endpoint when the user requests a draft or research brief.
- The application is draft-first and has no automatic send capability.
- No official WhatsApp personal-chat integration is claimed or required.
- Source research is limited to public URLs supplied by the user.
- Media links are loaded by the browser and remain subject to the provider's policies.
- API credentials belong on the server and must not be committed to the repository.

## Project status

This is an early version focused on a polished, installable reply workspace. It demonstrates context-aware drafting, browser voice interaction, public-source research, and browser media playback without pretending to be a privileged messenger client.
