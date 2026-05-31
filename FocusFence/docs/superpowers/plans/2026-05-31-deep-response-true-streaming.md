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
- Latest validation UI commit: `84419f0 Trim DeepLab v2 validation screen`.
- True streaming is still not complete:
  - Watch -> Render WebSocket has previously failed with `-1001` / `-999` and is no longer mainline.
  - HTTP v2 currently uploads one complete recording and returns one JSON response, not chunked session streaming.
  - `VoicePipeline.runSegmented` is sequential, not event-streaming.
  - TTS provider collects audio chunks before returning to caller.

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

## Phase Map And Expected Effects

### Phase A: Provider Streamability

Effect:
- No Watch involved.
- Fixture PCM proves provider chain can produce first text/audio progressively.
- We know whether Doubao TTS can yield first audio before full session finish.

Deliverables:
- `scripts/test-deep-response-streaming-provider.mjs`
- `deep:streaming:provider:test`
- Provider timing report with `asr_final_ms`, `llm_first_phrase_ms`, `tts_first_audio_ms`, `first_playable_audio_ms`.

Gate:
- Continue only when local provider harness proves progressive provider output.

### Phase B: HTTP Session Server

Effect:
- Server has `DeepResponseSession` runtime.
- Session state survives across many HTTP requests.
- Audio chunks, events, audio output chunks, abort, end all bind to `session_id`, `turn_id`, `generation_id`.
- Node script can simulate Watch without a real device.

Deliverables:
- `POST /deep-response/sessions`
- `POST /deep-response/sessions/{session_id}/audio`
- `POST /deep-response/sessions/{session_id}/input-stop`
- `GET /deep-response/sessions/{session_id}/events`
- `GET /deep-response/sessions/{session_id}/audio`
- `POST /deep-response/sessions/{session_id}/abort`
- `POST /deep-response/sessions/{session_id}/end`
- `scripts/test-deep-response-http-session.mjs`
- `deep:http-session:test`

Gate:
- Local and Render script tests prove first event/audio chunk arrives before final timing.

### Phase C: Watch HTTP Chunk Upload

Effect:
- Watch records live mic frames and uploads chunks while recording, not after the full recording ends.
- Server debug events show chunk arrival during recording.
- No provider dependency required for first Watch validation.

Deliverables:
- Live frame stream in DeepLab recorder.
- `WatchHTTPAudioUploader` behavior inside DeepLab client.
- Compact DeepLab UI showing `session`, `turn`, `chunks up`, `events`, `audio chunks`.

Gate:
- Real Watch test confirms chunks upload while recording.

### Phase D: Watch HTTP Event/Audio Pull

Effect:
- Watch receives transcript/text/audio chunks through HTTP session endpoints.
- Watch starts playing audio chunks before full response completion.
- HTTP v2 fallback remains available.

Deliverables:
- Event puller using SSE, chunked JSONL, or short polling based on real Watch behavior.
- Audio chunk puller with cursor/generation filtering.
- Streaming playback with small prebuffer.

Gate:
- Real Watch hears first playable audio from HTTP session mode.

### Phase E: Continuous Multi-Turn Session

Effect:
- AI returns to listening after speaking.
- User can speak multiple turns inside the same session.
- Server context remembers recent turns.

Deliverables:
- `DeepResponseSession` state machine.
- Short-term session memory.
- Multi-turn script test.
- DeepLab session UI showing current state and turn count.

Gate:
- Script test completes at least 8 turns in one session.
- Real Watch manual test completes 3-5 turns without reconnecting.

### Phase F: Barge-In

Effect:
- User starts speaking while AI is speaking.
- Watch stops playback locally first.
- Watch posts `/abort`.
- Server cancels old generation and stale audio is ignored.

Deliverables:
- Generation IDs on events/audio.
- Local-first playback stop.
- `/abort` server handling.
- Stale generation drop tests.

Gate:
- Script test proves stale generation audio is dropped.
- Real Watch test confirms old audio stops immediately.

### Phase G: Idle / Goodbye / Memory

Effect:
- User can say goodbye to end.
- Long idle triggers gentle confirmation and then goodbye.
- Session closes cleanly and writes transcript/summary/memory candidate asynchronously.

Deliverables:
- Goodbye intent classifier/rules.
- Idle timers.
- `session.end` event.
- Summary writer stub or Supabase writer, depending on integration readiness.

Gate:
- Script tests cover explicit goodbye and idle goodbye.
- Real Watch manual test confirms natural ending behavior.

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

## Phase 2B: Provider Streaming Harness

Goal: prove real provider streaming off-device before touching Watch.

- [ ] Add provider streaming tests for Ark LLM:
  - Input: fixed transcript string.
  - Expected: first phrase available before full completion.
  - Command: `npm run test:node`.

- [ ] Add provider streaming tests for Doubao TTS:
  - Input: one short Chinese sentence.
  - Expected: first audio chunk yielded before session finish.
  - Command: `npm run deep:streaming:provider:test`.

