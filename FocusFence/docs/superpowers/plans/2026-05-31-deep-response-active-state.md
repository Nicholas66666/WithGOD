# Deep Response Active State

更新：2026-06-05 Asia/Shanghai

这个文件是 Deep Response 开发的持久上下文入口。每次上下文压缩、换会话、长时间中断后，先读本文件，再继续开发。

## Current Goal

实现 Apple Watch 上的小智式持续语音会话：

```text
Watch 持续会话
-> 用户一句
-> AI 流式听、流式想、流式说
-> AI 说完继续 listening
-> 用户可中途打断
-> 多轮共享 session context
-> 用户告别或长时间 idle 后自然结束
-> transcript / summary / memory candidate 异步保存
```

## Non-Negotiable Decisions

- DeepResponse 独立于 Quick Response。
- Quick Response 老包稳定流程不能被 DeepResponse POC 破坏。
- 当前开发分支：`codex/deep-response-lab`。
- 当前测试包：`DeepResponseWatchLab` / `DeepLab`。
- Watch 端 transport 固定使用 HTTP。
- 完全不再考虑 Watch WebSocket；不做 spike、fallback、benchmark、比较路线或可行性验证。
- DeepResponse server 不暴露 client-facing WebSocket upgrade；Watch/server transport 只走 HTTP sessions。
- Server 内部连接 Doubao ASR/TTS 可以继续使用 provider 所需的 WebSocket。
- iPhone 不参与核心实时链路。
- 完全采用自测试模式；用户人工 Watch 真机测试不作为阶段计划、推进条件或验收门槛。
- 每个阶段通过后提交并推送。

## Current Canonical References

- SPEC: `docs/superpowers/specs/2026-05-29-deep-response-xiaozhi-poc-spec.md`
- Main plan: `docs/superpowers/plans/2026-05-31-deep-response-true-streaming.md`
- Integration gate: `docs/superpowers/plans/2026-06-04-deep-response-integration-gate.md`
- Product integration decision: `docs/superpowers/plans/2026-06-05-deep-response-product-integration-decision.md`
- Fire/Volcengine endpoint: `http://124.174.96.149:8797`
- Stable old-app baseline tag: `baseline/2026-05-30-presence-stable-deeplab-isolated`

## Current Product Decision

DeepResponse remains in the independent Lab target.

- Do not integrate into Quick Response.
- Do not add DeepResponseDebugView to PresenceWatchApp.
- Do not add a visible DeepResponse entry to the stable Watch app.
- Do not change Quick Response recording, upload, response generation, playback, routing, or persistence behavior.
- Future product integration requires explicit user approval, a separate implementation plan, a default-off feature flag, and a rollback tag.

## Current Verified State

Latest pushed commits:

- `77a9228` Gate DeepResponse harsh comfort phrasing.
- `75eabe8` Gate DeepResponse repetitive conversation phrasing.
- `e2cfc5e` Gate DeepResponse continuous conversation self-test.
- `a9e9884` Gate DeepResponse comfort reply style.
- `e1652bd` Gate DeepResponse partial ASR streaming.
- `9b7b66c` Add DeepResponse Watch loop state self-test.
- `8d9f193` Gate DeepResponse repeated replies.
- `3ca01b1` Record DeepResponse benchmark model deployment.
- `006347b` Use benchmark-selected DeepResponse Ark model.
- `4dac218` Add DeepResponse LLM benchmark harness.
- `1388a67` Add DeepResponse product integration decision gate.
- `b85d374` Record DeepResponse HTTP-only server deployment evidence.
- `cf342b5` Remove client-facing DeepResponse WebSocket server path.
- `ddfd509` Remove Watch WebSocket spike from DeepResponse self-test surface.

Latest standard self-test:

```bash
npm run deep:selftest:full
```

Latest result:

