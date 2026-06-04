# Deep Response True Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a continuous HTTP-streamed Deep Response path for Watch: Watch uploads microphone audio chunks over HTTP, receives server events/audio chunks over HTTP/SSE/chunked/polling, and keeps a multi-turn session alive until goodbye or idle end.

**Architecture:** Keep `http-turn-v2` as the known-good fallback baseline, then evolve it into an HTTP session transport. Watch transport is HTTP-first; WebSocket is not a mainline dependency on watchOS. Server-side provider connections to Doubao ASR/TTS may still use WebSocket because those run on Node, not on Watch.

**Tech Stack:** watchOS SwiftUI, `URLSession` HTTP upload/download, SSE/chunked JSONL/short polling candidates, Node.js HTTP server, Doubao ASR WebSocket, Ark LLM streaming, Doubao bidirectional TTS WebSocket, Render deployment, Node test runner.

---

## Current Baseline

- `http-turn-v2` works on real Watch:
  - Watch mic recording works.
  - Render server receives audio.
  - Doubao ASR returns correct Chinese transcript.
  - Ark LLM returns first/followup text.
  - Doubao TTS returns natural Chinese audio.
  - Watch plays first segment then followup segment smoothly.
- Latest branch: `codex/deep-response-lab`.
- Latest pushed commit: `ea8dc1f Add DeepResponse HTTP smoke probe`.
- Current DeepLab HTTP session baseline:
  - Watch client reuses one HTTP session across repeated mic turns.
  - Server stores short-term session context and uses it for following turns.
  - Watch client has local-first abort control and stale generation audio filtering.
  - Remote one-command smoke probe passes against Render.
- True streaming is still not complete:
  - Watch -> Render WebSocket has previously failed with `-1001` / `-999` and is no longer mainline.
  - Full hands-free listening/VAD loop is not implemented.
  - Goodbye and idle-end flows are not implemented.
  - Summary/memory candidate persistence is not implemented.
  - Latest abort UI build is not yet installed on Watch because CoreDevice tunnel setup failed.

Latest remote smoke command:

```bash
npm run deep:http-smoke:test -- \
  --endpoint https://withgod-deep-response.onrender.com \
  --pcm /private/tmp/deep-response-http-speed.pcm \
  --turns 2 \
  --chunk-ms 1000 \
  --upload-sleep-ms 1000 \
  --poll-ms 50 \
  --timeout-ms 90000 \
  --observe-ms 3000 \
  --max-stop-to-first-audio-ms 3000
```

Latest remote smoke result:

- health `200`
- two-turn conversation in one session passed
- stop-to-first-audio: `1682ms`, `1993ms`
- abort stale audio chunks/bytes: `0` / `0`

## Next Development Shape

This plan now targets a continuous Xiaozhi-style voice session, not a single streaming request.

The expected user-visible end state is:

```text
Open DeepLab / DeepResponse
-> session starts
-> user speaks
-> Watch uploads audio chunks over HTTP
-> AI responds with early text/audio chunks
-> Watch starts playback before the whole response is complete
-> AI returns to listening after each response
-> user can interrupt while AI speaks
-> user can continue for many turns in one session
-> user says goodbye, or idle timeout triggers gentle goodbye
-> server closes session and writes summary/memory candidate
```

The implementation must preserve these hard boundaries:

- Old Quick Response flow is untouched.
- DeepLab remains the active test package until explicit product integration approval.
- Watch transport is HTTP-first.
- WebSocket is only a feasibility spike and cannot block HTTP work.
- iPhone is not in the realtime path.
- `http-turn-v2` remains as fallback and regression baseline.

## Final Milestone Plan

The earlier A-G list is consolidated into four milestones. The rule is: do not ask for Watch testing until a milestone has exhausted script/local/Render validation.

### Milestone 1: Provider And Server Harness

Status: completed.

Purpose:
- Prove progressive provider behavior and HTTP session semantics without Watch.
- Reduce risk before any manual testing.