- [ ] Add provider streaming benchmark:
  - Input: existing fixture PCM.
  - Expected output fields:
    - `asr_first_partial_ms`
    - `asr_final_ms`
    - `llm_first_token_ms`
    - `llm_first_phrase_ms`
    - `tts_first_audio_ms`
    - `first_playable_audio_ms`
    - `total_ms`

Acceptance:
- Local/provider script can show first playable audio without waiting for full followup text.
- No Watch required.
- No old app changes.

## Phase 2C: Server HTTP Session Streaming Contract

Goal: make `/deep-response/sessions` a real progressive HTTP session transport.

- [ ] Define event contract:
  - Client HTTP:
    - `POST /deep-response/sessions`
    - `POST /deep-response/sessions/{session_id}/audio`
    - `POST /deep-response/sessions/{session_id}/input-stop`
    - `POST /deep-response/sessions/{session_id}/abort`
    - `POST /deep-response/sessions/{session_id}/end`
  - Server HTTP events:
    - `session_ready`
    - `transcript_partial`
    - `transcript_final`
    - `assistant_text_delta`
    - `audio_done`
    - `timing`
    - `error`
  - Server HTTP audio:
    - PCM audio chunks with `generation_id`, `chunk_seq`, and cursor.

- [ ] Change provider path so it does not wait for `pipeline.run()`.
  - Server should accept mic chunks during recording through HTTP uploads.
  - After `input_stop`, server starts provider pipeline.
  - As soon as a first phrase is speakable, server stores/emits `assistant_text_delta`.
  - As soon as TTS yields audio, server stores/emits audio chunks for Watch to pull/stream.

- [ ] Add script test:
  - `npm run deep:http-session:test -- --endpoint https://withgod-deep-response.onrender.com --pcm <fixture>`
  - Expected:
    - HTTP session starts.
    - `session_ready` event received.
    - `transcript_final` received.
    - `assistant_text_delta` received before `audio_done`.
    - First audio chunk received before final timing.

Acceptance:
- Node script proves HTTP session streaming against local server.
- Then same script proves HTTP session streaming against Render.
- If SSE/chunked is unstable on Watch, fallback to short-polling events/audio without changing server session semantics.

## Phase 2D: Watch HTTP Session Streaming Lab

Goal: real Watch uploads mic frames over HTTP and starts playing server audio chunks before the whole response is done.

- [ ] Add live mic frame stream in DeepLab.
  - Frame size target: 100 ms PCM16.
  - Sample rate: 16 kHz input to server.

- [ ] Add `runHTTPSessionTurn()` in `DeepResponseRealtimeClient`.
  - Create HTTP session.
  - Wait for `session_ready` event through events endpoint.
  - Start mic stream.
  - Upload chunks while recording.
  - On stop, POST `input-stop`.
  - Receive text events and audio chunks concurrently through HTTP.
  - Enqueue audio chunks immediately.

- [ ] Update `DeepResponseDebugView`.
  - Primary button: streaming mic.
  - Secondary fallback button: HTTP v2.
  - Display:
    - `mode: stream` or `mode: http2`
    - `you`
    - `text`
    - `first audio`
    - `asr/llm/tts/total`
    - last error compactly.

Acceptance:
- On Watch, recording starts and sends chunks before stop.
- After stop, Watch hears first audio as soon as server emits first TTS chunks.
- UI shows HTTP session streaming mode, not `Turn2`.
- HTTP v2 fallback still works.

## Phase 2E: Barge-In and Cancellation

Goal: streaming behaves like an interactive voice loop, not a one-shot HTTP request.

- [ ] Add generation IDs to all server events.
- [ ] On Watch barge-in or new recording:
  - Stop local playback.
  - Send `barge_in`.
  - Ignore stale audio/text with old generation ID.
- [ ] Server cancels active ASR/LLM/TTS work where possible.

Acceptance:
- While audio is playing, starting a new turn stops old audio.
- Server does not keep sending stale chunks into the next turn.
- Script test covers stale generation drop.
- Watch manual test confirms old reply stops.

## Phase 2F: Latency Optimization

Goal: reduce perceived first response time after true streaming works.

Optimization order:
- ASR:
  - Trim leading/trailing silence on Watch or server.
  - Avoid excessive replay delay.
  - Measure partial vs final transcript if provider supports it.
- LLM:
  - Smaller first-response prompt.
  - Lower first phrase max tokens.
  - Tune first phrase minimum characters.
- TTS:
  - Use shorter first phrase.
  - Reuse provider connection if Doubao API permits stable session reuse.
  - Keep first phrase natural but short.

Acceptance:
- First playable audio target:
  - POC acceptable: under 8 seconds after user stops speaking.
  - Good: under 5 seconds after user stops speaking.
  - Excellent: under 3 seconds after user stops speaking.

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
- DeepLab true streaming passes Watch manual test.
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
