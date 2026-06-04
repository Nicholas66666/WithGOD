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

- Node self-tests: `167/167` passed.
- Fire/Volcengine HTTP smoke: passed with identical-consecutive-reply, lookup-style-comfort, harsh repeated-comfort, and mechanical tired/fatigue gate enabled.
- Fire/Volcengine memory recall: `count: 3`, `store: jsonl`.
- Fire/Volcengine debug config: `arkModel: doubao-seed-character-251128`, `arkFallbackModel: ""`.
- Fire/Volcengine partial-ASR LLM start: `llm_started_from_partial: 1` on both standard smoke turns.
- Fire/Volcengine stop-to-first-audio: `235ms`, `236ms`.
- Fire/Volcengine repeated reply failures: `[]`.
- Fire/Volcengine forbidden lookup/harsh/mechanical comfort failures: `[]`.
- Fire/Volcengine abort stale audio chunks/bytes: `0` / `0`.
- Fire/Volcengine idle memory candidate: `persisted: true`, `store: jsonl`, `reason: idle_timeout`.
- Fire/Volcengine 8-turn continuous conversation gate: passed with `session_end` reason `user_goodbye`, `memoryRecalled.count: 3`, `memory_candidate.persisted: true`, `forbiddenTextFailures: []`, and late audio `409 session_ended`.
- DeepResponseWatchLab build: `BUILD SUCCEEDED`.

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
- Standard Fire/Volcengine smoke also forbids identical adjacent assistant replies in the same session via `--forbid-identical-consecutive-replies`.
- Standard Fire/Volcengine smoke requires every conversation turn to start LLM from usable ASR partial via `--expect-llm-started-from-partial`.
- The LLM prompt now explicitly quotes the previous assistant reply when present and forbids repeating it, including when the user repeats the same request.
- Standard Fire/Volcengine smoke now rejects lookup-style, harsh repeated-comfort, and mechanical tired/fatigue replies such as `给你找一句`, `再给你读一句`, `你还想听`, `你还是想听`, `你又想听`, `喊累`, `你还是觉得累`, `你又累`, and `你又感到疲惫`.
- The complete-reply prompt now requires comfort-intent turns to directly承接情绪 instead of opening as a scripture lookup or repeating the user's "想听安慰" request.
- Standard `deep:selftest:full` now includes an 8-turn Fire/Volcengine continuous conversation gate with memory recall/persist, explicit user-goodbye session end, late-audio rejection, and lookup/harsh/mechanical comfort text rejection.
- Server memory recall sanitizes lookup-style, harsh, and mechanical tired/fatigue comfort phrases before placing persisted summaries into LLM context.
- VoicePipeline normalizes lookup-style, harsh repeated-comfort, and mechanical tired/fatigue openings before emitting assistant text, phrase events, or TTS audio.

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