Implementation:
- Add provider streamability harness.
- Add `DeepResponseSession` runtime in Node.
- Add HTTP session endpoints:
  - `POST /deep-response/sessions`
  - `POST /deep-response/sessions/{session_id}/audio`
  - `POST /deep-response/sessions/{session_id}/input-stop`
  - `GET /deep-response/sessions/{session_id}/events`
  - `GET /deep-response/sessions/{session_id}/audio`
  - `POST /deep-response/sessions/{session_id}/abort`
  - `POST /deep-response/sessions/{session_id}/end`
- Add local and Render script tests.

Expected effect:
- A Node script can simulate Watch.
- It can upload fixture chunks, stop input, receive transcript/text/audio events, and verify first audio arrives before final timing.
- It can simulate abort and stale generation drop.
- It can run multi-turn and goodbye/idle flows without a real Watch.

Validation before user:
- `npm run test:node`
- `npm run deep:streaming:provider:test`
- `npm run deep:http-session:test` locally
- `npm run deep:render:deploy`
- `npm run deep:http-session:test -- --endpoint https://withgod-deep-response.onrender.com`

Manual Watch test:
- None.

Gate:
- Do not start Watch code until this milestone passes locally and on Render.

### Milestone 2: Watch HTTP Transport Lab

Status: completed enough for the next phase; keep `http-turn-v2` as fallback.

Purpose:
- Prove real Watch can upload live audio chunks over HTTP and pull events/audio over the selected HTTP mode.
- Keep provider complexity optional for first Watch validation.

Implementation:
- Add live mic frame streaming in DeepLab.
- Add HTTP chunk uploader.
- Add event/audio puller using the most stable Watch-compatible option:
  - try SSE/chunked JSONL if reliable;
  - fall back to short polling if needed.
- Keep `http-turn-v2` fallback button.
- Keep UI compact and diagnostic.

Expected effect:
- Watch starts sending chunks while user is still recording.
- Server debug events show chunk arrival during recording.
- Watch receives event/audio chunks through HTTP session endpoints.
- Watch can play an audio response without waiting for a full JSON response.

Validation before user:
- Swift build succeeds.
- Local mock server or Render script verifies endpoints.
- If Watch code changed, install only after device is connected.

Manual Watch test gate 1:
- User confirms chunks upload while recording.
- User confirms event/audio pull path reaches Watch.
- User confirms no UI crowding.

Manual Watch test gate 2:
- User confirms first playable audio in HTTP session mode.
- User confirms HTTP v2 fallback still works.

### Milestone 3: Continuous Conversation Runtime

Status: partially complete.

Purpose:
- Turn single HTTP session streaming into Xiaozhi-style multi-turn conversation.

Implementation:
- Add session state machine:
  - listening
  - user_speaking
  - assistant_thinking
  - assistant_speaking
  - idle_waiting
  - ending
  - ended
- Add short-term context memory.
- Add turn and generation lifecycle.
- Add multi-turn script tests.
- Add explicit goodbye and idle timeout flows.

Completed:

- Server-side short-term context memory.
- Server turn/generation lifecycle for HTTP sessions.
- Render two-turn script probe.
- Watch client session reuse across repeated manual mic turns.

Remaining:

- Automatic return-to-listening loop on Watch.
- VAD or silence detection to end user turn without manual tap.
- Explicit goodbye intent test and endpoint behavior.
- Idle timeout and gentle close.

Expected effect:
- AI speaks, then returns to listening.
- User can continue several turns in the same session.
- Server remembers recent user emotion/topic and avoids obvious repetition.
- User can say goodbye.
- Idle timeout produces a gentle close.

Validation before user:
- `deep:http-session:test` covers at least 8 script-driven turns.
- Script tests cover user goodbye.
- Script tests cover idle goodbye.
- Render endpoint passes the same session tests.

Manual Watch test gate 3:
- User completes a short 3-5 turn conversation.
- User verifies it does not reconnect each turn.
- User verifies goodbye/idle ending feels natural enough for POC.

### Milestone 4: Barge-In And Product-Readiness Checkpoint

Status: partially complete.

Purpose:
- Make interruption feel natural and decide whether this is ready to move beyond DeepLab.

Implementation:
- Local-first stop in Watch playback.
- POST `/abort`.
- Server cancels active generation.
- Watch drops stale generation audio.
- Add timing traces:
  - `barge_in_to_local_stop`
  - `barge_in_to_server_stop`
  - `stale_audio_after_abort_count`
