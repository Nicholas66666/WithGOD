# Deep Response True Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a continuous HTTP-streamed Deep Response path for Watch: Watch uploads microphone audio chunks over HTTP, receives server events/audio chunks over HTTP/SSE/chunked/polling, and keeps a multi-turn session alive until goodbye or idle end.

**Architecture:** Keep `http-turn-v2` as the known-good fallback baseline, then evolve it into an HTTP session transport. Watch transport is HTTP only for this POC. Do not plan, implement, spike, benchmark, or fall back to any Watch socket transport path. Server-side provider connections may use each provider's required streaming protocol because those run on Node, not on Watch.

**Tech Stack:** watchOS SwiftUI, `URLSession` HTTP upload/download, SSE/chunked JSONL/short polling candidates, Node.js HTTP server, Doubao ASR provider, Ark LLM streaming, Doubao bidirectional TTS provider, Fire/Volcengine ECS deployment, Node test runner.

**Testing policy:** This plan is self-test mode by default. Do not use user-operated Watch tests as a development gate. Exhaust Node tests, provider fixtures, local HTTP harnesses, Fire/Volcengine remote smoke tests, source-level Watch checks, simulator autoruns where available, and watchOS builds. User-operated Watch testing is not part of phase progression; it is only a product-experience spot check when the user explicitly asks for it.

**2026-06-04 correction:** Watch WebSocket is out of scope for the current target text. Do not spend implementation time on Watch WebSocket feasibility, fallback, spike, or comparison work. The Watch-side transport goal is HTTP only. Development proceeds in self-test mode by default; user-operated Watch testing is not a phase gate or a required validation step.

---

## Current Baseline

- Update 2026-06-04:
  - Fire/Volcengine ECS is now the primary test deployment: `http://124.174.96.149:8797`.
  - Render remains a rollback/reference deployment, not the main latency target.
  - Watch Lab points to the Fire/Volcengine endpoint.
  - `http-turn-v2` and HTTP session mode both work on real Watch.
  - Server-side prompt flow was simplified from first/followup to one complete AI reply:
    - ASR: one final transcript per press-to-talk turn.
    - LLM: one complete short reply.
    - TTS: one synthesis stream for the complete reply.
    - Watch UI shows one `god:` reply, no `first:` / `more:` fields.
- Latest branch: `codex/deep-response-lab`.
- Latest pushed commit after HTTP long-poll optimization: `d72329a Add DeepResponse HTTP long polling`.
- Current DeepLab HTTP session baseline:
  - Watch client reuses one HTTP session across repeated mic turns.
  - Server stores short-term session context and uses it for following turns.
  - Watch client has local-first abort control and stale generation audio filtering.
  - Remote one-command smoke probe passes against Fire/Volcengine ECS.
  - DeepResponseWatchLab no longer exposes Watch-side WebSocket transport code; source tests guard against reintroducing `URLSessionWebSocketTask` in the Watch Lab target.
- True streaming is still not complete:
  - Watch socket transport is removed from the development path. It is not a fallback, not a spike, and not a blocking dependency for DeepResponse.
  - Provider-side ASR/LLM/TTS are available, and local cascade now streams LLM tokens into phrase chunks while TTS runs concurrently in phrase order.
  - Partial-ASR utterance-boundary triggering is implemented in cascade mode: when a usable ASR partial is available, LLM/TTS can start before ASR final.
  - Current TTS audio itself is chunked/streamed to Watch, and the local LLM->phrase->TTS queue is no longer blocked by waiting for a complete LLM reply.
  - Full hands-free listening loop has a source/build gate, including local VAD/silence endpointing, but still needs stronger simulator/script state-machine coverage before final product readiness.
  - Goodbye and idle-end flows are implemented on the server and covered by smoke tests.
  - Summary/memory candidate JSONL persistence is implemented, and new HTTP sessions can recall bounded recent JSONL memory into LLM context.
  - Watch installation/launch is sometimes blocked by CoreDevice tunnel instability; do not rely on user-operated Watch testing for normal development progress.
  - Development mode is now explicitly self-test first. A real Watch test is only a product-experience spot check after local/server/simulator/source/build checks pass.

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

- Current deployed path: streaming transport and chunked TTS playback; LLM still waits for ASR final, but LLM tokens now feed a phrase chunker and TTS queue without waiting for complete LLM text.
- Next path: incremental ASR utterance boundary -> incremental LLM -> phrase chunker -> incremental TTS queue.

Main latency goal:

- Stop speaking to first playable audio: target `<= 1500ms`, stretch `<= 1000ms` on scripted Fire/Volcengine fixture.
- Barge-in local stop: target `<= 200ms`; server stale audio after abort: `0`.
- Product-experience spot checks are not development gates and should only run when explicitly requested by the user.

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
- LLM token reading continues while first phrase TTS synthesis is still active; TTS does not block the LLM stream.
- Abort cancels TTS queue and no stale generation audio is yielded.
- No user-operated Watch testing.

Completed evidence:
- Created `scripts/deep-response/pipeline/phrase-chunker.mjs`.
- Created `scripts/deep-response/pipeline/tts-queue.mjs`.
- Added `VoicePipeline.streamCascadeTurn()` for mock ASR/LLM/TTS cascade.
- Reworked `VoicePipeline.streamCascadeTurn()` to run LLM token reading and phrase TTS concurrently through internal async queues, while preserving ordered phrase synthesis.
- Added regression coverage proving the second LLM text delta is emitted while the first phrase TTS stream is still open.
- Verified:

```bash
node --test scripts/deep-response/pipeline/voice-pipeline.test.mjs scripts/deep-response/pipeline/phrase-chunker.test.mjs scripts/deep-response/pipeline/tts-queue.test.mjs scripts/deep-response-server.test.mjs
node --test scripts/deep-response-watch-ui.test.mjs scripts/test-deep-response-streaming-provider.test.mjs scripts/deep-response/pipeline/voice-pipeline.test.mjs scripts/deep-response/pipeline/phrase-chunker.test.mjs scripts/deep-response/pipeline/tts-queue.test.mjs scripts/deep-response-server.test.mjs
```

