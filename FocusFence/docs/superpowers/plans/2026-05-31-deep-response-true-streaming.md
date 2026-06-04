# Deep Response True Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a continuous HTTP-streamed Deep Response path for Watch: Watch uploads microphone audio chunks over HTTP, receives server events/audio chunks over HTTP/SSE/chunked/polling, and keeps a multi-turn session alive until goodbye or idle end.

**Architecture:** Keep `http-turn-v2` as the known-good fallback baseline, then evolve it into an HTTP session transport. Watch transport is HTTP-first; WebSocket is not a mainline dependency on watchOS. Server-side provider connections to Doubao ASR/TTS may still use WebSocket because those run on Node, not on Watch.

**Tech Stack:** watchOS SwiftUI, `URLSession` HTTP upload/download, SSE/chunked JSONL/short polling candidates, Node.js HTTP server, Doubao ASR WebSocket, Ark LLM streaming, Doubao bidirectional TTS WebSocket, Render deployment, Node test runner.

---

## Current Baseline

- Update 2026-06-04:
  - Fire/Volcengine ECS is now the primary test deployment: `http://124.174.96.149:8797`.
  - Render remains a rollback/reference deployment, not the main latency target.
  - Watch Lab points to the Fire/Volcengine endpoint.
  - `http-turn-v2` and HTTP session mode both work on real Watch.
  - Server-side prompt flow was simplified from first/followup to one complete AI reply:
    - ASR: one final transcript per manual turn.
    - LLM: one complete short reply.
    - TTS: one synthesis stream for the complete reply.
    - Watch UI shows one `god:` reply, no `first:` / `more:` fields.
- Latest branch: `codex/deep-response-lab`.
- Latest pushed commit after single-reply pipeline: `d4640de Use single DeepResponse reply pipeline`.
- Current DeepLab HTTP session baseline:
  - Watch client reuses one HTTP session across repeated mic turns.
  - Server stores short-term session context and uses it for following turns.
  - Watch client has local-first abort control and stale generation audio filtering.
  - Remote one-command smoke probe passes against Fire/Volcengine ECS.
- True streaming is still not complete:
  - Watch -> Render WebSocket has previously failed with `-1001` / `-999` and is no longer mainline.
  - Provider-side ASR/LLM/TTS are available, but the main path still waits for ASR final before LLM and waits for a complete LLM reply before TTS starts.
  - Current TTS audio itself is chunked/streamed to Watch, but LLM->TTS is not yet a true incremental phrase pipeline.
  - Full hands-free listening/VAD loop is not implemented.
  - Goodbye and idle-end flows are not implemented.
  - Summary/memory candidate persistence is not implemented.
  - Watch installation/launch is sometimes blocked by CoreDevice tunnel instability; do not rely on manual Watch testing until local/remote script gates pass.

Latest remote smoke command:

