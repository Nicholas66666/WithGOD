# DeepResponse Integration Gate

Status: blocked until explicit user approval.

This gate exists to prevent the DeepResponse Lab work from drifting into the stable Watch app or Quick Response path before the product decision is made.

## Current Decision

- Quick Response main flow stays untouched.
- DeepResponseWatchLab remains the active test package.
- DeepLab is the only user-facing surface for this POC until approval changes.
- Watch transport remains HTTP-only.
- No WebSocket feasibility or fallback work is part of the integration path.
- Product-experience spot check is optional and user-requested.

## Required Before Main App Entry

- Feature flag required before main app entry.
- Rollback tag required before integration.
- Fire/Volcengine remote smoke must pass on the current branch.
- DeepResponseWatchLab watchOS build must pass.
- Node self-tests must pass.
- Quick Response main flow must have a source-level guard proving no DeepResponse debug routing is present.
- Directory-level source guard required for PresenceWatchApp and PresenceApp: no DeepResponse, DeepLab, or deep-response references may enter those app source trees before explicit approval.
- DeepResponse must remain removable without changing Quick Response behavior.

## Allowed Next Steps

- Keep improving DeepResponse in the independent Lab target.
- Keep server/provider/memory work behind HTTP session endpoints.
- Keep using self-tests, source tests, watchOS builds, and Fire/Volcengine smoke as phase gates.
- Draft a later integration plan with exact feature flag name, rollback tag, and entry point only after explicit approval.

## Not Allowed Without Approval

- Add DeepResponseDebugView to PresenceWatchApp.
- Add DeepResponse as a visible main Watch app entry.
- Change Quick Response recording, upload, response, or playback flow.
- Introduce Watch WebSocket transport or fallback.
- Make iPhone part of the realtime chain.
