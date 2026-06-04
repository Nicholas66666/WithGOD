# DeepResponse Product Integration Decision

Date: 2026-06-05

Decision: keep DeepResponse in the independent Lab target.

Do not integrate into Quick Response, PresenceWatchApp, or the stable user flow yet. DeepResponseWatchLab remains the active test package and DeepLab remains the only user-facing surface for this POC until explicit user approval changes this decision.

## Current State

- Watch/server transport is HTTP-only.
- The DeepResponse server exposes HTTP session endpoints, not a client-facing WebSocket upgrade route.
- Provider-internal WebSocket code is allowed only where Doubao ASR/TTS requires it.
- Node self-test, Fire/Volcengine smoke, WatchLab build, memory recall/persistence, idle goodbye, abort resume, and Quick Response source guards are the required validation surface.
- User-operated Watch testing is not a development gate.

## Evidence Required Before Reconsidering

- `npm run deep:selftest:full` passes on the current branch.
- Fire/Volcengine remote smoke passes with memory recall, memory persistence, idle memory persistence, abort next-turn, and forbidden reply-pattern gates.
- DeepResponseWatchLab watchOS build succeeds.
- Quick Response main flow stays untouched.
- Integration gate source checks pass.
- Any product-experience spot check is explicitly requested by the user and recorded as optional evidence, not as a normal phase gate.

## Allowed Next Steps

- Continue improving DeepResponse in DeepResponseWatchLab.
- Continue improving server/provider/memory behind HTTP session endpoints.
- Continue adding self-tests, source gates, Fire/Volcengine smoke coverage, and watchOS build checks.
- Draft a future integration implementation plan only after explicit user approval.

## Not Allowed

- Do not integrate into Quick Response.
- Do not add DeepResponseDebugView to PresenceWatchApp.
- Do not add a visible DeepResponse entry to the stable Watch app.
- Do not change Quick Response recording, upload, response generation, playback, routing, or persistence behavior.
- Do not reintroduce Watch WebSocket or client-facing DeepResponse WebSocket transport.
- Do not route the core realtime chain through iPhone.

## Future Integration Preconditions

If the user explicitly approves product integration later, create a separate integration plan before code changes. That plan must include:

- Feature flag name and default-off behavior.
- Exact Watch/iPhone entry point.
- Rollback tag.
- Rollback command.
- Files allowed to change.
- Files explicitly not allowed to change.
- Required self-test commands.
- Required Fire/Volcengine smoke command.
- Optional product-experience spot check scope.