- Node self-tests: `206/206` passed.
- Fire/Volcengine HTTP smoke: passed with identical-consecutive-reply, lookup-style-comfort, harsh repeated-comfort, mechanical tired/fatigue, incomplete-utterance, `是还想听`, formulaic scripture lead-in, awkward spoken-opening, and dangling `啦。` gates enabled.
- Fire/Volcengine memory recall: `count: 3`, `store: jsonl`.
- Fire/Volcengine debug config: `arkModel: doubao-seed-character-251128`, `arkFallbackModel: ""`.
- Fire/Volcengine partial-ASR LLM start: `llm_started_from_partial: 1` on both standard smoke turns.
- Fire/Volcengine smoke stop-to-first-audio: `204ms`, `221ms`.
- Fire/Volcengine repeated reply failures: `[]`.
- Fire/Volcengine forbidden lookup/harsh/mechanical comfort failures: `[]`.
- Fire/Volcengine abort stale audio chunks/bytes: `0` / `0`.
- Fire/Volcengine idle memory candidate: `persisted: true`, `store: jsonl`, `reason: idle_timeout`, `summary: ""`, `closureClean: true`.
- Fire/Volcengine 8-turn continuous conversation gate now uses realtime upload pacing (`--upload-sleep-ms 1000`) and `--max-stop-to-first-audio-ms 1000`.
- Fire/Volcengine 8-turn continuous conversation gate: passed with `session_end` reason `user_goodbye`, `memoryRecalled.count: 3`, `memory_candidate.persisted: true`, `forbiddenTextFailures: []`, `repeatedOpeningStemFailures: []`, full-session `repeatedReplyFailures: []`, `longReplyFailures: []`, `shortReplyFailures: []`, `stopToFirstAudioFailures: []`, `partialStartFailures: []`, `audioBeforeTurnDoneFailures: []`, and late audio `409 session_ended`.
- Fire/Volcengine 8-turn stop-to-first-audio: `229ms`, `225ms`, `217ms`, `225ms`, `241ms`, `221ms`, `236ms`, `230ms`.
- DeepResponseWatchLab build: `BUILD SUCCEEDED`.
- Latest WatchLab barge-in self-test update: continuous-mode abort now captures the old `turn_id` / `generation_id`, stops playback locally, starts barge-in recording before waiting for the `/abort` server ack, and posts the abort in the background. Full `npm run deep:selftest:full` passed after this change; no user-operated Watch test was required.
- Latest WatchLab late-abort/session-end gate: continuous-mode state machine now keeps the session ended if a delayed `/abort` ack arrives after `session_end`; it must not start another `barge_in` recording after the server has closed the session. `DeepResponseDebugView.abortCurrentTurn()` now checks `client.isHTTPSessionEnded` again after awaiting the background abort task in the continuous barge-in branch and calls `markSessionEnded()` if closure arrived during the new recording start. Source and state-machine gates cover this out-of-order event path; no user-operated Watch test was required.
- Latest WatchLab active-recorder session-end gate: if `session_end` arrives while continuous mode has already restarted local recording, the scriptable state machine now emits `stop_recording` before `stop_auto_listen` / `finalize_session_end`, and `DeepResponseDebugView.markSessionEnded()` stops `recorder` before clearing `isRecording`. This prevents hands-free closure from leaving the mic/audio session active after server goodbye or idle end. Source and state-machine gates cover this lifecycle edge; no user-operated Watch test was required.
- Latest dangling `啦。` quality gate: full self-test exposed a remote spoken-text artifact like `我听见你真的累了。啦。...`; `VoicePipeline.streamCascadeTurn()` now removes dangling `啦` particles after tired-opening normalization before emitting assistant text, phrase events, or TTS audio. Standard Fire/Volcengine smoke and 8-turn conversation gates now forbid `啦。`; latest `npm run deep:selftest:full` passed with `forbiddenTextFailures: []`. No user-operated Watch test was required.
- Latest S6 memory closure-sanitization gate: async memory candidates and recalled persisted summaries now filter goodbye-only closure lines such as `拜拜`, `再见`, `结束对话`, `bye`, and simple assistant goodbye acknowledgements. A regression test first proved that a useful prior turn followed by `拜拜` polluted memory summaries; the server now keeps the useful memory while excluding the closure exchange. Fire/Volcengine ECS was updated by direct file sync and full `npm run deep:selftest:full` passed. No user-operated Watch test was required.
- Latest S6 idle-goodbye memory gate: idle timeout still speaks the gentle goodbye, but async memory candidates now filter the assistant-only idle goodbye line `我先安静到这里，愿你平安。拜拜。` so it does not become recalled long-term memory. A regression test first proved the idle goodbye polluted the summary after a useful prior turn; the server now preserves the useful memory and removes the closure line. Fire/Volcengine ECS was updated by direct file sync and full `npm run deep:selftest:full` passed. No user-operated Watch test was required.
- Latest remote idle-memory summary gate: the standard Fire/Volcengine HTTP smoke probe now returns `memoryCandidate.summary` and `closureClean`, and fails if the idle-goodbye closure text appears in persisted memory. Full `npm run deep:selftest:full` passed with remote idle `closureClean: true`; no user-operated Watch test was required.
- Latest WatchLab HTTP-only endpoint gate: `DeepResponseRealtimeClient.endpointURL()` now rejects configured endpoints whose scheme is not `http` or `https`, and no longer maps `wss` to `https`. Source gates assert the WatchLab config layer has no `ws/wss` scheme case while preserving `https` for HTTP transport. Full `npm run deep:selftest:full` passed; no user-operated Watch test was required.
- Latest WatchLab empty-recording recovery gate: continuous mode now keeps the hands-free loop alive when a recording turn produces no local audio and no uploaded chunks. `finishRecordingTurn()` restarts `Auto listening` instead of dropping to `listening`, and the scriptable state machine covers the same `empty_recording` path. Full `npm run deep:selftest:full` passed; no user-operated Watch test was required.
- Latest WatchLab continuous-off recording gate: turning continuous mode off while recording now stops the local recorder, clears waiting state, and returns the loop to `listening` instead of leaving the mic active. The scriptable state machine emits `stop_recording`, Swift source gates cover `toggleContinuousMode()`, and full `npm run deep:selftest:full` passed. No user-operated Watch test was required.
- Latest WatchLab teardown cleanup gate: leaving `DeepResponseDebugView` now calls `client.stopHTTPSessionRuntime()`, which cancels the HTTP session poll task, stops local playback, clears playback-active state, and disables abort controls. Source gates cover the view teardown and client cleanup path; full `npm run deep:selftest:full` passed. No user-operated Watch test was required.
- Latest WatchLab upload-drain cleanup gate: HTTP audio upload draining is now owned by `httpUploadDrainTask`; starting a new turn cancels any previous drain task, and teardown cancels the drain task, clears queued/pending audio, and marks upload draining inactive. Source gates cover task ownership and teardown cleanup; full `npm run deep:selftest:full` passed. No user-operated Watch test was required.
- Latest WatchLab reusable-session cleanup gate: `stopHTTPSessionRuntime()` now clears `httpSessionID`, turn/generation identity, audio sequence, and event/audio cursors so leaving and re-entering DeepLab creates a fresh HTTP session instead of reusing a possibly ended server session. The RED source gate first failed on missing `httpSessionID = nil`; full `npm run deep:selftest:full` passed with Node `206/206`, Fire/Volcengine smoke `204ms` / `221ms`, 8-turn stop-to-first-audio `229ms`, `225ms`, `217ms`, `225ms`, `241ms`, `221ms`, `236ms`, `230ms`, and WatchLab `BUILD SUCCEEDED`. No user-operated Watch test was required.
- Latest WatchLab state self-test update: continuous-mode runtime now has an explicit `assistantThinking` state between user speech ending and playback becoming active. This separates “server/AI is thinking” from idle waiting and assistant speaking in the scriptable Watch state model and Swift source gate.
- Latest WatchLab ending-state self-test update: continuous-mode runtime now includes an explicit `ending` state before final `ended` when a server session end is observed. This makes the Watch state model match the planned listening/user-speaking/assistant-thinking/assistant-speaking/idle-waiting/ending/ended lifecycle and blocks auto-listen during session closure.
- Latest spoken-text quality gate: VoicePipeline strips dangling quote lead-ins such as trailing `主说：`, `他说：`, `经上说：`, and `圣经说：` before emitting assistant text, phrase events, or TTS audio. Standard Fire/Volcengine smoke and 8-turn conversation scripts now also reject assistant text that ends with `:` or `：`.
- Latest full-session repetition gate: the 8-turn conversation probe now treats `--forbid-identical-consecutive-replies` as a full-session identical-reply ban, not only an adjacent-turn ban. VoicePipeline prompt now lists recent assistant replies and explicitly forbids repeating any recent reply, whole scripture sentence, or full comfort structure.
- Latest overlong-reply gate: VoicePipeline drops an overlong quoted scripture phrase after a short spoken lead-in instead of queueing it to Watch audio. The standard 8-turn Fire/Volcengine conversation gate now runs with `--max-assistant-reply-chars 48` and reports `longReplyFailures: []`. Full `npm run deep:selftest:full` passed after direct ECS sync; no user-operated Watch test was required.
- Latest long-tail first-audio gate: the 8-turn Fire/Volcengine conversation probe now supports `--max-stop-to-first-audio-ms` and the standard gate now uses `2500ms` after repeated Fire/Volcengine runs stayed below roughly `2.2s`. `VoicePipeline` also rotates high-frequency comfort opening stems such as `我在` after one recent use. Full `npm run deep:selftest:full` passed; no user-operated Watch test was required.
- Latest formulaic scripture lead-in gate: VoicePipeline strips book-name and generic lead-ins such as `《诗篇》里说`, `经上说`, `圣经说`, `主说`, `神说`, and `耶稣说` before assistant text/audio emission. Standard Fire/Volcengine smoke and 8-turn conversation gates now forbid those patterns; full `npm run deep:selftest:full` passed after direct ECS sync with `forbiddenTextFailures: []`. No user-operated Watch test was required.
- Latest natural spoken-opening gate: VoicePipeline normalizes meta/awkward comfort openings such as `那来句贴心的`, `那来靠一靠`, `那听这句：`, and `那缓缓神吧` before assistant text/audio emission. Standard Fire/Volcengine smoke and 8-turn conversation gates now forbid `那来|来句|听这句|缓缓神`. A follow-up self-test exposed that server history retention at 12 messages could hide early repeated opening stems during the 8-turn gate; retention is now 20 messages, and the 8-turn server test asserts turn 8 still sees turns 1-7. Full `npm run deep:selftest:full` passed after direct ECS sync with `forbiddenTextFailures: []` and `repeatedOpeningStemFailures: []`. No user-operated Watch test was required.
- Latest realtime-upload latency gate: Standard Fire/Volcengine 8-turn continuous conversation now simulates real Watch microphone streaming with `--upload-sleep-ms 1000`, not burst upload with `0ms`. The gate was tightened from `2500ms` to `1000ms`, and full `npm run deep:selftest:full` passed with 8-turn stop-to-first-audio `212ms`, `205ms`, `211ms`, `201ms`, `198ms`, `202ms`, `194ms`, `199ms`. This remains HTTP-only and self-tested; no user-operated Watch test was required.
- Latest audio-before-turn-done streaming gate: Standard Fire/Volcengine 8-turn continuous conversation now requires `--expect-audio-before-turn-done`; the probe fails if first audio is missing or arrives at/after `turn_done`, so a buffered full-turn response cannot masquerade as true streaming. A follow-up full self-test exposed a complete but too-short remote reply `我陪你慢下来。`, so `VoicePipeline.streamCascadeTurn()` now applies the minimum spoken length fallback even when LLM ends normally, not only when a long reply is truncated. Latest `npm run deep:selftest:full` passed with Node `192/192`, `audioBeforeTurnDoneFailures: []`, `partialStartFailures: []`, `shortReplyFailures: []`, and 8-turn stop-to-first-audio `192ms`, `181ms`, `189ms`, `186ms`, `192ms`, `188ms`, `178ms`, `171ms`. No user-operated Watch test was required.

