# DeepLab HTTP Provider Turn Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move DeepLab from validated HTTP echo turn to a provider-backed HTTP turn that can be tested on Apple Watch without WebSocket.

**Architecture:** Keep DeepResponse independent from Presence/Quick Response. The Watch Lab sends PCM16 over HTTPS/HTTP session endpoints, the Node server runs the existing VoicePipeline in provider mode, and the Watch plays returned PCM audio. This historical Phase 1 plan is superseded by the 2026-06-05 hard policy: DeepResponse Watch transport is HTTP only, and Watch WebSocket is not a diagnostic, fallback, spike, benchmark, or validation track.

**Tech Stack:** watchOS SwiftUI, `URLSession.upload`, Node.js HTTP server, Render Web Service, Volcengine/Doubao ASR+TTS, Ark LLM, Node test runner.

---

## File Map

- `scripts/deep-response-server.mjs`: Owns `/deep-response/http-turn`, debug events, echo/provider branching, and VoicePipeline invocation.
- `scripts/deep-response-server.test.mjs`: Covers echo HTTP turn and provider HTTP turn with mock pipeline.
- `scripts/render-deploy.mjs`: Reads `.env.local`, triggers Render deploys, and polls deploy status.
- `scripts/render-deploy.test.mjs`: Covers Render API request shape and wrapped/empty deploy response handling.
- `Sources/DeepResponseWatchLab/DeepResponseRealtimeClient.swift`: Owns Watch HTTP health/probe/echo/turn calls and PCM playback.
- `Sources/DeepResponseWatchLab/DeepResponseDebugView.swift`: Owns the DeepLab debug controls and status display.
- `.env.local`: Local-only secrets, including `RENDER_API_KEY` and `RENDER_DEEP_RESPONSE_SERVICE_ID`.
- Render service `srv-d8dbodsm0tmc73dp7560`: Remote Node runtime for Watch tests.

## Phase A: Provider Readiness

- [ ] Check Render environment variables through Render API without printing secret values.
  - Command: `curl https://api.render.com/v1/services/$RENDER_DEEP_RESPONSE_SERVICE_ID/env-vars`
  - Expected: keys include `ARK_API_KEY`, `DOUBAO_SPEECH_APP_ID`, `DOUBAO_SPEECH_ACCESS_TOKEN`, provider defaults as needed.
- [ ] Run local provider configuration check.
  - Command: `npm run deep:provider:check`
  - Expected: env consistency passes and provider credential fields are present.
- [ ] If Render lacks provider env vars, stop and ask user to add only missing keys in Render or authorize API-based update.

## Phase B: Local Provider Harness

- [ ] Run provider benchmark/fixture locally before touching Watch.
  - Command: `npm run deep:provider:benchmark -- --fixture <pcm fixture path>`
  - Expected: ASR/LLM/TTS timing summary, non-empty transcript/response/audio byte length.
- [ ] Run HTTP turn provider mode locally.
  - Command: `DEEP_RESPONSE_MODE=provider npm run deep:server`
  - Smoke: POST PCM to `/deep-response/http-turn`.
  - Expected: JSON `{ ok: true, transcript, text, audioBase64, audioByteLength, timing }`.

## Phase C: Remote Provider Smoke

- [ ] Set Render `DEEP_RESPONSE_MODE=provider` only after local provider harness passes.
- [ ] Deploy using API.
  - Command: `npm run deep:render:deploy`
  - Expected: deploy reaches `live`.
- [ ] Smoke remote HTTP turn from Mac.
  - Command: `curl -X POST https://withgod-deep-response.onrender.com/deep-response/http-turn ...`
  - Expected: no missing credential error, non-empty `audioBase64`, `audioByteLength > 0`.
- [ ] Check `/debug/events`.
  - Expected: `http_turn` and `http_turn_complete` with Watch/Mac client labels.

## Phase D: Watch Manual Test Gate

- [ ] Install latest DeepLab build to Watch.
  - Command: `xcrun devicectl device install app .../DeepLab.app`
- [ ] Launch DeepLab.
  - Command: `xcrun devicectl device process launch --terminate-existing com.nicho.DeepResponseWatchLab`
- [ ] Ask user to tap `bubble.left.and.waveform`.
  - Expected screen: `Turn 200` and `http_turn:200`.
  - Expected counters: `bytes` increases by returned provider PCM byte count.
  - Expected human feedback: user hears generated spoken audio, not just a 440Hz tone.

## Acceptance Criteria

- Automated: Node tests pass via `npm run test:node`.
- Automated: DeepLab watchOS build succeeds.
- Automated: Render deploy can be triggered by `npm run deep:render:deploy`.
- Automated: Remote `/deep-response/http-turn` in provider mode returns `ok:true` and non-empty audio.
- Manual: Watch plays returned provider audio through the DeepLab debug screen.

## Do Not Touch

- Presence/Quick Response main app flow.
- Stable baseline tag `baseline/2026-05-30-presence-stable-deeplab-isolated`.
- Old package routing or recording UI.
