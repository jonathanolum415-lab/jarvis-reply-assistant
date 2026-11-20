# TODO

## [x] Deliver a visible JARVIS command-center workspace
- Show a split interface with a conversation workspace and JARVIS response/context panel.
- Use the confirmed cinematic dark command-center system with restrained cyan accents and subtle motion.
- Keep the layout responsive for desktop and narrow screens.

## [x] Deliver a draft-first reply workflow
- Let the user choose Professional, Friendly, Funny, Short, Apologetic, Romantic, or JARVIS modes.
- Show multiple suggested replies for the active incoming message.
- Allow a suggestion to become an editable draft.
- Provide copy and approve actions.
- Never send a message automatically.

## [x] Deliver simulated voice input
- Provide a voice control with listening, processing, and transcribed-message states.
- Show the simulated transcript in the composer and make it available for reply drafting.

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