Latest remote deployment note:

- `npm run deep:volc:deploy` can fail because ECS -> GitHub fetch sometimes hits `GnuTLS recv error (-110)`.
- When that happens, use direct SSH file sync for changed files, restart `deep-response`, then run the remote source gate and smoke.
- Latest remote source gate after cleanup: `node --test scripts/deep-response-integration-gate.test.mjs`: `5/5` passed on ECS.
- Latest `/health`: `200`, `mode: provider`, `providerConfigured: true`.

Latest LLM selection benchmark:

- Benchmark harness: `scripts/deep-response-benchmark.mjs --samples ...`
- Benchmark helper: `scripts/deep-response/lib/llm-benchmark.mjs`
- Spec: `docs/superpowers/specs/2026-05-31-deep-response-llm-selection-benchmark-spec.md`
- Results: `docs/deep-response-llm-benchmark-results.md`
- Current provisional primary candidate: `doubao-seed-character-251128`, prompt variant `S`.
- Initially configured Ark 2.0 models were rejected for realtime DeepResponse because first-token and first-phrase latency were far outside the voice target.
- Latest one-row provider smoke against `doubao-seed-character-251128` recorded first token `506ms`, conservative first phrase `965ms`, and output passed automatic content checks. One-row smoke is only a CLI/provider-path check, not a model-selection conclusion.
- Runtime/default model config now uses `ARK_MODEL=doubao-seed-character-251128` and `ARK_FALLBACK_MODEL=`. The old `doubao-seed-2-0-pro-260215` fallback is not a default because it failed realtime latency gates.
- Fire/Volcengine `/debug/config` after deploying `006347b` reports `arkModel: "doubao-seed-character-251128"` and `arkFallbackModel: ""`.
- Standard Fire/Volcengine smoke now requires `/debug/config` to match that model/fallback pair via `--expect-ark-model doubao-seed-character-251128 --expect-ark-fallback-model ""`.
- This is a self-test/model-selection gate only; it does not introduce Watch WebSocket, user-operated Watch validation, or product integration.
- Standard Fire/Volcengine smoke and 8-turn conversation gates forbid identical assistant replies anywhere in the same session via `--forbid-identical-consecutive-replies`.
- Standard Fire/Volcengine smoke requires every conversation turn to start LLM from usable ASR partial via `--expect-llm-started-from-partial`.
- Standard Fire/Volcengine 8-turn conversation gate requires realtime upload pacing via `--upload-sleep-ms 1000`, every turn to start LLM from usable ASR partial via `--expect-llm-started-from-partial`, first audio to arrive before `turn_done` via `--expect-audio-before-turn-done`, stop-to-first-audio within `1000ms`, and assistant replies within `8..48` spoken characters via `--min-assistant-reply-chars 8` and `--max-assistant-reply-chars 48`, preventing placeholder-length replies such as `那停一下吧。` from passing self-test.
- The LLM prompt now explicitly quotes recent assistant replies when present and forbids repeating any of them, including when the user repeats the same request.
- Standard Fire/Volcengine smoke now rejects lookup-style, harsh repeated-comfort, mechanical tired/fatigue, incomplete-utterance, and stale followup replies such as `给你找一句`, `再给你读一句`, `你还想听`, `你还是想听`, `你又想听`, `喊累`, `没说完`, `只说想听`, `是还想听`, `你还是觉得累`, `你又累`, and `你又感到疲惫`.
- Standard Fire/Volcengine smoke and 8-turn conversation gates now reject meta/awkward spoken openings such as `那来`, `来句`, `听这句`, and `缓缓神`.
- The complete-reply prompt now requires comfort-intent turns to directly承接情绪 instead of opening as a scripture lookup or repeating the user's "想听安慰" request.
- Standard `deep:selftest:full` now includes an 8-turn Fire/Volcengine continuous conversation gate with memory recall/persist, explicit user-goodbye session end, late-audio rejection, repeated-opening-stem rejection, full-session identical-reply rejection, and lookup/harsh/mechanical/incomplete-utterance/stale-followup text rejection.
- Server memory recall sanitizes lookup-style, harsh, mechanical tired/fatigue, incomplete-utterance, and stale-followup comfort phrases before placing persisted summaries into LLM context.
- VoicePipeline normalizes lookup-style, harsh repeated-comfort, mechanical tired/fatigue openings, incomplete-utterance misreads, dangling modal particles, and dangling quote lead-ins before emitting assistant text, phrase events, or TTS audio.
- VoicePipeline can add a short non-scripture fallback phrase when length truncation would leave only a placeholder-length spoken reply; this is enabled for HTTP cascade sessions with `DEEP_RESPONSE_CASCADE_MIN_SPOKEN_CHARS` defaulting to `8`.