- Add summary/memory candidate write path or stub, depending on integration readiness.

Completed:

- Server `/abort` endpoint.
- Server stale generation drop.
- Render abort script probe.
- Watch local playback stop before POST `/abort`.
- Watch canceled generation audio filtering.

Remaining:

- Install latest DeepLab build when Watch is reachable.
- Manual confirmation that old audio stops immediately on real Watch.
- Timing traces for `barge_in_to_local_stop`, `barge_in_to_server_stop`, and `stale_audio_after_abort_count`.
- Decide whether abort should trigger immediate recording start or remain a separate interrupt button during POC.

Expected effect:
- While AI is speaking, user can start speaking and old audio stops quickly.
- Old response never leaks into the new turn.
- Session closes with transcript/summary/memory candidate.

Validation before user:
- Script test proves abort and stale generation drop.
- Render script passes abort test.
- Watch build and install are ready.

Manual Watch test gate 4:
- User tests interrupting while AI speaks.
- User reports whether old audio stops immediately.
- User reports whether new turn starts cleanly.

Product gate:
- Only after Milestone 4 do we discuss hidden entry or product integration.
- Quick Response remains untouched until explicit approval.

## File Responsibilities

- Modify `scripts/deep-response/protocol/deep-response-protocol.mjs`
  - Own HTTP session event names for streaming.
  - Add explicit turn/segment/generation fields where needed.

- Modify `scripts/deep-response/protocol/deep-response-protocol.test.mjs`
  - Validate event encoding/decoding and realtime URL construction.

- Modify `scripts/deep-response/providers/doubao-asr.mjs`
  - Expose a streaming or progressive ASR interface when provider supports it.
  - Preserve existing `transcribe()` for HTTP fallback.

- Modify `scripts/deep-response/providers/ark-llm.mjs`
  - Add a true async-token/phrase stream interface.
  - Preserve existing `generate()` for HTTP fallback and benchmarks.

- Modify `scripts/deep-response/providers/doubao-tts.mjs`
  - Add an async audio chunk stream interface that yields first audio immediately.
  - Preserve existing `synthesize()` for HTTP fallback and benchmarks.

- Modify `scripts/deep-response/pipeline/voice-pipeline.mjs`
  - Add a new `streamTurn()` async generator.
  - Emit transcript, first phrase, followup text, audio chunk, audio done, timing events progressively.
  - Preserve `run()` and `runSegmented()`.

- Modify `scripts/deep-response/pipeline/voice-pipeline.test.mjs`
  - Test ordering and timing semantics without real providers.

- Modify `scripts/deep-response-server.mjs`
  - Add HTTP session streaming endpoints under `/deep-response/sessions`.
  - Keep `http-turn-v2` unchanged.
  - Add debug events for session start, audio chunk upload, event/audio delivery, first transcript, first phrase, first audio chunk, abort/end reason.

- Modify `scripts/deep-response-server.test.mjs`
  - Test HTTP session server emits progressive messages/audio before full completion.
  - Test barge-in cancels current generation.

- Create `scripts/test-deep-response-http-session.mjs`
  - Add local/remote script harness to verify HTTP session streaming timing.
  - Output first transcript, first text, first audio, audio done, total.

- Create `scripts/test-deep-response-streaming-provider.mjs`
  - Provider-only benchmark: fixture PCM -> ASR/LLM/TTS stream, no Watch.
  - Used before any Watch install.

- Modify `package.json`
  - Add scripts:
    - `deep:streaming:provider:test`
    - `deep:http-session:test`

- Modify `Sources/DeepResponseWatchLab/DeepResponseRealtimeClient.swift`
  - Add a dedicated HTTP session streaming API separate from HTTP v2.
  - Create session, upload audio chunks, poll/stream events, pull audio chunks, POST abort/end.
  - Keep `runSegmentedHTTPTurn` as fallback.

- Modify `Sources/DeepResponseWatchLab/DeepResponseMicrophoneRecorder.swift`
  - Add live frame streaming support or a companion streaming recorder type.
  - Keep existing whole-recording API for HTTP v2 fallback.