```bash
npm run deep:http-smoke:test -- \
  --endpoint http://124.174.96.149:8797 \
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
- stop-to-first-audio after single-reply Fire/Volcengine deployment: `1963ms`, `1902ms`
- abort stale audio chunks/bytes: `0` / `0`

## Next Target: Full Streaming Pipeline

The next target is not another two-step reply trick. The target is a real cascade:

```text
Watch uploads mic chunks over HTTP while user speaks
-> Server streams chunks to Doubao ASR
-> ASR partial/final events update turn state
-> LLM streams tokens as soon as a usable utterance boundary exists
-> Sentence/phrase chunker emits speakable Chinese phrases
-> TTS starts on the first speakable phrase while LLM continues
-> Watch receives audio chunks and plays them progressively
-> User barge-in stops local playback immediately and aborts the active generation
```

Important distinction:

- Current deployed path: streaming transport and chunked TTS playback, but LLM waits for ASR final and TTS waits for complete LLM text.
- Next path: incremental ASR -> incremental LLM -> phrase chunker -> incremental TTS queue.

Main latency goal:

- Stop speaking to first playable audio: target `<= 1500ms`, stretch `<= 1000ms` on scripted Fire/Volcengine fixture.
- Barge-in local stop: target `<= 200ms`; server stale audio after abort: `0`.
- Manual Watch test should only be requested after script/local/remote tests show the target is plausible.

## Full Streaming Implementation Units

### Server Pipeline Files

- Modify `scripts/deep-response/pipeline/voice-pipeline.mjs`
  - Keep `runSegmented()` as the single-reply fallback.
  - Add `streamCascadeTurn()` as the true streaming path.
  - Own orchestration only: ASR stream, LLM stream, phrase chunker, TTS queue, abort propagation, timing.

- Create `scripts/deep-response/pipeline/phrase-chunker.mjs`
  - Convert LLM token deltas into speakable Chinese phrase chunks.
  - Flush on punctuation such as `。！？；`.
  - Flush on max character threshold for low-latency first phrase.
  - Avoid sending obviously incomplete scripture reference fragments to TTS.

- Create `scripts/deep-response/pipeline/tts-queue.mjs`
  - Accept phrase chunks.
  - Run one-at-a-time TTS synthesis streams in order.
  - Yield audio chunks with `turn_id`, `generation_id`, `phrase_index`, and `audio_index`.
  - Stop immediately on abort.

- Modify `scripts/deep-response/providers/ark-llm.mjs` or current Ark provider file
  - Expose `streamTokens()` or equivalent async generator.
  - Preserve existing `generate()` for fallback/tests.
  - Emit first-token and token-count timing.

- Modify Doubao ASR provider file under `scripts/deep-response/providers/`
  - Ensure `transcribeStream()` emits partial/final transcript events consistently.
  - Preserve existing `transcribe()` for fallback/tests.

- Modify Doubao TTS provider file under `scripts/deep-response/providers/`
  - Ensure `synthesizeStream()` is the primary TTS interface for cascade mode.
  - Preserve existing `synthesize()` for fallback/tests.

### Server Session Files

- Modify `scripts/deep-response-server.mjs`
  - Add a feature flag or mode switch for HTTP session cascade:
    - fallback: current single-reply session pipeline.
    - cascade: true streaming pipeline.
  - Event stream should emit:
    - `transcript_partial`
    - `transcript_final`
    - `assistant_text_delta`
    - `assistant_phrase`
    - `audio_chunk`
    - `timing`
    - `turn_done`
    - `abort_ack`
  - Audio pull endpoint should continue using `session_id`, `turn_id`, `generation_id`.

- Modify `scripts/test-deep-response-http-smoke.mjs`
  - Add assertions for cascade mode:
    - first phrase emitted before full LLM done.
    - first audio emitted before full reply text done.
    - stale generation audio remains `0` after abort.

- Create or extend `scripts/test-deep-response-cascade-provider.mjs`
  - Provider-only fixture benchmark, no Watch.
  - Measures:
    - upload stop to ASR final
    - ASR partial to LLM request start
    - LLM first token
    - first phrase ready
    - first TTS audio
    - first audio available to HTTP session

### Watch Lab Files

- Modify `Sources/DeepResponseWatchLab/DeepResponseRealtimeClient.swift`
  - Keep current HTTP polling/pull fallback.
  - Add cascade event handling if new event names are introduced.
  - Continue rejecting stale `generation_id` audio.

- Modify `Sources/DeepResponseWatchLab/DeepResponseAudioPlayer.swift`
  - Confirm queued chunk playback does not require a full response.
  - Add/keep immediate local stop for abort.

- Modify `Sources/DeepResponseWatchLab/DeepResponseDebugView.swift`
  - Keep UI compact:
    - `you:`
    - `god:`
    - `upl / first / done`
    - `asr / llm1 / phrase1 / tts1`
    - `abort`
  - Do not reintroduce `first:` / `more:` display.

## Full Streaming Milestones

### Milestone S1: Scripted Cascade With Mock Providers

Status: completed on branch `codex/deep-response-lab` after adding mock-provider cascade units.

Purpose:
- Prove the orchestration works before touching real providers or Watch.

Implementation:
- Add `phrase-chunker.mjs`.
- Add `tts-queue.mjs`.
- Add `VoicePipeline.streamCascadeTurn()`.
- Use mock ASR partial/final, mock LLM token stream, mock streaming TTS.

Validation:

```bash
node --test scripts/deep-response/pipeline/voice-pipeline.test.mjs
node --test scripts/deep-response/pipeline/phrase-chunker.test.mjs
node --test scripts/deep-response/pipeline/tts-queue.test.mjs
node --test scripts/deep-response-server.test.mjs
```

Acceptance:
- First `assistant_phrase` appears before LLM stream is complete.
- First `audio_chunk` appears before final assistant text is complete.
- Abort cancels TTS queue and no stale generation audio is yielded.
- No Watch manual testing.

Completed evidence:
- Created `scripts/deep-response/pipeline/phrase-chunker.mjs`.
- Created `scripts/deep-response/pipeline/tts-queue.mjs`.
- Added `VoicePipeline.streamCascadeTurn()` for mock ASR/LLM/TTS cascade.
- Verified:

```bash
node --test scripts/deep-response/pipeline/voice-pipeline.test.mjs scripts/deep-response/pipeline/phrase-chunker.test.mjs scripts/deep-response/pipeline/tts-queue.test.mjs scripts/deep-response-server.test.mjs
node --test scripts/deep-response-watch-ui.test.mjs scripts/test-deep-response-streaming-provider.test.mjs scripts/deep-response/pipeline/voice-pipeline.test.mjs scripts/deep-response/pipeline/phrase-chunker.test.mjs scripts/deep-response/pipeline/tts-queue.test.mjs scripts/deep-response-server.test.mjs
```

Latest local result:
- `30/30` S1 required tests passed.
- `34/34` related DeepResponse regression tests passed.

### Milestone S2: Real Provider Cascade Harness

Status: completed for provider-only cascade harness on branch `codex/deep-response-lab`.

Purpose:
- Prove Fire/Volcengine ASR + Ark streaming LLM + Doubao streaming TTS can behave like a pipeline.

Implementation:
- Wire real `transcribeStream()`, `streamTokens()`, and `synthesizeStream()` into `streamCascadeTurn()`.
- Add timing fields for each boundary.
- Add provider-only benchmark script.

Validation:

```bash
npm run deep:provider:check
npm run deep:streaming:provider:test
node scripts/test-deep-response-cascade-provider.mjs --pcm /private/tmp/deep-response-http-speed.pcm --turns 3
```

Acceptance:
- No Watch required.
- First phrase and first audio are emitted progressively.
- Scripted stop-to-first audio target is `<= 1500ms` for at least 2 of 3 turns.
- If ASR final remains the bottleneck, document exact timing before changing Watch behavior.

Completed evidence:
- Added `ArkLLMProvider.streamTokens()` and kept `generate()` as fallback/compatibility wrapper.
- Added `scripts/test-deep-response-cascade-provider.mjs`.
- Added npm script `deep:cascade:provider:test`.
- Verified provider credentials and handshakes:

```bash
npm run deep:provider:check
```

Latest result:
- `PASSED 15/15 checks`.

- Verified real provider cascade without Watch:

```bash
npm run deep:cascade:provider:test -- --pcm /private/tmp/deep-response-http-speed.pcm --turns 3 --replay-interval-ms 20 --phrase-max-chars 24
```

Latest result:
- `3/3` turns ok.
- First phrase/audio were emitted before `turn_done` on every turn.
- `first_audio_after_transcript_final_ms`: `1112`, `1210`, `1001`.
- `first_audio_elapsed_ms`: `2157`, `2237`, `1904`.

Timing note:
- `first_audio_elapsed_ms` is measured from script pipeline start, including fixture replay/upload time.
- For stop-speaking-to-first-audio estimation, `first_audio_after_transcript_final_ms` is currently the stronger provider-side signal because it measures after ASR final is available.

### Milestone S3: HTTP Session Cascade On Fire/Volcengine ECS

Status: completed for HTTP session cascade smoke on Fire/Volcengine ECS.

Purpose:
- Prove Watch-compatible HTTP session transport can deliver cascade events/audio remotely.

Implementation:
- Add cascade mode to `/deep-response/sessions`.
- Keep current single-reply mode as fallback.
- Deploy to Fire/Volcengine ECS.

Validation:

```bash
node --test scripts/deep-response-server.test.mjs
npm run deep:volc:deploy
npm run deep:http-smoke:test -- \
  --endpoint http://124.174.96.149:8797 \
  --pcm /private/tmp/deep-response-http-speed.pcm \
  --turns 3 \
  --chunk-ms 1000 \
  --upload-sleep-ms 1000 \
  --poll-ms 50 \
  --timeout-ms 120000 \
  --observe-ms 3000 \
  --max-stop-to-first-audio-ms 2000