## Standard Commands

Full local/remote/build gate:

```bash
npm run deep:selftest:full
```

Node-only gate:

```bash
npm run test:node
```

Fire/Volcengine smoke:

```bash
npm run deep:volc:smoke:full
```

Fire/Volcengine continuous 8-turn conversation:

```bash
npm run deep:volc:conversation:full
```

WatchLab build against Fire/Volcengine:

```bash
npm run deep:watchlab:build:volc
```

Integration/source gate:

```bash
node --test scripts/deep-response-integration-gate.test.mjs
```

Provider credential check:

```bash
npm run deep:provider:check
```

LLM model benchmark smoke:

```bash
npm run deep:provider:benchmark -- \
  --samples data/deep-response/llm-benchmark/samples.jsonl \
  --candidates data/deep-response/llm-benchmark/candidates.json \
  --out-dir /tmp/deep-response-llm-smoke \
  --models doubao-seed-character-251128 \
  --sample-ids ordinary-001 \
  --prompt-variants S
```

## Completed Capabilities

- Mock-provider cascade pipeline with `phrase-chunker`, `tts-queue`, and `VoicePipeline.streamCascadeTurn()`.
- Real provider cascade harness with Doubao ASR, Ark LLM token streaming, and Doubao TTS streaming.
- Standard remote partial-ASR regression gate: conversation turns fail smoke if `llm_started_from_partial` is missing.
- Fire/Volcengine HTTP session cascade.
- WatchLab HTTP upload, long-poll event pull, HTTP audio pull, local-first abort, and compact diagnostics.
- Continuous conversation self-test gate: multi-turn context, goodbye intent, idle goodbye, late audio rejection.
- Fire/Volcengine continuous 8-turn gate is part of the standard full self-test.
- Watch continuous-loop state-machine self-test: auto-listen after playback drain, immediate auto-listen without queued playback, barge-in resume, and session-end stop.
- Watch barge-in local-first self-test: continuous-mode `abort_requested` starts recording before server abort ack while preserving stale generation discard.
- Watch assistant-thinking self-test: continuous mode enters `assistantThinking` while waiting for server response before playback starts.
- Watch ending-state self-test: continuous mode enters `ending` during server session closure before final `ended`.
- Memory candidate generation, JSONL persistence, recall, dedupe, and remote probe gates.
- Quick Response source guard for `Sources/PresenceWatchApp` and `Sources/PresenceApp`.
- Client-facing DeepResponse WebSocket server path removed.
- Watch WSS echo spike scripts removed from standard development and self-test surface.
- S6 product integration decision artifact added and machine-checked.

## Current Work Rules

Before implementation:

1. Read this file.
2. Read `docs/superpowers/plans/2026-05-31-deep-response-true-streaming.md`.
3. Check `git status --short`.
4. Confirm branch is `codex/deep-response-lab`.

During implementation:

1. Use TDD for behavior changes.
2. Use local Node tests, scripted harnesses, Fire/Volcengine smoke, source gates, simulator/source checks, and watchOS builds as the validation path.
3. Keep changes scoped to DeepResponse / DeepResponseWatchLab / docs / tests unless explicit product integration approval is given.
4. Do not touch Quick Response main flow.
5. Do not add Watch WebSocket or client-facing DeepResponse WebSocket transport.
6. Commit and push after each passing increment.
7. Do not ask the user to operate Apple Watch as a planned validation step.

## User Involvement Policy

用户人工 Watch 真机测试不作为阶段计划、推进条件或验收门槛。

Only ask the user for a real Watch product-experience spot check if:

- all relevant self-tests have already passed;
- the check cannot be represented by scripts, source gates, simulator/source checks, or builds;
- the request is bundled into one clear checklist with what to do, what should happen, and what to report.
