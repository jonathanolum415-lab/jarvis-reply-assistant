# JARVIS Reply Assistant

JARVIS Reply Assistant is an AI co-pilot for messenger conversations. It helps a person understand an incoming message, generate one natural tone-aware reply, and review the context used.

> **Important:** JARVIS does not connect to or read personal WhatsApp chats. The WhatsApp-style conversation shown in the interface is a manual context workflow: paste the incoming message or relevant conversation text into the app, then review the generated reply yourself.

## Live versions

- GitHub Pages frontend: <https://jonathanolum415-lab.github.io/jarvis-reply-assistant/>
- Manus full-stack deployment: <https://jarvisreply-dvh8yfjn.manus.space>

## How it works

1. Paste an incoming message into the composer, or use browser voice input.
2. JARVIS combines the message with the visible multi-turn conversation, tracked context signals, and the selected response mode.
3. The backend sends that request to the managed LLM service through server-side credentials.
4. JARVIS displays one natural assistant reply and an explanation of why it fits.
5. The reply appears directly in the conversation, where it can be reviewed before the user decides what to do with it.

The app never sends a WhatsApp, Messenger, SMS, or other chat message automatically.

## Main features

### Conversation-first workspace

- Desktop keeps the conversation and bottom-pinned composer on the left, with response modes, reply explanation, and a review reminder in the right panel.
- Mobile changes to one column and places the reply settings sheet above the composer.
- The review reminder reinforces that JARVIS generates drafts only; the user decides what to send.

### Direct reply assistance

The available response modes are Professional, Friendly, Funny, Short, Apologetic, Romantic, and JARVIS. Each mode shapes one direct reply, using the recent conversation and tracked signals internally.

Press **Enter** in the incoming-message box to generate a reply. Press **Shift+Enter** to add a newline.

### Voice dictation

- Use the microphone button beside the incoming-message box to dictate text into the composer.
- Tap the microphone again to stop listening, then review or edit the recognized text before generating a reply.
- Dictation uses the browser's built-in SpeechRecognition API. The app does not record audio, upload audio files, or speak generated replies.
- Speech recognition is not supported by every browser or device. If the button is unavailable, use the microphone on your device's on-screen keyboard.

### Installable PWA

The app includes a web manifest, standalone display mode, install icons, and a service worker for the interface shell. The service worker pre-caches the complete app shell before activating a new cache revision, then checks JavaScript and styles against the live files. It keeps the cached shell for offline fallback and removes the previous revision only after the new files are ready. JARVIS reloads automatically after an update when the composer is empty, no reply is in progress, and the default tone is selected; otherwise, it asks you to reopen the app when ready. Live AI requests still require an internet connection. Supported browsers may show an install button; other browsers can use their normal **Add to Home Screen** or **Install** menu.

## Architecture

```text
Browser frontend
  ├─ index.html       Interface shell and accessible controls
  ├─ app.js           UI state, direct reply workflow, voice dictation, PWA install
  ├─ styles.css       Responsive dark command-center layout
  ├─ manifest.webmanifest / sw.js
  └─ icons/

Node.js server
  ├─ server.mjs       Static serving, CORS, API routes, and LLM calls
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

Generates one reply from the selected mode, incoming message, visible turns, and context signals. The response includes an explanation and provider status.

## Local development

Requirements:

- Node.js 22 or a compatible current Node.js release
- npm
- Managed AI runtime credentials for live AI responses

Install dependencies and start the development server:

```bash
npm ci
MANUS_API_URL="https://your-managed-ai-endpoint" \
MANUS_API_KEY="your-server-only-key" \
npm run dev
```

Open <http://localhost:3000>.

Build and run the production container locally:

```bash
npm ci
npm run build
NODE_ENV=production \
MANUS_API_URL="https://your-managed-ai-endpoint" \
MANUS_API_KEY="your-server-only-key" \
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

- Conversation text is only sent to the configured AI endpoint when the user requests a reply.
- The application does not send messages to WhatsApp or other messenger services.
- No official WhatsApp personal-chat integration is claimed or required.
- API credentials belong on the server and must not be committed to the repository.

## Project status

This is an early version focused on a polished, installable reply workspace. It demonstrates context-aware replies and browser voice interaction without pretending to be a privileged messenger client.