Latest local result:
- `node --test scripts/deep-response/pipeline/voice-pipeline.test.mjs`: `7/7` passed.
- `node --test scripts/deep-response-server.test.mjs`: `23/23` passed.
- `node --test scripts/test-deep-response-http-smoke.test.mjs scripts/test-deep-response-http-conversation.test.mjs scripts/test-deep-response-cascade-provider.test.mjs`: `8/8` passed.
- `npm run test:node`: `123/123` passed.

Latest Fire/Volcengine deployment:
- `npm run deep:volc:deploy`: remote `HEAD` at `d017e17`, service `active`, health `200`.
- `npm run deep:http-smoke:test -- --endpoint http://124.174.96.149:8797 --pcm /private/tmp/deep-response-http-speed.pcm --turns 2 --chunk-ms 1000 --upload-sleep-ms 1000 --poll-ms 50 --timeout-ms 120000 --observe-ms 3000 --max-stop-to-first-audio-ms 3000 --retries 1 --pipeline-mode cascade`: passed.
- Remote stop-to-first-audio: `2408ms`, `1730ms`.
- Remote abort stale audio chunks/bytes: `0` / `0`.
- Remote idle lifecycle: session ended in `195ms` with reason `idle_timeout`; late audio upload returned `409 session_ended`.

Latest quote-boundary optimization:
- Added provider probe timing fields:
  - `first_phrase_after_transcript_final_ms`
  - `first_audio_after_first_phrase_ms`
- Added quote-intro phrase boundary so text such as `那你可以听听这句话：“...` can speak the lead-in before waiting for the full scripture quote.
- Preserved unfinished scripture reference protection.
- `npm run test:node`: `124/124` passed.
- `npm run deep:cascade:provider:test -- --pcm /private/tmp/deep-response-http-speed.pcm --turns 3 --replay-interval-ms 20 --phrase-max-chars 24`: passed.
- Provider-side timing after quote-boundary optimization:
  - `first_phrase_after_transcript_final_ms`: `783ms`, `704ms`, `851ms`
  - `first_audio_after_transcript_final_ms`: `1238ms`, `1153ms`, `1341ms`
  - `first_audio_after_first_phrase_ms`: `455ms`, `449ms`, `490ms`
- Fire/Volcengine note: ECS GitHub fetch failed twice due outbound TLS/connectivity errors, so this verification used direct SSH file sync for the four changed script files after commit `b4b110a` had been pushed to GitHub.
- Fire/Volcengine HTTP cascade smoke after direct sync: passed.
- Remote stop-to-first-audio after direct sync: `1702ms`, `1331ms`.
- Remote abort stale audio chunks/bytes: `0` / `0`.
- Remote idle lifecycle: session ended in `198ms` with reason `idle_timeout`; late audio upload returned `409 session_ended`.

Latest short-first-sentence prompt optimization:
- Constrained complete-reply prompt so the first spoken sentence should be `6-14` Chinese characters, daily spoken style, and not a direct scripture quote.
- Preserved one-complete-AI-reply flow; no `first/more`, JSON, or template first phrase was reintroduced.
- `node --test scripts/deep-response/pipeline/voice-pipeline.test.mjs`: `7/7` passed.
- `npm run test:node`: `124/124` passed.
- `npm run deep:cascade:provider:test -- --pcm /private/tmp/deep-response-http-speed.pcm --turns 3 --replay-interval-ms 20 --phrase-max-chars 24`: passed.
- Provider-side timing after short-first-sentence prompt:
  - `first_phrase_after_transcript_final_ms`: `940ms`, `630ms`, `588ms`
  - `first_audio_after_transcript_final_ms`: `1383ms`, `1058ms`, `1061ms`
  - `first_audio_after_first_phrase_ms`: `443ms`, `428ms`, `473ms`
- Fire/Volcengine note: ECS GitHub fetch still failed due outbound TLS/connectivity errors, so this verification used direct SSH file sync for the two changed pipeline files after commit `45b5231` had been pushed to GitHub.
- Fire/Volcengine HTTP cascade smoke after direct sync: passed.
- Remote stop-to-first-audio after direct sync: `1328ms`, `1175ms`.
- Remote abort stale audio chunks/bytes: `0` / `0`.
- Remote idle lifecycle: session ended in `222ms` with reason `idle_timeout`; late audio upload returned `409 session_ended`.

Latest HTTP timing breakdown:
- Added HTTP probe receive-side timing fields so remote smoke can distinguish phrase arrival from first audio arrival:
  - `http_stop_to_first_phrase_ms`
  - `http_stop_to_first_audio_ms`
  - `http_first_audio_after_first_phrase_ms`
- `npm run test:node`: `125/125` passed.
- `npm run deep:http-smoke:test -- --endpoint http://124.174.96.149:8797 --pcm /private/tmp/deep-response-http-speed.pcm --turns 2 --chunk-ms 1000 --upload-sleep-ms 1000 --poll-ms 50 --timeout-ms 120000 --observe-ms 3000 --max-stop-to-first-audio-ms 3000 --retries 1 --pipeline-mode cascade`: passed.
- Remote stop-to-first-audio with timing breakdown: `1050ms`, `1034ms`.
- Remote HTTP stop-to-first-phrase: `795ms`, `690ms`.
- Remote HTTP first-audio-after-first-phrase: `255ms`, `344ms`.
- Current timing implication: after ASR final, the larger remaining controllable cost is first phrase generation / event arrival, not TTS first audio.

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
- No user-operated Watch testing as a gate.

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

Status: completed for self-test gate. No user-operated Watch test was requested.

Purpose:
- Validate that the DeepLab Watch client is ready to consume cascade events/audio without UI or playback regressions, using source checks, builds, simulator autoruns where possible, and HTTP smoke tests before any product-experience spot check.

Implementation:
- Update Watch Lab only when event schema or cascade mode requires it.
- Ensure session creation requests `pipelineMode: "cascade"`.
- Ensure streaming `assistant_text_delta` events append instead of replacing the displayed reply.
- Install only if a final experience check becomes necessary.
- Keep single-reply fallback available.