```

Acceptance:
- Remote smoke passes.
- First audio is produced through the HTTP session path before full reply completion.
- Abort still reports stale audio chunks/bytes `0` / `0`.
- No Watch manual testing unless these pass.

Completed evidence:
- Added session-level `pipelineMode: "cascade"` for `/deep-response/sessions`.
- Kept current single-reply `streamSegmented()` fallback as default.
- Added HTTP smoke support for `--pipeline-mode cascade`.
- Verified locally:

```bash
npm run test:node
npm run deep:http-smoke:test -- --endpoint http://127.0.0.1:8899 --pcm /private/tmp/deep-response-http-speed.pcm --turns 1 --chunk-ms 1000 --upload-sleep-ms 1000 --poll-ms 50 --timeout-ms 120000 --observe-ms 2000 --max-stop-to-first-audio-ms 3000 --retries 0 --pipeline-mode cascade
```

Latest local results:
- `103/103` Node tests passed.
- Local HTTP cascade smoke passed.
- Local stop-to-first audio: `1546ms`.
- Local abort stale audio chunks/bytes: `0` / `0`.

- Deployed Fire/Volcengine ECS:

```bash
npm run deep:volc:deploy
```

Latest deployment:
- `HEAD is now at 369ad22 Add HTTP session cascade mode`.
- health `200`.

- Verified remote Fire/Volcengine HTTP cascade:

```bash
npm run deep:http-smoke:test -- --endpoint http://124.174.96.149:8797 --pcm /private/tmp/deep-response-http-speed.pcm --turns 2 --chunk-ms 1000 --upload-sleep-ms 1000 --poll-ms 50 --timeout-ms 120000 --observe-ms 3000 --max-stop-to-first-audio-ms 3000 --retries 1 --pipeline-mode cascade
```

Latest remote results:
- `2/2` cascade turns ok.
- stop-to-first audio: `1891ms`, `1415ms`.
- abort stale audio chunks/bytes: `0` / `0`.

### Milestone S4: Watch Cascade Playback Gate

Purpose:
- Validate that real Watch can consume cascade events/audio without UI or playback regressions.

Implementation:
- Update Watch Lab only if event schema requires it.
- Install only after build passes.
- Keep single-reply fallback available.

Validation before user:

```bash
node --test scripts/deep-response-watch-ui.test.mjs
xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build
```

Manual Watch test:
- User records one short sentence.
- Expected:
  - `you:` correct.
  - `god:` appears as one reply, not first/more.
  - First audio feels faster or at least no slower than current 3-4s Watch experience.
  - No chunk jitter, repeated first syllable, truncation, or stale old audio.

Acceptance:
- One-turn Watch cascade works.
- If Watch playback stutters while script tests are clean, fix Watch audio queue before advancing.

### Milestone S5: Hands-Free Conversation Loop

Purpose:
- Move from manual press-to-talk turns toward Xiaozhi-style continuous conversation.

Implementation:
- Watch local state machine:
  - listening
  - user_speaking
  - assistant_speaking
  - barge_in
  - idle_waiting
  - ended
- Add local VAD/silence endpoint detection or server-assisted endpointing.
- Automatically return to listening after assistant playback.
- Add goodbye intent and idle close handling.

Validation before user:
- Script 8-turn session with context and goodbye.
- Script idle timeout and gentle goodbye.
- Abort test still passes.

Manual Watch test:
- User completes 3-5 turns without manually reconnecting.
- User interrupts once while AI is speaking.
- User says goodbye and session ends naturally.

Acceptance:
- Continuous conversation feels coherent.
- No reconnect per turn.
- Barge-in local stop target `<= 500ms` by user perception; script stale audio remains `0`.

### Milestone S6: Memory/Summary And Product Integration Decision

Purpose:
- Decide whether DeepResponse can move out of isolated Lab.

Implementation:
- Add async transcript/summary/memory candidate write path.
- Keep this out of first-audio path.
- Define integration point with Quick Response invite flow.

Validation:
- Summary write tested by script.
- Quick Response old flow remains untouched.
- DeepLab remains independently launchable.

Manual gate:
- Only after S1-S5 pass.
- User approves whether to integrate into old Watch app or keep separate for more Lab testing.

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
