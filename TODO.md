# TODO

## [x] Deliver the ChatGPT-style conversation layout
- Use a left sidebar for new chats, recent threads, workspace navigation, and the manual-paste disclosure.
- Give the central conversation a focused ChatGPT-like message stream, model/status header, and rounded draft composer.
- Keep JARVIS response modes, source intelligence, media playback, voice controls, context, and the approval gate available in a compact intelligence rail.
- Collapse the rail and sidebar cleanly on smaller screens without removing the draft-first boundary.

## [x] Deliver a visible JARVIS command-center workspace
- Show a split interface with a conversation workspace and JARVIS response/context panel.
- Use the confirmed cinematic dark command-center system with restrained cyan accents and subtle motion.
- Keep the layout responsive for desktop and narrow screens.

## [x] Deliver a draft-first reply workflow
- Let the user choose Professional, Friendly, Funny, Short, Apologetic, Romantic, or JARVIS modes.
- Show multiple suggested replies for the active incoming message.
- Allow a suggestion to become an editable draft.
- Provide copy and use-as-draft review actions; never represent review as an automatic send.
- Never send a message automatically.

## [x] Deliver simulated voice input
- Provide a voice control with listening, processing, and transcribed-message states.
- Show the simulated transcript in the composer and make it available for reply drafting.

## [x] Deliver live voice conversation mode
- Use browser microphone speech recognition for natural spoken turns where supported.
- Send each captured turn through the real reply API, read the first draft aloud, and resume listening for the next turn.
- Provide pause and stop-audio controls, compatibility messaging, and an explicit boundary that nothing is sent automatically.

## [x] Demonstrate multi-turn context management
- Seed a multi-turn conversation with visible prior messages.
- Show tracked context chips and a context summary in the intelligence rail.
- Generate replies using the visible conversation history and selected tone.

## [x] Deliver explainability
- Provide an explain-reply action that describes why a suggestion fits the selected tone and context.

## [x] Connect a real AI reply API
- Enable the managed server capability.
- Expose `POST /api/reply` using the managed LLM service with server-only credentials.
- Send the selected tone, incoming message, visible multi-turn transcript, and context signals to the model.
- Return three usable draft replies and an explanation to the browser.
- Keep a local fallback for service outages without weakening the draft-first approval gate.

## [x] Make the API deployment-ready
- Build a production container from the committed lockfile and Dockerfile.
- Serve compiled frontend assets in production mode.
- Expose `/api/health` as the deployment health path.
- Verify production-mode health and a real managed AI reply before deployment.

## [x] Repair GitHub Pages compatibility
- Use project-relative frontend assets under `/jarvis-reply-assistant/`.
- Route GitHub Pages API calls to the deployed Manus backend.
- Restrict backend CORS to the GitHub Pages and Manus app origins.

## [x] Deliver an installable home-screen web app
- Provide an application-owned manifest with standalone display, installable icons, and mobile browser metadata.
- Register a service worker that caches the interface shell while leaving live AI API requests online-only.
- Expose an install action where supported and provide browser-menu fallback guidance for iOS and unsupported browsers.

## [x] Deliver source intelligence and media playback
- Accept up to five public HTTP(S) source URLs, read their text or HTML details, and synthesize a cited JARVIS brief through the managed AI service.
- Show source excerpts and links so the user can inspect the underlying material.
- Load direct audio/video URLs and YouTube/Vimeo links into an in-app media dock.
- Let live voice commands containing a media URL play or pause media without sending a message.