Self-test validation:

```bash
node --test scripts/deep-response-watch-ui.test.mjs
xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build
npm run deep:http-smoke:test -- --endpoint http://124.174.96.149:8797 --pcm /private/tmp/deep-response-http-speed.pcm --turns 2 --chunk-ms 1000 --upload-sleep-ms 1000 --poll-ms 50 --timeout-ms 120000 --observe-ms 3000 --max-stop-to-first-audio-ms 3000 --retries 1 --pipeline-mode cascade
```

Product-experience spot check:
- Not a gate.
- Only run if explicitly requested by the user after self-tests pass.

Acceptance:
- Source tests prove cascade mode and streaming delta accumulation.
- Watch build passes.
- Remote Fire/Volcengine cascade smoke remains under the current timing gate.
- If real playback is later checked and stutters while script tests are clean, fix Watch audio queue before advancing product integration.

Completed evidence:
- Updated `DeepResponseRealtimeClient.ensureHTTPSession()` to request `pipelineMode: "cascade"`.
- Updated HTTP session `assistant_text_delta` handling to append streaming deltas instead of replacing `god:` text.
- Added source-level Watch regression tests for cascade session mode and delta accumulation.
- Verified:

```bash
node --test scripts/deep-response-watch-ui.test.mjs
npm run test:node
DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build
npm run deep:http-smoke:test -- --endpoint http://124.174.96.149:8797 --pcm /private/tmp/deep-response-http-speed.pcm --turns 2 --chunk-ms 1000 --upload-sleep-ms 1000 --poll-ms 50 --timeout-ms 120000 --observe-ms 3000 --max-stop-to-first-audio-ms 3000 --retries 1 --pipeline-mode cascade
```

Latest results:
- `scripts/deep-response-watch-ui.test.mjs`: `3/3` passed.
- `npm run test:node`: `105/105` passed.
- `DeepResponseWatchLab` generic watchOS build: `BUILD SUCCEEDED`.
- Fire/Volcengine cascade smoke: `2/2` turns ok.
- stop-to-first audio: `1385ms`, `1234ms`.
- abort stale audio chunks/bytes: `0` / `0`.

Latest Watch HTTP polling optimization:
- Changed `DeepResponseWatchLab` HTTP session polling to use `40ms` before first audio and return to `120ms` after first audio is received.
- This keeps the Watch transport HTTP-only while reducing client-side first-audio wait from the previous fixed `120ms` poll delay.
- Added source gate proving low-latency first-audio polling constants and helper are present.
- `node --test scripts/deep-response-watch-ui.test.mjs`: `13/13` passed.
- `npm run test:node`: `126/126` passed.
- `DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build`: `BUILD SUCCEEDED`.
- Fire/Volcengine HTTP cascade smoke baseline after this Watch-only change: passed.
- Remote stop-to-first-audio baseline: `1039ms`, `1681ms`.
- Remote HTTP stop-to-first-phrase: `788ms`, `1341ms`.
- Remote HTTP first-audio-after-first-phrase: `251ms`, `340ms`.
- Timing implication: Watch client first-audio polling is now less likely to add avoidable delay; remaining larger variance is still provider first-phrase generation.

Latest HTTP long-poll optimization:
- Added `wait_ms` support to HTTP session `/events` and `/audio` pull endpoints. Existing no-`wait_ms` clients keep immediate short-poll behavior.
- `DeepResponseWatchLab` now sends `wait_ms=800` before first audio and `wait_ms=250` after first audio while staying HTTP-only.
- Node conversation/smoke scripts now accept and pass `--wait-ms`, defaulting to `800`, so remote self-tests cover the same HTTP pull mode as Watch.
- Added server tests proving events/audio requests remain pending until a new event/audio chunk arrives.
- Added Watch source gate proving events/audio URLs include `wait_ms`.
- `node --test scripts/deep-response-server.test.mjs`: `25/25` passed.
- `node --test scripts/deep-response-watch-ui.test.mjs`: `13/13` passed.
- `node --test scripts/test-deep-response-http-conversation.test.mjs scripts/test-deep-response-http-smoke.test.mjs`: `6/6` passed.
- `npm run test:node`: `128/128` passed.
- `DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build`: `BUILD SUCCEEDED`.
- Fire/Volcengine ECS was updated by direct SSH file sync and `systemctl restart deep-response`; `/health` returned provider mode with `providerConfigured: true`.
- Fire/Volcengine HTTP cascade smoke with `--wait-ms 800`: passed.
- Remote stop-to-first-audio with long-poll: `1039ms`, `1088ms`.
- Remote HTTP stop-to-first-phrase with long-poll: `992ms`, `983ms`.
- Remote HTTP first-audio-after-first-phrase with long-poll: `46ms`, `105ms`.
- Remote abort stale audio chunks/bytes: `0` / `0`.
- Remote idle probe: `session_end` reason `idle_timeout`, late audio rejected with `409 session_ended`.
- Validation mode remains self-test first; no user-operated Watch test is required for this milestone update.

Latest partial-ASR cascade optimization:
- `VoicePipeline.streamCascadeTurn()` now starts LLM token streaming from a usable ASR partial transcript before ASR final, while still emitting final transcript and using final transcript for `turn_done`.
- Added a mock-provider test proving assistant text, phrase, and first audio can be emitted before ASR final is released.
- Tightened partial-start threshold so very short fragments do not start LLM too early.
- Fixed `/audio` pull to hide already-buffered audio for canceled generations, preserving local-first abort semantics after partial-ASR can create audio before input-stop/abort.
- Added server regression test for buffered stale audio after abort.
- `node --test scripts/deep-response/pipeline/voice-pipeline.test.mjs`: `8/8` passed.
- `node --test scripts/deep-response-server.test.mjs`: `26/26` passed.
- `npm run test:node`: `130/130` passed.
- `DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build`: `BUILD SUCCEEDED`.
- Fire/Volcengine ECS was updated by direct SSH file sync and `systemctl restart deep-response`; `/health` returned provider mode with `providerConfigured: true`.
- Fire/Volcengine HTTP cascade smoke with `--wait-ms 800`: passed.
- Remote turns reported `llm_started_from_partial: 1`.
- Remote stop-to-first-audio after partial-ASR: `240ms`, `228ms`.
- Remote HTTP stop-to-first-phrase after partial-ASR: `93ms`, `87ms`.
- Remote HTTP first-audio-after-first-phrase after partial-ASR: `147ms`, `141ms`.
- Remote abort stale audio chunks/bytes: `0` / `0`.
- Remote idle probe: `session_end` reason `idle_timeout`, late audio rejected with `409 session_ended`.
- Validation mode remains self-test first; no user-operated Watch test is required for this milestone update.

