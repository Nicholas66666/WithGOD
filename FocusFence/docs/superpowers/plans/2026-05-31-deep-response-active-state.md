# Deep Response Active State

更新：2026-05-31 13:05 Asia/Shanghai

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
- 老包稳定流程不能被 DeepResponse POC 破坏。
- 当前开发分支：`codex/deep-response-lab`。
- 当前测试包：`DeepResponseWatchLab` / `DeepLab`。
- Watch 端 primary transport 是 HTTP。
- Watch WebSocket 不是主线；只允许做隔离 feasibility spike。
- iPhone 不参与核心实时链路。
- Server 内部连接 Doubao ASR/TTS 可以继续使用 WebSocket。
- `http-turn-v2` 是已通过真机验收的 fallback baseline。
- 每个阶段通过后提交并推送。

## Important References

- SPEC: `docs/superpowers/specs/2026-05-29-deep-response-xiaozhi-poc-spec.md`
- Implementation plan: `docs/superpowers/plans/2026-05-31-deep-response-true-streaming.md`
- Render service: `https://withgod-deep-response.onrender.com`
- Render service id: `srv-d8dbodsm0tmc73dp7560`
- Watch device id: `6B873DBC-11D7-5F93-AA64-96FB0531C28B`
- Stable old-app baseline tag: `baseline/2026-05-30-presence-stable-deeplab-isolated`
- DeepLab v2 client checkpoint: `checkpoint/2026-05-30-deeplab-phase2a-v2-client-build`

## Proven Baseline

Real Watch + Render + provider chain has passed:

- Health/probe/echo HTTP diagnostics.
- `http-turn-v2`.
- Watch mic recording.
- Doubao ASR transcript.
- Ark LLM first/followup text.
- Doubao TTS natural Chinese playback.
- Watch sequential playback: first then more.
- Compact DeepLab validation UI.

Representative successful timing:

```text
asr 2885ms
llm 6160ms
tts 629ms
more llm 6185ms
more tts 650ms
```

## Current Progress

Milestone 1 server/provider harness is implemented and self-tested as of commit `62335c3`.

Completed:

- Added HTTP session runtime under `/deep-response/sessions`.
- Added audio chunk upload, event cursor, audio cursor, input-stop, abort, end endpoints.
- Added stale generation drop on abort.
- Added multi-turn and explicit end server tests.
- Added `scripts/test-deep-response-http-session.mjs`.
- Added `scripts/test-deep-response-streaming-provider.mjs`.
- Deployed server change to Render.
- Verified remote session create/event/audio upload smoke.
- Verified provider harness with generated speech fixture:
  - transcript: `我今天有点累，想听一句安慰的话`
  - asr final: `1871ms`
  - llm first phrase: `6683ms`
  - tts first audio: `418ms`
  - first playable estimate: `8972ms`
  - total: `19238ms`
- Verified Render HTTP session with same fixture:
  - transcript: `我今天有点累，想听一句安慰的话`
  - audio chunks: `43`
  - audio bytes: `316874`
  - provider timing total: `19624ms`

Important finding:

- Provider and HTTP session path works, but first phrase quality still needs tuning. One provider harness run produced an incomplete first phrase: `耶稣说：“凡劳苦担重担的人，可以`。Do not treat first-phrase policy as done.

Current implementation milestone is **Milestone 2: Watch HTTP Transport Lab**.

Do not ask user to test until Watch code is built, installed, and local/Render endpoints have already been self-checked.

Implemented in current working tree:

- DeepLab live mic frame upload over HTTP session.
- Serial HTTP upload queue to preserve PCM chunk order.
- Event/audio puller over HTTP session polling.
- Compact UI for session state, chunks up/down/bytes, transcript/text/timing.
- Server audio chunk response includes `sampleRate: 24000`.
- Server-side `VoicePipeline.streamSegmented()` now exposes transcript and first segment before followup finishes.
- HTTP session server now pushes first text/audio as soon as first TTS is done instead of waiting for full followup.
- Watch session playback now coalesces audio chunks from a pull batch into one PCM buffer to reduce small-buffer stutter.

Verified before manual Watch test:

- `npm run test:node`: 75 passing.
- `xcodebuild -scheme DeepResponseWatchLab -destination generic/platform=watchOS`: build succeeded.

Still pending before asking user:

- Commit and push the scoped Milestone 2 changes.
- Deploy Render if server behavior changed.
- Self-test Render HTTP session after deploy.
- Install DeepLab on Watch when device is connected.

Latest real Watch feedback before the streaming fix:

- HTTP session transport passed: `http_session:done`, up/down chunks increased, transcript often correct.
- Playback bug observed once: repeated first syllable and early cutoff (`听听听`).
- Latency was still too high because server only exposed session audio after full `runSegmented()` completed.
- One turn returned empty `you:`; keep watching this as ASR/upload completeness diagnostic.

Acceptance:

- Swift build passes.
- Render endpoints are reachable.
- Watch app installs only when device is connected.
- Manual Watch Gate 1: user confirms chunks upload while recording, event/audio pull reaches Watch, audio plays, and UI is readable.
- Manual Watch Gate 2: user confirms first playable audio behavior is better than full JSON fallback or identifies current latency bottleneck.
- No old app changes.

## Development Rhythm

Before implementation:

1. Read this file.
2. Read the implementation plan.
3. Check `git status --short`.
4. Confirm branch is `codex/deep-response-lab`.

During implementation:

1. Prefer local scripts and Node tests.
2. Keep changes scoped to DeepResponse files.
3. Do not touch Quick Response main flow.
4. Commit after each passing phase.
5. Push every commit.
6. Tag meaningful checkpoints before risky integration.

Before asking user to test:

1. Run available local tests.
2. Deploy Render if server behavior changed.
3. Self-test remote endpoints with scripts.
4. Build Watch app if Watch code changed.
5. Install only when device is connected.
6. Tell user exactly what to tap, what to expect, and what to report.

## Manual Test Gates

User is only needed for:

- Real Watch install/launch when device is reachable.
- Real microphone capture.
- Real speaker/AirPods playback.
- UI legibility on Watch.
- Perceived latency and naturalness.
- Barge-in feel.
- Multi-turn session feel.
- Idle/goodbye feel.

Everything else should be validated by scripts, simulator, local server, Render endpoint checks, or unit tests.

## WebSocket Spike Rules

Do not start this unless HTTP cannot meet first-playback or abort goals.

If started, it must:

1. Test only Watch real-device WSS binary echo/audio.
2. Avoid ASR/LLM/TTS.
3. Activate `AVAudioSession` before opening WebSocket.
4. Configure Watch audio background mode.
5. Ignore simulator success as validation.
6. Run 3-5 minutes on real Watch.
7. Validate local-first abort and stale generation drop.
8. Never block HTTP mainline.