- Modify `Sources/DeepResponseWatchLab/DeepResponseAudioPlayer.swift`
  - Verify queued chunk playback works with smaller incremental chunks.
  - Add minimal buffering if needed to avoid crackle under real network jitter.

- Modify `Sources/DeepResponseWatchLab/DeepResponseDebugView.swift`
  - Add a two-mode control:
    - Primary: HTTP session streaming.
    - Fallback: HTTP v2.
  - Keep screen compact: transcript/text/audio/timing only.

- Modify `Sources/DeepResponseWatchLab/DeepResponseProtocol.swift`
  - Add streaming event fields such as `turn_id`, `segment`, `generation_id`, `delta`, and timing keys if needed.

## WebSocket Feasibility Spike

Goal: keep WebSocket as a separate research path only if HTTP cannot meet first-playback or barge-in goals.

Rules:
- Do not connect ASR/LLM/TTS in this spike.
- Test only Watch real-device WSS binary echo/audio.
- Activate `AVAudioSession` before opening WebSocket.
- Configure Watch audio background mode.
- Simulator success does not count.
- Real Watch must sustain 3-5 minutes of binary chunk send/receive.
- Validate local-first abort and stale `generation_id` audio drop.
- Failure must not block HTTP session streaming.

Acceptance:
- WebSocket can be reconsidered only after this spike passes on real Watch.
- Even if it passes, HTTP remains the baseline for comparison until WebSocket beats it on first playback, abort, power, and recovery.

## Phase 3: Product Integration Decision

Goal: decide how to merge DeepResponse into the real app without risking old stable behavior.

Preconditions:
- DeepLab HTTP session streaming passes Watch manual test.
- HTTP v2 fallback passes Watch manual test.
- Barge-in behaves acceptably.
- Render deploy and env sync are documented.

Options:
- Keep DeepLab as an internal debug app longer.
- Add DeepResponse as a hidden/debug entry in the main Watch app.
- Add a production Deep Response screen behind a feature flag.

Acceptance:
- No change to Quick Response main flow until user explicitly approves product integration.
- There is a rollback tag before integration.

## Test Commands

- Unit and server tests:
  - `npm run test:node`

- Provider check:
  - `npm run deep:provider:check`

- Existing provider benchmark:
  - `npm run deep:provider:benchmark`

- New provider streaming harness:
  - `npm run deep:streaming:provider:test`

- New HTTP session streaming script:
  - `npm run deep:http-session:test`

- Render deploy:
  - `npm run deep:render:deploy`

- Watch build:
  - `xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /Users/nicho/Library/Developer/Xcode/DerivedData/Focus-cybkojzcswzxyscwwemxdhsnugsk DEEP_RESPONSE_REALTIME_ENDPOINT=https://withgod-deep-response.onrender.com build`

- Watch install:
  - `xcrun devicectl device install app --timeout 180 --device 6B873DBC-11D7-5F93-AA64-96FB0531C28B /Users/nicho/Library/Developer/Xcode/DerivedData/Focus-cybkojzcswzxyscwwemxdhsnugsk/Build/Products/Debug-watchos/DeepLab.app`

## What Can Be Verified Without User

- All Node unit tests.
- Provider credential/config checks.
- Provider streaming benchmark from fixtures.
- Local HTTP session streaming script.
- Render HTTP session streaming script.
- Watch app build.
- Render deploy and `/health` / `/debug/config`.

## What Requires User / Real Watch

- Watch app installation when the Watch is physically reachable by the Mac.
- Watch microphone permission and live mic capture.
- Real speaker playback quality.
- UI legibility on wrist.
- Perceived latency and naturalness.
- Barge-in feel.

## Version Management

- Keep all work on `codex/deep-response-lab`.
- Commit after each passing phase.
- Push every commit.
- Tag before changing integration boundaries:
  - `checkpoint/YYYY-MM-DD-deeplab-streaming-provider`
  - `checkpoint/YYYY-MM-DD-deeplab-render-streaming`
  - `checkpoint/YYYY-MM-DD-deeplab-watch-streaming`
- Do not modify old stable app flow unless entering Phase 3 with explicit approval.