Latest short spoken-reply optimization:
- Removed the previous two-step `first/more` business flow from the active experience; the active cascade path remains one real AI reply.
- Tightened the complete-reply prompt to request 1 sentence, at most 2 sentences, and about 45 Chinese characters.
- Reduced cascade `maxTokens` to `72` and added a stream-level `maxSpokenReplyChars` default of `48` so text/audio that would exceed the spoken reply budget is not queued to Watch.
- Changed cascade `assistant_text_delta` semantics to expose spoken phrase deltas only, so the Watch UI does not display text that will not be spoken.
- Added regression tests proving over-budget LLM tail text is not emitted as assistant text, phrase, or audio, and timing marks `reply_truncated_for_length`.
- `node --test scripts/deep-response/pipeline/voice-pipeline.test.mjs scripts/deep-response-server.test.mjs`: `37/37` passed.
- `npm run test:node`: `136/136` passed.
- `DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build`: `BUILD SUCCEEDED`.
- Fire/Volcengine ECS was updated by direct SSH file sync and `systemctl restart deep-response`; `/health` returned provider mode with `providerConfigured: true`.
- Fire/Volcengine HTTP cascade smoke with `--wait-ms 800`: passed.
- Remote turns reported `llm_started_from_partial: 1`.
- Remote stop-to-first-audio after short spoken-reply optimization: `191ms`, `200ms`.
- Remote HTTP stop-to-first-phrase after short spoken-reply optimization: `71ms`, `71ms`.
- Remote HTTP first-audio-after-first-phrase after short spoken-reply optimization: `121ms`, `129ms`.
- Remote audio chunks were bounded for concise voice interaction: `32`, `35`.
- Remote abort stale audio chunks/bytes: `0` / `0`.
- Remote idle probe: `session_end` reason `idle_timeout`, late audio rejected with `409 session_ended`.
- Validation mode remains self-test first; no user-operated Watch test is required for this milestone update.

Latest comfort-intent relevance guard:
- Added prompt constraints so when the user asks for comfort, the reply must directly comfort the user's feeling.
- Explicitly blocked turning a comfort request into a Bible trivia question, guessing game, story opener, light test, or "which Bible book / verse should we start with" handoff unless the user asks for Bible study.
- Added `--forbid-text-pattern` to `scripts/test-deep-response-http-smoke.mjs` so remote smoke can fail on obvious derailment patterns without user-operated Watch testing.
- Added tests for repeated forbidden reply regex parsing and failure collection.
- `node --test scripts/deep-response/pipeline/voice-pipeline.test.mjs scripts/test-deep-response-http-smoke.test.mjs`: `12/12` passed.
- `npm run test:node`: `138/138` passed.
- Fire/Volcengine ECS was updated by direct SSH file sync and `systemctl restart deep-response`; `/health` returned provider mode with `providerConfigured: true`.
- Fire/Volcengine HTTP cascade smoke with comfort-intent forbidden patterns passed:
  - forbidden patterns: `大卫.*歌利亚`, `你知道.*为什么`, `从哪卷书|哪卷书.*开始|哪句经文.*开始`.
  - Remote stop-to-first-audio: `204ms`, `199ms`.
  - Remote abort stale audio chunks/bytes: `0` / `0`.
  - Remote idle probe: `session_end` reason `idle_timeout`, late audio rejected with `409 session_ended`.
- This is a narrow automated relevance guard, not a claim that all reply-quality issues are solved.

Latest idle gentle-goodbye self-test:
- Added optional HTTP session `idleGoodbye` behavior. When enabled, idle timeout first emits a short assistant goodbye text/audio turn, then emits `session_end` with reason `idle_timeout`.
- Default behavior remains unchanged unless `idleGoodbye` is requested or `DEEP_RESPONSE_SESSION_IDLE_GOODBYE` is set.
- Idle goodbye events use their own `turn_idle_*` / `gen_idle_*` IDs and segment `idle_goodbye`.
- Added server regression coverage proving `assistant_text_delta`, `assistant_phrase`, audio chunk, `audio_done idle_goodbye_complete`, `timing`, `turn_done`, and then `session_end idle_timeout` are emitted in order.
- Extended HTTP smoke with `--idle-goodbye` so Fire/Volcengine remote tests can require real idle goodbye text/audio before session end.
- Added one more comfort-intent prompt guard for the observed derailment pattern "想从哪里开始听".
- `node --test scripts/deep-response/pipeline/voice-pipeline.test.mjs scripts/deep-response-server.test.mjs scripts/test-deep-response-http-smoke.test.mjs`: `42/42` passed.
- `npm run test:node`: `140/140` passed.
- `DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build`: `BUILD SUCCEEDED`.
- Fire/Volcengine ECS was updated by direct SSH file sync and `systemctl restart deep-response`; `/health` returned provider mode with `providerConfigured: true`.
- Fire/Volcengine HTTP cascade smoke with `--idle-goodbye` and comfort-intent forbidden patterns passed:
  - Remote stop-to-first-audio: `195ms`, `174ms`.
  - Remote idle goodbye text: `我先安静到这里，愿你平安。拜拜。`
  - Remote idle goodbye audio chunks/bytes: `23` / `185610`.
  - Remote abort stale audio chunks/bytes: `0` / `0`.
  - Remote idle late audio rejected with `409 session_ended`.
  - No user-operated Watch testing was required.

### Milestone S5: Hands-Free Conversation Loop

Status: complete for the self-test gate. Server-side goodbye/idle lifecycle, remote smoke self-tests, Watch automatic return-to-listening source/build gate, local VAD/silence endpointing source/build gate, VAD fixture calibration, explicit Watch conversation state source gate, simulator-only continuous HTTP fixture autorun source gate, local 8-turn rolling-context/goodbye self-test, and remote 8-turn session-end probe are complete.

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

Self-test validation:
- Script 8-turn session with context and goodbye.
- Script idle timeout and gentle goodbye.
- Abort test still passes.

Product-experience spot check:
- Not a phase gate.
- Only run if explicitly requested by the user after script/simulator/build validation passes.

Acceptance:
- Continuous conversation feels coherent.
- No reconnect per turn.
- Barge-in local stop target `<= 500ms` by user perception; script stale audio remains `0`.

Completed evidence:
- Added automatic HTTP session end on goodbye transcript intent such as `拜拜` / `再见` / `结束对话`.
- Added configurable `idleTimeoutMs` to HTTP session creation and automatic `session_end` with reason `idle_timeout`.
- Ended sessions reject late audio uploads with HTTP `409` and `session_ended`.
- Extended HTTP smoke to include remote idle lifecycle validation.
- Added `DeepResponseAudioPlayer.onPlaybackDrained` and queued playback drain tracking.
- Updated `DeepResponseAudioPlayer.stop()` to detach the player node before future playback reprepare, avoiding abort/replay attach crashes.
- Added `DeepResponseRealtimeClient.onHTTPSessionPlaybackDrained`, playback-active tracking, and `session_end` event handling.
- Added DeepLab continuous-mode toggle that can automatically start the next HTTP recording turn after assistant playback drains, while stopping the loop on abort or server session end.
- Added `DeepResponseMicrophoneRecorder.Configuration` with endpointing controls for local silence detection.
- Added local PCM16 voice-activity measurement and idempotent silence callback emission.
- Wired DeepLab continuous mode so recorder silence automatically calls `finishRecordingTurn(reason: "Auto silence")`.
- Removed unused Watch-side WebSocket client/delegate/message encoder from `DeepResponseWatchLab`; Watch Lab is HTTP-only at the code level.
- Added explicit `DeepResponseConversationState` in DeepLab with `listening`, `userSpeaking`, `assistantSpeaking`, `bargeIn`, `idleWaiting`, and `ended` states.
- Added local 8-turn HTTP session self-test covering rolling context, automatic goodbye-intent `session_end`, and late audio `409 session_ended`.
- Extended the HTTP conversation probe with `--end-reason`, `--expect-session-end`, and `--expect-late-audio-409` for reusable remote session lifecycle validation.
- Added Watch VAD calibration fixtures that parse the Swift threshold and verify digital silence / low room noise stay below threshold while quiet speech / normal speech exceed it.
- Added simulator-only `DEEP_RESPONSE_AUTORUN_CONTINUOUS_FIXTURE` source gate that runs three HTTP fixture turns through the Watch client and ends in an explicit loop completion state.
- Verified:

```bash
node --test scripts/deep-response-server.test.mjs
node --test scripts/deep-response/lib/watch-vad-calibration.test.mjs
node --test scripts/test-deep-response-http-conversation.test.mjs
node --test scripts/test-deep-response-http-smoke.test.mjs
node --test scripts/deep-response-watch-ui.test.mjs
npm run test:node
DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build
npm run deep:volc:deploy
npm run deep:http-smoke:test -- --endpoint http://124.174.96.149:8797 --pcm /private/tmp/deep-response-http-speed.pcm --turns 2 --chunk-ms 1000 --upload-sleep-ms 1000 --poll-ms 50 --timeout-ms 120000 --observe-ms 3000 --idle-timeout-ms 150 --idle-observe-ms 2000 --max-stop-to-first-audio-ms 3000 --retries 1 --pipeline-mode cascade
node scripts/test-deep-response-http-conversation.mjs --endpoint http://124.174.96.149:8797 --pcm /private/tmp/deep-response-http-speed.pcm --turns 8 --chunk-ms 1000 --upload-sleep-ms 0 --poll-ms 50 --timeout-ms 120000 --pipeline-mode cascade --end-reason user_goodbye --expect-session-end --expect-late-audio-409
```

Latest results:
- `scripts/deep-response-server.test.mjs`: `23/23` passed.
- `scripts/deep-response/lib/watch-vad-calibration.test.mjs`: `3/3` passed.
- `scripts/test-deep-response-http-conversation.test.mjs`: `3/3` passed.
- `scripts/test-deep-response-http-smoke.test.mjs`: `2/2` passed.
- `scripts/deep-response-watch-ui.test.mjs`: `12/12` passed.
- `npm run test:node`: `122/122` passed.
- `DeepResponseWatchLab` generic watchOS build: `BUILD SUCCEEDED`.
- Fire/Volcengine deployment: remote `HEAD` at `5f3a0e3`, service `active`, health `200`.
- Fire/Volcengine smoke: `ok: true`.
- stop-to-first audio: `1681ms`, `1546ms`.
- abort stale audio chunks/bytes: `0` / `0`.
- idle session ended in `193ms` with reason `idle_timeout`; late audio upload returned `409 session_ended`.
- Fire/Volcengine 8-turn conversation probe: `ok: true`, elapsed `41981ms`, `session_end` reason `user_goodbye`, late audio `409 session_ended`, per-turn stop-to-first audio roughly `2494ms` to `3121ms`.

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

Status update 2026-06-04:
- Implemented an async in-session `memory_candidate` event after `session_end`.
- The candidate is generated from bounded session history after the session has ended, marked `persisted: false`, and is not part of the first-audio path.
- Added server regression coverage proving `memory_candidate` appears after `session_end`, includes the session summary, turn count, end reason, and does not require user-operated Watch input.
- Extended the HTTP conversation probe with `--expect-memory-candidate`; the script handles `session_end` and `memory_candidate` arriving in the same event batch.
- Fire/Volcengine remote S6 probe passed:
  - `session_end` reason: `memory_probe_complete`.
  - `memory_candidate` seq followed `session_end` seq.
  - `memory_candidate.persisted`: `false`.
  - `memory_candidate.turnCount`: `2`.
  - late audio after end returned `409 session_ended`.
  - stop-to-first-audio during the same probe: `202ms`, `203ms`.
- Fire/Volcengine full HTTP smoke after memory candidate change passed:
  - conversation `ok: true`.
  - `llm_started_from_partial: 1`.
  - stop-to-first-audio: `207ms`, `218ms`.
  - abort stale audio chunks/bytes: `0` / `0`.
  - idle timeout and late audio rejection passed.
- Verification:
  - `node --test scripts/deep-response-server.test.mjs`: `27/27` passed.
  - `node --test scripts/test-deep-response-http-conversation.test.mjs`: `5/5` passed.
  - `npm run test:node`: `132/132` passed.
  - `DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build`: `BUILD SUCCEEDED`.
  - Remote `node scripts/test-deep-response-http-conversation.mjs --endpoint http://124.174.96.149:8797 --pcm /private/tmp/deep-response-http-speed.pcm --turns 2 --chunk-ms 1000 --upload-sleep-ms 1000 --poll-ms 50 --wait-ms 800 --timeout-ms 120000 --pipeline-mode cascade --end-reason memory_probe_complete --expect-session-end --expect-late-audio-409 --expect-memory-candidate`: passed.
  - Remote `npm run deep:http-smoke:test -- --endpoint http://124.174.96.149:8797 --pcm /private/tmp/deep-response-http-speed.pcm --turns 2 --chunk-ms 1000 --upload-sleep-ms 1000 --poll-ms 50 --wait-ms 800 --timeout-ms 120000 --observe-ms 3000 --max-stop-to-first-audio-ms 3000 --retries 1 --pipeline-mode cascade`: passed.

Integration gate update 2026-06-04:
- Added `docs/superpowers/plans/2026-06-04-deep-response-integration-gate.md`.
- Current integration status is explicitly blocked until user approval.
- The gate requires:
  - Quick Response main flow stays untouched.
  - DeepResponseWatchLab remains the active test package.
  - Watch transport remains HTTP-only.
  - No WebSocket feasibility or fallback work.
  - Feature flag before any main app entry.
  - Rollback tag before integration.
  - Product-experience spot check is optional and user-requested.
- Added `scripts/deep-response-integration-gate.test.mjs` to keep the gate machine-checkable against current code boundaries.
- Verification:
  - `node --test scripts/deep-response-integration-gate.test.mjs`: `2/2` passed.
  - `npm run test:node`: `134/134` passed.
  - `DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build`: `BUILD SUCCEEDED`.

S6 memory persistence update 2026-06-04:
- Added optional JSONL persistence for async memory candidates using `DEEP_RESPONSE_MEMORY_JSONL_PATH`.
- Default behavior remains `persisted: false` when no memory store path is configured.
- When configured, the server appends one JSON object per candidate and emits `memory_candidate` with:
  - `persisted: true`
  - `store: "jsonl"`
  - `path: <configured JSONL path>`
- Added local regression coverage proving the JSONL file is written, contains the session id, end reason, summary, turn count, and `persisted: true`.
- Extended `scripts/test-deep-response-http-conversation.mjs` with `--expect-memory-persisted` so remote probes can require `memory_candidate.persisted === true` and a non-empty store.
- Fire/Volcengine ECS was configured with:
  - `DEEP_RESPONSE_MEMORY_JSONL_PATH=/opt/deep-response/memory/deep-response-memory.jsonl`
- Verification:
  - `node --test scripts/deep-response-server.test.mjs scripts/test-deep-response-http-conversation.test.mjs`: `35/35` passed.
  - `npm run test:node`: `141/141` passed.
  - `DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build`: `BUILD SUCCEEDED`.
  - Remote `node scripts/test-deep-response-http-conversation.mjs --endpoint http://124.174.96.149:8797 --pcm /private/tmp/deep-response-http-speed.pcm --turns 2 --chunk-ms 1000 --upload-sleep-ms 1000 --poll-ms 50 --wait-ms 800 --timeout-ms 120000 --pipeline-mode cascade --end-reason memory_persist_probe --expect-session-end --expect-late-audio-409 --expect-memory-candidate --expect-memory-persisted`: passed.
  - Remote memory candidate reported `persisted: true`, `store: "jsonl"`, and path `/opt/deep-response/memory/deep-response-memory.jsonl`.
  - Remote JSONL tail confirmed a persisted row for session `drs_a76b0b0064d046dd98df9bf113915bb8`.
- Integration remains blocked by the explicit integration gate until user approval; this update does not touch Quick Response.

S6 memory recall update 2026-06-04:
- Added bounded JSONL memory recall at HTTP session creation using the existing `DEEP_RESPONSE_MEMORY_JSONL_PATH`.
- New sessions load recent persisted memory candidates into one `system` context message:
  - default recall limit: `3`
  - hard cap: `8`
  - optional override: `DEEP_RESPONSE_MEMORY_RECALL_LIMIT`
- Session creation response now includes `memoryRecallCount`.
- Session event stream emits `memory_recalled` when persisted memory was loaded.
- Memory recall is best-effort: missing files or invalid JSONL lines do not block session creation.
- Memory recall is not re-persisted as user text: `buildHTTPSessionMemoryCandidate()` now filters persisted summaries to `user` / `assistant` messages only.
- Verification:
  - RED test first failed because `memoryRecallCount` was missing.
  - Targeted GREEN test passed after implementation: `DeepResponse HTTP session recalls recent persisted JSONL memory into new sessions`.
  - `node --test scripts/deep-response-server.test.mjs`: `31/31` passed.
  - `npm run test:node`: `142/142` passed.
  - `DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-memory-recall-build build`: `BUILD SUCCEEDED`.
  - Fire/Volcengine session create returned `memoryRecallCount: 1`.
  - Fire/Volcengine events included `memory_recalled` with `count: 1`, `store: "jsonl"`.
  - Fire/Volcengine HTTP cascade smoke with idle goodbye and forbidden-pattern gates passed.
  - Remote stop-to-first-audio remained fast: `183ms`, `202ms`.
  - Remote abort stale audio chunks/bytes stayed `0` / `0`.
  - Remote idle goodbye emitted text/audio and late audio was rejected with `409 session_ended`.
- Development remained self-test only; no user-operated Watch testing was required.
- Integration remains blocked by the explicit integration gate until user approval; this update does not touch Quick Response.

S6 memory recall probe update 2026-06-04:
- Extended `scripts/test-deep-response-http-conversation.mjs` with `--expect-memory-recalled`.
- The probe now verifies memory recall through the same self-test path used for remote conversation validation:
  - session creation must return `memoryRecallCount > 0`
  - the event stream must emit `memory_recalled`
  - the final JSON summary includes `memoryRecalled`
- This replaces ad hoc curl checks as the normal Fire/Volcengine recall gate.
- Verification:
  - RED test first failed on unknown `--expect-memory-recalled` and missing `memoryRecalled` collection.
  - `node --test scripts/test-deep-response-http-conversation.test.mjs`: `5/5` passed.
  - `node --test scripts/test-deep-response-http-conversation.test.mjs scripts/deep-response-server.test.mjs`: `36/36` passed.
  - `npm run test:node`: `142/142` passed.
  - Remote `node scripts/test-deep-response-http-conversation.mjs --endpoint http://124.174.96.149:8797 --pcm /private/tmp/deep-response-http-speed.pcm --turns 2 --chunk-ms 1000 --upload-sleep-ms 1000 --poll-ms 50 --wait-ms 800 --timeout-ms 120000 --pipeline-mode cascade --end-reason memory_recall_probe --expect-memory-recalled --expect-session-end --expect-late-audio-409 --expect-memory-candidate --expect-memory-persisted`: passed.
  - Remote `memoryRecalled.count`: `3`.
  - Remote `memory_candidate.persisted`: `true`.
  - Remote stop-to-first-audio: `203ms`, `206ms`.
  - Remote late audio after end returned `409 session_ended`.
- Development remained self-test only; no user-operated Watch testing was required.
- Integration remains blocked by the explicit integration gate until user approval; this update does not touch Quick Response.

S6 memory recall dedupe update 2026-06-04:
- Added exact-summary dedupe to the JSONL memory recall loader.
- Recall now scans recent JSONL rows from newest to oldest, skips duplicate summaries, and restores chronological order for the final context block.
- This keeps repeated fixture/session summaries from bloating prompt context and reduces repeated assistant behavior.
- Added regression coverage proving duplicate persisted summaries are recalled once while older unique memories remain available.
- Verification:
  - RED test first failed because repeated summaries produced `memoryRecallCount: 3`.
  - `node --test scripts/deep-response-server.test.mjs --test-name-pattern "deduplicates repeated persisted memory recall"`: passed.
  - `node --test scripts/deep-response-server.test.mjs scripts/test-deep-response-http-conversation.test.mjs`: `37/37` passed.
  - `npm run test:node`: `143/143` passed.
  - Fire/Volcengine service restarted with the server update; health returned `200`.
  - Remote `node scripts/test-deep-response-http-conversation.mjs --endpoint http://124.174.96.149:8797 --pcm /private/tmp/deep-response-http-speed.pcm --turns 2 --chunk-ms 1000 --upload-sleep-ms 1000 --poll-ms 50 --wait-ms 800 --timeout-ms 120000 --pipeline-mode cascade --end-reason memory_dedupe_probe --expect-memory-recalled --expect-session-end --expect-late-audio-409 --expect-memory-candidate --expect-memory-persisted`: passed.
  - Remote `memoryRecalled.count`: `3`.
  - Remote stop-to-first-audio: `222ms`, `211ms`.
  - Remote full HTTP smoke with idle goodbye and forbidden-pattern gates passed; abort stale audio remained `0` / `0`.
  - `DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-memory-dedupe-build build`: `BUILD SUCCEEDED`.
- Development remained self-test only; no user-operated Watch testing was required.
- Integration remains blocked by the explicit integration gate until user approval; this update does not touch Quick Response.

Product gate:
- Only after S1-S5 self-tests pass and any explicitly requested final experience check is acceptable.
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
- Watch transport is HTTP only.
- Do not reintroduce Watch socket transport work.
- iPhone is not in the realtime path.
- `http-turn-v2` remains as fallback and regression baseline.

## Final Milestone Plan

The earlier A-G list is consolidated into four milestones. The rule is: do not ask for user-operated Watch testing as a milestone gate. Exhaust script/local/Fire validation and automated Watch build/simulator checks. Product-experience spot checks are not part of phase progression.

### Milestone 1: Provider And Server Harness

Status: completed.

Purpose:
- Prove progressive provider behavior and HTTP session semantics without Watch.
- Reduce risk before any optional final experience check.

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
- Add local and Fire/Volcengine script tests.

Expected effect:
- A Node script can simulate Watch.
- It can upload fixture chunks, stop input, receive transcript/text/audio events, and verify first audio arrives before final timing.
- It can simulate abort and stale generation drop.
- It can run multi-turn and goodbye/idle flows without a real Watch.

Self-test validation:
- `npm run test:node`
- `npm run deep:streaming:provider:test`
- `npm run deep:http-session:test` locally
- `npm run deep:volc:deploy`
- `npm run deep:http-session:test -- --endpoint http://124.174.96.149:8797`

Product-experience spot check:
- None.

Gate:
- Do not start Watch code until this milestone passes locally and on Fire/Volcengine.

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

Self-test validation:
- Swift build succeeds.
- Local mock server or Fire/Volcengine script verifies endpoints.
- Source-level tests verify UI and transport behavior where possible.

Product-experience spot check:
- Not a gate.
- Only run if explicitly requested by the user after self-tests pass.

### Milestone 3: Continuous Conversation Runtime

Status: complete for the self-test gate.

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
- Fire/Volcengine two-turn script probe.
- Watch client session reuse across repeated manual mic turns.
- Server-side goodbye intent closes the session.
- Server-side idle timeout closes the session.
- Fire/Volcengine smoke validates conversation, abort, and idle lifecycle.

Remaining:

- None for the current self-test gate. A real Watch product-experience spot check remains optional and user-requested, not a development gate.

Expected effect:
- AI speaks, then returns to listening.
- User can continue several turns in the same session.
- Server remembers recent user emotion/topic and avoids obvious repetition.
- User can say goodbye.
- Idle timeout produces a gentle close.

Self-test validation:
- `deep:http-session:test` covers at least 8 script-driven turns.
- Script tests cover user goodbye.
- Script tests cover idle goodbye.
- Fire/Volcengine endpoint passes the same session tests.

Product-experience spot check:
- Not a gate.
- Only run if explicitly requested by the user after self-tests pass.

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
- Fire/Volcengine abort script probe.
- Watch local playback stop before POST `/abort`.
- Watch canceled generation audio filtering.

Remaining:

- None for the current self-test gate. In continuous Lab mode, abort now resumes the next recording turn immediately after local/server abort succeeds.

Expected effect:
- While AI is speaking, user can start speaking and old audio stops quickly.
- Old response never leaks into the new turn.
- Session closes with transcript/summary/memory candidate.

Self-test validation:
- Script test proves abort and stale generation drop.
- Fire/Volcengine script passes abort test.
- Watch build and simulator/source checks are ready.

Product-experience spot check:
- Not a gate.
- Only run if explicitly requested by the user after self-tests pass.

Product gate:
- Only after Milestone 4 do we discuss hidden entry or product integration.
- Quick Response remains untouched until explicit approval.

Latest Watch local-first abort timing gate:
- Added Watch-side abort timing traces in `DeepResponseWatchLab`:
  - `local <ms>` records elapsed time from abort tap to local `player.stop()`.
  - `server <ms>` records elapsed time from abort tap to `/abort` response.
  - `stale <count>` records canceled-generation audio chunks filtered after abort.
- The Watch client records local stop immediately before canceling the poll task and before the network `/abort` call completes.
- The compact debug UI displays the abort timing line through `client.lastAbortTimingText`.
- Added source-level regression coverage proving local-first timing, server timing, stale-audio counting, and UI display fields exist without adding any Watch WebSocket path.
- Verification:
  - `node --test scripts/deep-response-watch-ui.test.mjs`: `14/14` passed.
  - `npm run test:node`: `137/137` passed.
  - `DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build build`: `BUILD SUCCEEDED`.
  - Fire/Volcengine HTTP cascade smoke with `--wait-ms 800`: passed.
  - Remote stop-to-first-audio: `215ms`, `212ms`.
  - Remote abort stale audio chunks/bytes: `0` / `0`.
  - Remote idle probe: `session_end` reason `idle_timeout`, late audio rejected with `409 session_ended`.
  - No user-operated Watch testing was required.

Latest Watch continuous barge-in resume gate:
- Changed DeepLab continuous mode so tapping abort during assistant playback keeps continuous mode active and starts a new recording turn after local-first abort succeeds.
- Non-continuous abort still ends in the listening state.
- Added source-level regression coverage proving:
  - `abortCurrentTurn()` captures `shouldResumeListening = isContinuousMode`.
  - continuous abort no longer sets `isContinuousMode = false`.
  - successful continuous abort calls `startRecordingTurn(reason: "Barge-in recording")`.
- Verification:
  - RED source test first failed because `abortCurrentTurn()` disabled continuous mode.
  - `node --test scripts/deep-response-watch-ui.test.mjs`: `15/15` passed.
  - `npm run test:node`: `144/144` passed.
  - `DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-bargein-resume-build build`: `BUILD SUCCEEDED`.
  - Fire/Volcengine HTTP cascade smoke with `--wait-ms 800`, idle goodbye, and forbidden-pattern gates passed.
  - Remote stop-to-first-audio: `196ms`, `192ms`.
  - Remote abort stale audio chunks/bytes: `0` / `0`.
  - Remote idle goodbye emitted text/audio and late audio was rejected with `409 session_ended`.
  - No user-operated Watch testing was required.

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

## Phase 3: Product Integration Decision

Goal: decide how to merge DeepResponse into the real app without risking old stable behavior.

Preconditions:
- DeepLab HTTP session streaming passes automated self-tests and any explicitly requested final experience check.
- HTTP v2 fallback remains available and covered by regression checks.
- Barge-in behaves acceptably.
- Fire/Volcengine deploy and env sync are documented.

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

- Fire/Volcengine deploy:
  - `npm run deep:volc:deploy`

- Watch build:
  - `xcodebuild -project Focus.xcodeproj -scheme DeepResponseWatchLab -configuration Debug -destination generic/platform=watchOS -derivedDataPath /private/tmp/focus-deepresponse-volc-build DEEP_RESPONSE_REALTIME_ENDPOINT=http://124.174.96.149:8797 build`

- Watch install:
  - Not a default gate. Install only when the user explicitly requests a product-experience spot check.

## What Can Be Verified Without User

- All Node unit tests.
- Provider credential/config checks.
- Provider streaming benchmark from fixtures.
- Local HTTP session streaming script.
- Fire/Volcengine HTTP session streaming script.
- Watch app build.
- Fire/Volcengine deploy and `/health` / `/debug/config`.
- Watch source-level UI/transport checks.
- Watch simulator autoruns where available.

## What Should Not Require User By Default

- Normal phase progression.
- Provider validation.
- Server deployment validation.
- HTTP session timing and abort validation.
- Watch build validation.
- Watch UI source-level regression checks.

## Product-Experience Spot Checks

Not a development gate. Only ask the user if the user explicitly requests a real wrist experience check after self-tests pass:

- Real microphone permission and live mic capture.
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
  - `checkpoint/YYYY-MM-DD-deeplab-volc-streaming`
  - `checkpoint/YYYY-MM-DD-deeplab-watch-streaming`
- Do not modify old stable app flow unless entering Phase 3 with explicit approval.
