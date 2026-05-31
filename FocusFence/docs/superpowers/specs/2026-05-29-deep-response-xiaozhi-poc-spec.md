# Deep Response Xiaozhi-Style Voice POC Spec

日期：2026-05-29
更新：2026-05-31，目标升级为小智式持续语音会话。

## 目标

Deep Response 的最终目标不是“一次录音请求”或“单轮语音回复”，而是“小智式持续语音会话”：

```text
用户进入 Deep Response
-> Watch 建立持续 realtime session
-> 用户说一句
-> AI 流式听、流式想、流式说一句
-> 用户可以等 AI 说完，也可以中途打断
-> AI 停止旧输出，继续听用户下一句
-> session 保留本次上下文和可控记忆
-> 直到用户主动告别，或长时间安静后 AI 温和告别并结束
```

主力技术方向是“小智式级联语音链路”：

```text
Watch streaming audio
-> Streaming ASR
-> Streaming LLM
-> Streaming TTS
-> Watch streaming playback
```

POC 的目标不是先做完整产品，而是验证在真实 Apple Watch 场景下，是否能达到强情绪/祷告陪伴所需的语音流畅性：

- 用户说完后 1-2 秒内听到第一句属灵陪伴语音。
- 用户打断时，旧语音能立即停止。
- 多轮连续对话自然，不明显卡顿、断流或上下文错乱。
- 同一个 session 内可以持续“一句接一句”对话，不要求用户每轮重新进入或重新建连接。
- AI 说话时用户可以插话，系统必须把这视为正常 turn-taking，而不是异常错误。
- session 内 AI 记得前文，不重复问刚问过的问题，不忘记用户刚表达的情绪和祷告内容。
- session 结束后生成 transcript / summary / memory，异步持久化，供历史回看和后续 Deep Response 参考。
- 长时间没有用户输入时，AI 可以先轻声确认一次，随后温和告别并关闭 session。
- 用户明确说“拜拜”“好了”“先这样”“结束吧”等结束意图时，AI 应完成简短告别并关闭 session。
- Watch / iPhone / server 的分工由实测指标决定，但首版 POC 不把 iPhone 放进核心实时链路。
- 开发过程尽可能用本地电脑、脚本、模拟器完成验证；只有必须验证 Watch 真机麦克风、网络、播放、功耗或佩戴体验时，才要求人工配合真机测试。
- Phase 1 可以使用固定音频/echo audio，但必须做得很薄，只作为 Watch/server 双向音频、播放、打断、旧音频丢弃的通道验收，不发展成另一条产品路线。
- 公网 WSS 是最终必验项，但第一步不直接公网；先本地脚本和模拟器高频验证，再进入公网 Watch 真机验收。

## 非目标

本 POC 不做：

- Quick Response 主流程重构。
- iPhone 作为实时语音 relay。
- 完整小智 manager-api / manager-web / MySQL / Redis 体系迁移。
- MCP、RAG、工具调用进入第一句首响路径。
- 本地 Watch ASR / LLM / TTS。
- 长篇灵修讲章式回答。
- 小智完整后台体系迁移。
- 生产级长期记忆检索进入首响路径。
- 在 POC 期把 Deep Response 合并进 Quick Response 主状态机。

这里的“本地 Watch ASR / LLM / TTS”指在 Apple Watch 本机运行语音识别、语言模型或语音合成模型。Deep Response 首版 POC 默认这些能力都在 server/provider 侧完成。Watch 本地只做和实时体感直接相关的轻量任务，例如 VAD、音频预处理、上传、播放和打断检测。

## 产品原则

Deep Response 是 Scripture Companion，不是神、圣灵、心理治疗师或讲道人。

它必须：

- 以语音对话为核心体验。
- 像一个持续在场的语音陪伴 session，而不是一次性问答。
- 先承接强情绪，再进入经文。
- 第一声短、稳、具体、能让用户感觉被陪伴。
- 每轮回应短，适合 Watch、AirPods 和强情绪状态。
- 支持用户自然插话和打断。
- 支持多轮上下文，不失忆、不机械重复。
- 支持自然结束，而不是无限等待或突然断开。

它不能：

- 冒充神或圣灵发言。
- 把痛苦简单解释成神的安排。
- 用属灵话术压住真实痛苦。
- 为了完整、正确、丰富而牺牲第一句首响。

## 架构决策

首版 POC 采用：

```text
Apple Watch <-> Dedicated Realtime Voice Server <-> ASR / LLM / TTS providers
```

iPhone 不在核心实时链路中。

Dedicated Realtime Voice Server 首版使用 Node.js。

选择 Watch 直连 server 的原因：

- 当前 FocusFence 已有 `scripts/presence-server.mjs` 和 `npm run presence:server` 的本地服务习惯。
- 现有 Supabase / OpenAI / 测试脚本主要围绕 Node.js 和 shell 命令组织。
- 新增 POC server 可以更快接入当前 repo、env 和本地测试流程。
- iPhone relay 会增加蓝牙、WatchConnectivity、App 前后台状态、网络状态等不稳定依赖。
- Deep Response 的核心指标是首响、打断和连续对话自然度，不是设备分工看起来省电。
- server 更适合持有长连接、provider websocket、取消控制、会话上下文和完整 timing trace。
- Watch 直连 server 更接近小智设备端直连服务端的稳定模型。

Supabase 继续承担：

- Quick Response HTTPS 处理。
- 记录、音频、转写、分析结果存储。
- iPhone 历史详情同步。
- Deep Response 会话摘要和 transcript 持久化。

Dedicated Realtime Voice Server 承担：

- WebSocket 长连接。
- Deep Response session 生命周期。
- 多轮 turn-taking 状态机。
- 音频 ingress / egress。
- Streaming ASR / LLM / TTS 编排。
- 打断与 turn 取消。
- 首响 timing trace。
- 短期会话上下文。
- 会话摘要生成。
- 向 Supabase 异步写入 Deep Response 记录。

## Volcengine / Doubao Provider Preparation

首版 Deep Response POC 采用火山/豆包 provider 栈作为优先验证对象。

当前资料：

- `FocusFence/docs/volcengine-provider-handoff.md`
- `FocusFence/docs/volcengine-provider-setup.md`
- `FocusFence/scripts/test-volcengine-provider.mjs`
- `FocusFence/docs/realtime-watch-response-plan.md`
- `FocusFence/supabase/functions/presence-process/index.ts`

当前验证命令：

```bash
node scripts/test-volcengine-provider.mjs
```

最新验证状态：

- `PASSED 15/15 checks`。
- `.env.local` 和 `supabase/.env.local` 的 `ARK_API_KEY` 一致。
- `.env.local` 和 `supabase/.env.local` 的 `DOUBAO_SPEECH_APP_ID` 一致。
- `.env.local` 和 `supabase/.env.local` 的 `DOUBAO_SPEECH_ACCESS_TOKEN` 一致。
- Ark LLM chat completion 实际调用通过，HTTP `200`。
- Doubao ASR WebSocket handshake 通过，HTTP upgrade `101`。
- Doubao ASR init request 通过，服务端返回 `result`。
- Doubao TTS WebSocket handshake 通过，HTTP upgrade `101`。
- Doubao TTS HTTP synthesis 实际合成通过，HTTP `200`，service code `3000`，返回音频数据。

已知未验证：

- ASR 尚未送真实 PCM speech fixture 跑完整转写。
- TTS WebSocket 已验证 handshake，但尚未验证 bidirectional TTS 返回首个音频 chunk。
- 尚未验证完整 ASR -> LLM streaming -> TTS WebSocket -> server audio chunk 输出的端到端 timing。

这些未验证项必须进入首批实现验收，不能在实现阶段假定已经可用。

### Selected Volcengine Stack

首版采用 ASR -> LLM streaming -> TTS 的级联架构，不采用端到端 realtime speech model。

ASR：

- Provider：Doubao streaming ASR。
- WebSocket：`wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`。
- Resource ID：`volc.bigasr.sauc.duration`。
- Model name：`bigmodel`。
- Audio：PCM raw，16kHz，16-bit，mono。
- Recommended end window：`800ms`。

LLM：

- Provider：Ark OpenAI-compatible chat completions。
- Base URL：`https://ark.cn-beijing.volces.com/api/v3`。
- Streaming：`stream: true`。
- Primary：`doubao-seed-2-0-lite-260215`。
- Fallback：`doubao-seed-2-0-pro-260215`。

TTS：

- Provider：Doubao big TTS。
- Resource ID：`volc.service_type.10029`。
- WebSocket：`wss://openspeech.bytedance.com/api/v3/tts/bidirection`。
- HTTP verified endpoint：`https://openspeech.bytedance.com/api/v1/tts`。
- Initial voice：`zh_male_shaonianzixin_moon_bigtts`。
- POC output target：PCM audio chunk suitable for Watch streaming playback.

Do not use in first implementation:

- `volc.seedasr.sauc.duration`。
- `seed-tts-2.0`。

These returned `403` for the current application in earlier tests. Only use them later if the account/resource configuration changes and `test-volcengine-provider.mjs` or a successor test re-verifies them.

### Environment Variables

Real secrets are configured in:

- `FocusFence/.env.local`
- `FocusFence/supabase/.env.local`

Templates are:

- `FocusFence/.env.example`
- `FocusFence/supabase/.env.example`

Required credentials:

```bash
ARK_API_KEY=...
DOUBAO_SPEECH_APP_ID=...
DOUBAO_SPEECH_ACCESS_TOKEN=...
```

Provider defaults:

```bash
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=doubao-seed-2-0-lite-260215
ARK_FALLBACK_MODEL=doubao-seed-2-0-pro-260215

DOUBAO_ASR_WS_URL=wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async
DOUBAO_ASR_RESOURCE_ID=volc.bigasr.sauc.duration
DOUBAO_ASR_MODEL_NAME=bigmodel
DOUBAO_ASR_SAMPLE_RATE=16000
DOUBAO_ASR_AUDIO_FORMAT=pcm
DOUBAO_ASR_AUDIO_CODEC=raw
DOUBAO_ASR_AUDIO_BITS=16
DOUBAO_ASR_AUDIO_CHANNELS=1
DOUBAO_ASR_END_WINDOW_SIZE_MS=800

DOUBAO_TTS_WS_URL=wss://openspeech.bytedance.com/api/v3/tts/bidirection
DOUBAO_TTS_RESOURCE_ID=volc.service_type.10029
DOUBAO_TTS_MODEL=
DOUBAO_TTS_SPEAKER_ID=zh_male_shaonianzixin_moon_bigtts
DOUBAO_TTS_AUDIO_FORMAT=pcm
DOUBAO_TTS_SAMPLE_RATE=24000
DOUBAO_TTS_SPEECH_RATE=0
DOUBAO_TTS_LOUDNESS_RATE=0
```

Do not paste real keys into committed files or SPEC text.

### Provider Implementation Boundaries

Watch must not couple to Volcengine.

Watch only talks to our own DeepResponse protocol:

```text
Watch <-> Presence Realtime Voice Server
```

The server owns all provider-specific concerns:

- Volcengine authentication.
- ASR WebSocket headers and binary framing.
- ASR init request.
- ASR audio frame send / finalization.
- Ark chat completion request and streaming parsing.
- TTS WebSocket headers and binary framing.
- TTS HTTP fallback only if explicitly used for diagnostics.
- Retry policy.
- Error classification.
- `X-Tt-Logid` / request ID / connect ID logging.
- Provider timing trace.

Server provider interfaces:

- `ASRProvider` accepts 16kHz mono PCM chunks and emits transcript partial/final events.
- `LLMProvider` accepts transcript + context and emits text deltas / first phrase / completion.
- `TTSProvider` accepts text chunks and emits audio chunks.
- `VoicePipeline` orchestrates ASR -> LLM -> TTS, handles abort, and records timing.

### First Provider Acceptance Tests

Before Watch integration depends on provider output, implementation must pass:

1. Real PCM speech fixture through Doubao ASR returns transcript text.
2. Ark LLM streaming returns first token and first phrase timing.
3. Doubao TTS WebSocket returns first audio chunk for a short first phrase.
4. Server VoicePipeline produces end-to-end timing for ASR -> LLM -> TTS.
5. Provider logs include request/connect ids and available `X-Tt-Logid`.

Required provider timing:

- `asr_ws_connect_ms`
- `asr_init_ms`
- `first_transcript_delta_ms`
- `transcript_final_ms`
- `llm_first_token_ms`
- `llm_first_phrase_ms`
- `tts_connect_ms`
- `tts_first_audio_ms`
- `first_playable_audio_ms`
- `voice_pipeline_total_ms`


## Watch / iPhone / Server 分工

### 开发验证优先级

开发过程中优先使用自动化和本地环境验证：

1. Node 脚本模拟 Watch WebSocket client。
2. 固定 PCM fixture 模拟用户说话。
3. 本地 server timing trace。
4. watchOS 模拟器验证 UI 状态和协议处理。
5. 只有在无法由本地环境证明时，才进入 Watch 真机人工测试。

必须真机验证的内容：

- Watch 麦克风持续采集稳定性。
- Watch WSS 直连公网 server 稳定性。
- Watch speaker / AirPods 流式播放。
- 佩戴状态下的打断体验。
- 5-10 分钟 Deep Response 电量和发热。

不应把每次开发迭代都绑定到人工真机测试。真机测试应集中在阶段验收点。

### Watch

Watch 负责所有和实时体感直接相关的本地任务：

- 麦克风持续采集。
- 音频分片上传。
- 本地 VAD / 能量检测，用于打断和 endpoint hint。
- 必要的音频预处理、重采样、编码。
- 接收 server 下发的流式语音。
- 低延迟播放语音。
- 用户一开口，先本地停止旧音频，再通知 server abort。
- 记录本地 timing：capture、VAD、send、receive、playback、abort。
- 使用 `turn_id` / `generation_id` 丢弃旧 turn 的迟到音频。

Watch 不负责：

- ASR。
- LLM。
- TTS。
- 经文检索。
- 长期记忆。
- 历史记录管理。

### iPhone

iPhone 不参与 Deep Response 首响关键路径。

iPhone 负责：

- 历史记录展示。
- Deep Response transcript / summary 详情。
- 开发诊断面板。
- 用户设置，例如名字、语音偏好、是否允许 Deep Response。
- 非实时同步。

iPhone 不能成为：

- Watch 音频上传 relay。
- TTS 音频下发 relay。
- Deep Response session owner。
- abort/cancel 的必经路径。

只有当 POC 数据证明 iPhone relay 明显更快、更稳或更省电且不损害体验时，才重新评估。

首版 POC 明确不做 iPhone relay 对照实验。只有 Watch 直连 server 方案无法满足核心指标，或者出现 Watch 直连无法规避的系统级限制时，才打开这个备选项。

### Server

server 是 Deep Response realtime session owner。

server 负责：

- 认证 Watch session。
- 管理每个 WebSocket session。
- 管理 session lifecycle：start、listening、turn、interrupt、idle、goodbye、close。
- 接收 Watch 音频帧。
- 将音频送入 Streaming ASR。
- 检测 user utterance final。
- 调用 Streaming LLM。
- 将 LLM token 切成适合 TTS 的短句。
- 调用 Streaming TTS。
- 将音频帧发回 Watch。
- 处理 abort：停止 LLM、停止 TTS、清队列、发 `tts.stop`。
- 维护短期上下文：本 session 中最近若干轮用户话语、AI 回应、情绪状态、祷告主题。
- 识别结束意图：用户明确告别、拒绝继续、或长时间静默。
- 在 session 结束时生成 summary / memory candidate。
- 记录完整 timing trace。
- 异步写 Supabase。

## 小智方案映射

从小智项目迁移思想，不迁移完整系统。

保留的思想：

- 一个 WebSocket 连接对应一个独立 session handler。
- session handler 是长期对象，不是一轮请求结束就销毁的 pipeline。
- 设备上传小音频帧，server 统一编排 ASR / LLM / TTS。
- ASR、LLM、TTS 都是 provider interface，可以替换。
- TTS 队列按短句推进，不等完整回答。
- `abort` 是一等控制消息。
- 播放端先清本地音频，再等待 server 确认。
- 音频帧要有节奏控制和小预缓冲。
- 每段音频和文本必须绑定 turn。
- 会话持续监听用户下一句话，除非用户告别、idle timeout 或连接失败。
- 每轮对话都进入同一个 session context，避免失忆和重复。

不迁移：

- 小智 admin UI。
- manager-api。
- MCP 工具体系。
- IoT 控制。
- OTA。
- MySQL / Redis 配置中心。
- Live2D / web demo UI。

## 会话状态机

Deep Response session 独立于 Quick Response 录音状态机。

```text
idle
-> connecting
-> ready
-> listening
-> user_speaking
-> endpointing
-> assistant_thinking
-> assistant_speaking
-> listening
```

这是一个循环状态机。`assistant_speaking -> listening -> user_speaking -> assistant_speaking` 可以重复多轮，直到 session 进入 ending / ended。

任何非终止状态都可以进入：

```text
-> aborting
-> listening
```

长时间没有用户输入时：

```text
listening
-> idle_waiting
-> idle_prompting
-> listening
-> goodbye_pending
-> assistant_speaking
-> ended
```

用户明确告别时：

```text
listening | user_speaking | assistant_speaking
-> ending
-> assistant_speaking
-> ended
```

终止状态：

```text
-> ended
-> failed
```

关键规则：

- 用户进入 Deep Response 后才建立 realtime session。
- Watch 不能把 Deep Response 状态塞进 Quick Response 的 `recording -> uploading -> response` 主状态机。
- assistant speaking 时，如果 Watch 本地检测到用户开口，立即本地 stop playback，并发送 abort。
- server 收到 abort 后必须停止旧 generation 的 LLM/TTS，并下发 `tts.stop`。
- Watch 收到旧 turn 音频必须丢弃。
- AI 说完一轮后默认回到 listening，而不是关闭 session。
- session 关闭必须有明确原因：user_goodbye、idle_goodbye、manual_close、network_lost、provider_error。
- 除非出现失败或用户结束，server 不应在一轮回答后主动销毁 session。

## 持续对话与记忆

Deep Response 的最终体验是“一直在一起说话”，不是用户每次按按钮发起孤立请求。

### Session 内短期记忆

server 在同一个 Deep Response session 中维护短期上下文：

- 用户最近说过的 6-12 轮内容。
- AI 最近回应过的核心句子。
- 当前情绪标签，例如害怕、羞耻、疲惫、愤怒、孤单。
- 当前属灵主题，例如被神听见、安息、赦免、忍耐、盼望。
- 已经引用或提到过的经文，避免短时间重复。
- AI 已经问过的问题，避免机械追问。

短期记忆进入 LLM prompt，但不能拖慢第一句首响。第一句只读取最小必要上下文；更长上下文用于 continuation 或下一轮。

### Session summary

session 结束后，server 异步生成 summary：

- 用户这次主要表达了什么。
- AI 如何回应。
- 提到的经文或属灵主题。
- 是否有需要后续关怀的风险信号。
- 下次 Deep Response 可以温柔记得的一两点。

summary 不进入当前首响路径。它是 session 结束后的异步任务。

### 长期记忆边界

长期记忆是后续产品能力，但 POC 必须为它预留结构。

首版长期记忆只允许使用少量、高信号、用户安全的摘要。不能把完整 transcript 无限制塞进 realtime prompt，也不能让 AI 过度“记住”用户敏感内容。

长期记忆读取必须遵守：

- 不影响第一句首响。
- 不把过去痛苦强行带回当前会话。
- 不做诊断。
- 不替用户下属灵结论。
- 用户未来应能查看和删除相关记忆。

## 自然结束策略

Deep Response 不应该在一轮回复后结束，也不应该无限挂着不收口。

结束来源：

- 用户明确说：`拜拜`、`好了`、`先这样`、`结束吧`、`谢谢你我先走了`。
- 用户长时间无输入。
- Watch / server 网络断开。
- provider 连续失败。
- 用户手动退出 Deep Response。

idle 策略：

- 短静默：继续 listening，不打扰。
- 中等静默：可轻声确认一次，例如 `我还在，你可以慢慢来。`
- 长静默：温和告别，例如 `那我们先停在这里。愿你今晚能稍微安稳一点。`

结束意图检测必须谨慎：

- `我不知道怎么结束` 不等于要结束。
- `我好累` 不等于要结束。
- `拜拜`、`先这样吧`、`不用说了` 更接近结束。
- 如果不确定，AI 可以问一个极短确认问题。

结束后：

- server 发送 `session.end`。
- Watch 停止麦克风采集和播放。
- server 异步写 transcript / summary / memory candidate。
- iPhone 后续同步历史详情。

## 协议

### 连接

Watch 使用 WSS 直连 Dedicated Realtime Voice Server。

握手：

```json
{
  "type": "hello",
  "protocol": "presence.deep_response.v1",
  "device": "watch",
  "session_id": "client-generated-or-empty",
  "auth_token": "short-lived-token",
  "audio": {
    "input_format": "pcm16",
    "output_format": "pcm16",
    "sample_rate": 16000,
    "channels": 1,
    "frame_duration_ms": 40
  }
}
```

server 响应：

```json
{
  "type": "hello",
  "session_id": "server-session-id",
  "server_time_ms": 1780000000000,
  "accepted_audio": {
    "input_format": "pcm16",
    "output_format": "pcm16",
    "sample_rate": 16000,
    "channels": 1,
    "frame_duration_ms": 40
  }
}
```

### 控制消息

开始听：

```json
{
  "type": "listen",
  "state": "start",
  "turn_id": "turn-001",
  "mode": "auto"
}
```

用户停止：

```json
{
  "type": "listen",
  "state": "stop",
  "turn_id": "turn-001",
  "reason": "local_vad_end"
}
```

打断：

```json
{
  "type": "abort",
  "turn_id": "turn-001",
  "generation_id": "assistant-001",
  "reason": "barge_in"
}
```

timing：

```json
{
  "type": "timing",
  "turn_id": "turn-001",
  "events": [
    { "name": "watch_vad_stop", "t_monotonic_ms": 120430 },
    { "name": "watch_abort_local_playback_stop", "t_monotonic_ms": 122110 }
  ]
}
```

### Server 文本事件

Session idle prompt：

```json
{
  "type": "session",
  "state": "idle_prompt",
  "session_id": "session-001",
  "reason": "medium_idle_timeout",
  "text": "我还在，你可以慢慢来。"
}
```

Session end：

```json
{
  "type": "session",
  "state": "end",
  "session_id": "session-001",
  "reason": "user_goodbye",
  "summary_pending": true
}
```

ASR partial：

```json
{
  "type": "asr",
  "state": "partial",
  "turn_id": "turn-001",
  "text": "我现在真的"
}
```

ASR final：

```json
{
  "type": "asr",
  "state": "final",
  "turn_id": "turn-001",
  "text": "我现在真的很害怕，不知道神是不是还听我。"
}
```

TTS start：

```json
{
  "type": "tts",
  "state": "start",
  "turn_id": "turn-001",
  "generation_id": "assistant-001"
}
```

TTS sentence start：

```json
{
  "type": "tts",
  "state": "sentence_start",
  "turn_id": "turn-001",
  "generation_id": "assistant-001",
  "text": "Mike，我听见你现在真的很害怕。"
}
```

TTS stop：

```json
{
  "type": "tts",
  "state": "stop",
  "turn_id": "turn-001",
  "generation_id": "assistant-001",
  "reason": "completed"
}
```

Session summary completed：

```json
{
  "type": "session",
  "state": "summary_saved",
  "session_id": "session-001",
  "record_id": "deep-response-record-001"
}
```

### 二进制音频帧

POC-A 可以先使用裸 PCM16 binary frame，但必须在同一 turn 中通过最近的 control message 建立上下文。

POC-B 使用带 header 的 binary frame：

```text
magic: 2 bytes
version: 1 byte
kind: 1 byte
turn_seq: 4 bytes
frame_seq: 4 bytes
timestamp_ms: 8 bytes
payload: pcm16 or opus bytes
```

首版如果为了速度使用裸 PCM，也必须在 client/server timing 中记录 frame seq，方便定位乱序和丢包。

## 音频格式 POC

### POC-A：PCM16

用于最快验证链路。

- 16kHz。
- mono。
- 20ms / 40ms / 60ms 三档测试。
- Watch 发送 PCM16。
- server 下发 PCM16。

优点：

- Swift 端实现简单。
- 不被 Opus 编解码阻塞。
- 便于调试波形和 timing。

缺点：

- 带宽较高。
- 长对话功耗和弱网表现可能差。

### POC-B：Opus

用于接近生产形态。

- 16kHz。
- mono。
- 60ms frame。
- bitrate 约 16kbps。
- DTX 可评估。

优点：

- 接近小智默认链路。
- 带宽和功耗更合理。
- 更适合长期 Deep Response。

缺点：

- Swift Watch 端 Opus 集成复杂度更高。
- 编解码延迟和 CPU 消耗需要真机测。

## 首响路径

首响路径必须极短：

```text
watch local vad stop
-> server endpoint final
-> LLM first phrase
-> TTS first audio
-> Watch receive first audio
-> Watch playback first frame
```

第一句生成策略：

- LLM 必须先输出一句 8-20 字左右的承接句。
- 不等待 RAG。
- 不等待工具调用。
- 不等待完整神学解释。
- 不等待长上下文压缩。
- 可以使用 Quick Response 阶段已经得到的 emotion / scripture hint / user name。
- 首版 POC 使用“半模板 first phrase + LLM continuation”策略，降低首响延迟和属灵边界风险。

首版默认语气：

- 先安静承接，再自然带到经文。
- 不在第一秒急着解释经文。
- 不用讲章口吻。
- 不用强指导口吻。
- 先让用户听见“我听见了、你不是一个人、我们慢慢来”。
- 后续再接可靠经文和一个小问题。

这个语气边界需要通过真实体感测试调整。POC 首版不把“马上带到经文”作为硬规则，避免强情绪里显得过快、过薄或过像流程。

示例首句：

- `Mike，我听见你现在真的很害怕。`
- `我们先不要急着解释这一切。`
- `你现在不是一个人扛着。`
- `我们先慢慢停在神的话语前。`

## LLM 响应策略

LLM prompt 必须强约束输出节奏：

- 先出第一短句。
- 每轮 1-3 句话。
- 一次只问一个问题。
- 先陪伴，再解释。
- 经文要准确，不编造出处。
- 不冒充神说话。
- 危机表达进入安全回应。

LLM 输出可以按两层处理：

1. `first_phrase`：立即进入 TTS。
2. `continuation`：继续流式生成，可包含经文连接和一个小问题。

server 应支持在第一短句送入 TTS 后继续消费 LLM stream。

## TTS 策略

TTS 首包是核心指标。

要求：

- TTS provider 必须支持 streaming 或准 streaming。
- server 收到第一短句后立即 start TTS。
- TTS 音频按小帧下发。
- Watch 小预缓冲后播放，不等整句。
- abort 时 TTS provider 必须能 cancel，或者 server 至少能丢弃旧 generation 音频。

POC 候选：

- 先用最快可接入的 streaming TTS provider 验证链路。
- 再替换为更自然、更适合属灵陪伴语气的 voice。
- 不把 voice cloning 放进首版 POC。

## 打断策略

打断必须 local-first。

当 assistant_speaking 且 Watch 检测到用户开口：

1. Watch 立即停止本地播放器。
2. Watch 清空本地音频队列。
3. Watch 标记当前 `generation_id` 为 canceled。
4. Watch 发送 `abort`。
5. Watch 开始/继续上传用户新音频。
6. server 收到 `abort` 后停止旧 LLM/TTS。
7. server 清空旧 audio egress queue。
8. server 下发 `tts.stop`。
9. 任何旧 `generation_id` 的音频到达 Watch 都丢弃。

验收：

- 本地停音小于 150ms。
- server stop 小于 500ms。
- 不出现旧回答在用户打断后继续播。

## Endpointing 策略

Deep Response 场景里用户可能哭、停顿、慢速祷告，因此不能用过短静音阈值粗暴截断。

POC 测试：

- 200ms silence。
- 500ms silence。
- 800ms silence。
- 1000ms silence。

建议默认：

- Watch 本地 VAD 用于打断和 hint，不单独决定最终 ASR final。
- server VAD / ASR endpoint 决定正式 turn final。
- 祷告/强情绪模式默认 silence threshold 比普通命令更长。
- 如果用户说话慢，允许 adaptive endpoint。

## Timing Trace

每轮必须记录以下事件。

Watch：

- `watch_session_connect_start`
- `watch_session_ready`
- `watch_capture_start`
- `watch_first_audio_frame`
- `watch_vad_speech_start`
- `watch_vad_speech_stop`
- `watch_listen_stop_sent`
- `watch_abort_detected`
- `watch_abort_local_playback_stop`
- `watch_first_tts_frame_received`
- `watch_first_audio_playback`

Server：

- `server_ws_open`
- `server_hello_received`
- `server_first_audio_frame_received`
- `server_asr_stream_start`
- `server_asr_first_partial`
- `server_asr_final`
- `server_llm_request_start`
- `server_llm_first_token`
- `server_llm_first_phrase_ready`
- `server_tts_request_start`
- `server_tts_first_audio`
- `server_first_audio_sent`
- `server_abort_received`
- `server_abort_completed`

Derived metrics：

- `user_stop_to_first_playback`
- `watch_stop_to_server_asr_final`
- `asr_final_to_llm_first_token`
- `llm_first_phrase_to_tts_first_audio`
- `tts_first_audio_to_watch_playback`
- `barge_in_to_local_stop`
- `barge_in_to_server_stop`
- `stale_audio_after_abort_count`

## 验收指标

核心：

- `user_stop_to_first_playback` P50 < 1.2s。
- `user_stop_to_first_playback` P90 < 2.0s。
- `barge_in_to_local_stop` P90 < 150ms。
- `barge_in_to_server_stop` P90 < 500ms。
- 5 分钟连续对话不断流。
- 10 分钟连续对话没有明显延迟漂移。
- 同一个 session 内至少完成 8 轮“一句接一句”对话，不重新建连接。
- AI 每轮说完后自动回到 listening。
- 用户明确告别后，AI 简短告别并关闭 session。
- 长时间静默后，AI 先确认一次，再温和告别并关闭 session。
- session 结束后 transcript / summary / memory candidate 异步写入成功。
- 打断后旧音频播放次数为 0。

质量：

- 第一声必须是短句，不是长段落。
- 第一声必须能承接用户痛苦。
- 每轮最多一个问题。
- 经文引用不能编造。
- 不冒充神或圣灵。

稳定性：

- Watch Wi-Fi。
- Watch 蜂窝。
- Watch 亮屏。
- Watch 低电量模式记录结果。
- AirPods 和 Watch speaker 分别测试。
- 弱网下能清楚失败，不假装还在对话。

功耗：

- 记录 5 分钟和 10 分钟会话电量变化。
- 记录 Watch 发热主观状态。
- 记录 PCM vs Opus 的电量差异。
- 功耗不作为首版否决条件，但作为 POC-B 是否必要的依据。

## 代码结构建议

### Watch

新增 Deep Response 独立目录：

```text
Sources/PresenceWatchApp/DeepResponse/
  DeepResponseSessionViewModel.swift
  WatchDeepResponseAudioEngine.swift
  WatchDeepResponseWebSocketClient.swift
  WatchStreamingAudioPlayer.swift
  WatchBargeInDetector.swift
  DeepResponseTimingTrace.swift
  DeepResponseProtocol.swift
```

职责：

- `DeepResponseSessionViewModel`：Deep Response UI/session 状态机。
- `WatchDeepResponseAudioEngine`：麦克风采集、重采样、frame 输出。
- `WatchDeepResponseWebSocketClient`：WSS 连接、JSON 控制消息、binary audio。
- `WatchStreamingAudioPlayer`：接收音频帧、小预缓冲、播放、清队列。
- `WatchBargeInDetector`：assistant speaking 时检测用户开口。
- `DeepResponseTimingTrace`：Watch timing 事件采集和上报。
- `DeepResponseProtocol`：message type、turn id、generation id、audio config。

首版入口：

- 使用单独 debug screen。
- 可以做成 Watch App 内独立调试入口，也可以临时做成独立 Watch debug app/target。
- 不从正式 Quick Response 邀请进入。
- 不把 DeepResponse 状态塞进 `TurningRecorderViewModel`。
- 等 POC 证明链路、首响和打断后，再整合到正式 Deep Response 入口。

这样做的原因：

- DeepResponse 本来就是独立实时流程。
- 真机安装和人工测试成本高，debug screen 可以减少正式 UI 干扰。
- 可以更快暴露连接状态、timing、播放队列、abort 状态。
- 避免早期 POC 破坏当前稳定 Quick Response。

现有文件边界：

- `TurningRecorderViewModel.swift` 继续只负责 Quick Response。
- `WatchAudioRecorder.swift` 继续只负责稳定 m4a 文件录制。
- `TurningReflectionService.swift` 继续负责 Quick Response POST 和旧 smoke test。
- `WatchRealtimeAudioStreamer.swift` 可抽取部分采集逻辑，但不能让 Deep Response 依赖 Quick Response 状态机。

### Server

新增 dedicated realtime service：

```text
presence-realtime-server/
  src/
    server.mjs
    session/
      DeepResponseSession
      TurnController
      InterruptController
      TimingTrace
    transport/
      WatchRealtimeWebSocket
      MessageProtocol
    audio/
      AudioIngress
      AudioEgress
      PcmFrameCodec
      OpusFrameCodec
    providers/
      StreamingASRProvider
      StreamingLLMProvider
      StreamingTTSProvider
      VolcengineASRProvider
      ArkLLMProvider
      DoubaoTTSProvider
    policy/
      ScriptureCompanionPolicy
      FirstPhrasePlanner
      CrisisBoundary
    persistence/
      SupabasePresenceWriter
```

语言选择：

- 首版使用 Node.js。
- 可以先使用 `.mjs`，贴近现有 `scripts/presence-server.mjs`。
- provider interface 必须保持清晰，避免锁死供应商。
- 小智 Python asyncio 架构用于参考 session、queue、abort、provider 分层，不直接迁移。

## POC 阶段

### Phase 0：Local Harness And Provider Benchmark

目标：用本地 Node 脚本和固定音频 fixture 单独测 ASR、LLM、TTS，不接 Watch。

Phase 0 必须先复跑 provider readiness：

```bash
node scripts/test-volcengine-provider.mjs
```

Expected:

```text
PASSED 15/15 checks
```

输出：

- ASR first partial / final。
- LLM first token / first phrase。
- TTS first audio / RTF。
- 选出首版组合。
- 本地 WebSocket test client。
- 固定 PCM fixture。
- 可重复 timing trace。
- Doubao ASR real PCM speech fixture transcript。
- Ark LLM streaming first token timing。
- Doubao TTS WebSocket first audio chunk timing。

通过标准：

- `node scripts/test-volcengine-provider.mjs` 通过。
- 真实 PCM speech fixture 经 Doubao ASR 得到非空转写文本。
- LLM first token P90 < 500ms。
- LLM streaming first phrase 可进入 TTS。
- Doubao TTS WebSocket 返回首个音频 chunk。
- TTS first audio P90 < 800ms。
- ASR final 在合理 endpoint 后稳定返回。
- provider timing trace 包含 ASR、LLM、TTS 各阶段耗时。

### Phase 1：Watch Direct PCM Realtime

目标：先用脚本和 watchOS 模拟器验证 PCM16 双向流，再进入 Watch 真机直连 server 验收。

Phase 1 允许使用固定音频或 echo audio，不要求接入真实 TTS。

这个步骤必须做得很薄。它不是产品能力，只是通道验收探针。

这样分阶段不是为了增加流程，而是为了隔离两个风险：

- Watch 流式播放、清队列、打断和 binary frame 处理是否稳定。
- Streaming TTS provider 首包、音质和取消是否稳定。

如果第一步直接接入真实 TTS，一旦首响或打断失败，很难判断问题来自 Watch 播放、网络、server queue、TTS provider 还是 generation 丢弃逻辑。因此 Phase 1 先把 Watch/server 双向音频通道证明清楚。

Phase 1 不应在固定音频/echo audio 上消耗过多时间。只要证明以下行为成立，就进入 Phase 2：

- Watch 能收到第一段 server 音频并开始播放。
- Watch 能在 assistant speaking 时 local-first 停止播放。
- Watch 能清空播放队列。
- server 能收到 abort。
- 旧 `generation_id` 音频不会继续播放。

验证：

- Watch 可以稳定持续上传。
- server 可以回传音频。
- Watch 可以流式播放。
- timing trace 完整。
- assistant speaking 时 Watch 可以 local-first stop playback。

通过标准：

- 3 分钟对话不断流。
- first playback P90 < 2.5s。
- 打断本地停音 < 150ms。

### Phase 2：Full Cascade

目标：接入真实 Streaming ASR -> LLM -> TTS，并形成持续 session runtime。

验证：

- 真实语音首响。
- 多轮上下文。
- 同一 WebSocket session 内连续对话。
- abort 取消旧 generation。
- assistant speaking 后自动回到 listening。
- 用户下一句复用前文 context。
- 用户主动告别或 idle timeout 触发 session end。
- session summary / memory candidate 异步生成。
- 质量边界。

通过标准：

- first playback P90 < 2.0s。
- 5 分钟连续对话稳定。
- 至少 8 轮连续对话不重新连接。
- 20 次打断无旧音频残留。
- 3 次主动告别正确结束。
- 3 次 idle goodbye 正确结束。
- summary 写入成功且不进入首响路径。

Phase 2 必须拆成可独立验收的小阶段：

- Phase 2A：单轮真流式。验证 Watch 流式上传、server 流式 ASR/LLM/TTS、Watch 流式播放。
- Phase 2B：Session runtime。引入 `DeepResponseSession`、turn id、generation id、状态机和 context。
- Phase 2C：连续多轮对话。AI 说完后继续监听，用户下一句进入同一 session。
- Phase 2D：Barge-in。用户在 AI 说话时开口，本地停播，server 取消旧 generation。
- Phase 2E：Idle / Goodbye。用户告别或长时间静默时自然结束。
- Phase 2F：Summary / Memory。结束后异步写 transcript、summary 和 memory candidate。

### Phase 3：Opus / Power Optimization

目标：评估 Opus 是否作为生产默认。

验证：

- PCM vs Opus 延迟。
- PCM vs Opus 电量。
- PCM vs Opus 弱网。
- 编解码 CPU 影响。

通过标准：

- Opus 不显著损害首响。
- Opus 明显改善带宽/功耗/弱网稳定性。

### Phase 4：Product Integration

目标：从 Quick Response 邀请进入 Deep Response。

验证：

- 强情绪 Quick Response 后显示邀请。
- 用户确认后启动 Deep Response。
- iPhone 只同步 transcript/summary，不参与 realtime。
- Deep Response 结束后写入历史记录。

### Deployment Path

部署也分阶段，但不是长期保留两套环境：

1. 本地 Node server + 脚本 client：最快验证协议、队列、timing 和 provider。
2. 本地 Node server + watchOS 模拟器：验证 Watch UI/runtime 基本逻辑。
3. 公网 WSS server + Watch 真机：验证真实网络、麦克风、播放和功耗。

不建议第一步直接上公网再修所有细节。

原因：

- 协议、队列、timing、first phrase、server abort 都可以本地快速迭代。
- 每次真机安装和人工测试成本高，应该留给本地无法证明的环节。
- 公网环境会混入部署、证书、域名、网络抖动问题，过早引入会降低定位效率。

但公网 WSS 是必经验收，不是可选项。只是在本地自动化通过后再进入。

执行原则：

- 本地和模拟器能验证的，不要求人工真机测试。
- 真机测试只安排在阶段验收点。
- 公网 WSS 只在本地协议、队列、timing 和模拟器基本逻辑通过后进入。
- 如果公网/真机失败，先用 timing trace 判断是部署网络问题还是业务链路问题，再决定是否回到本地复现。

## 测试脚本

### 固定音频回放

server 需要支持用本地 wav/pcm 文件模拟 Watch audio stream：

- 正常语速。
- 慢速祷告。
- 哭泣/停顿。
- 强情绪。
- 插话打断。

### Watch 真机测试

每组至少记录：

- 网络类型。
- Watch 型号。
- 是否连接 AirPods。
- 是否靠近 iPhone。
- session 时长。
- timing trace。
- 主观卡顿。
- 是否出现旧音频。

### Provider Benchmark

参考小智 `performance_tester_*` 思路，分别输出：

- ASR 首字/最终耗时。
- LLM 首 token/总耗时。
- TTS 首包/RTF。
- e2e 首播耗时。

## 风险

### Watch 长连接不稳定

处理：

- POC 必须真机测。
- 支持断线后温和结束，而不是继续假装对话。
- 可以保留 Quick Response 作为稳定 fallback。

### Endpoint 过早截断祷告

处理：

- 强情绪模式 silence threshold 更长。
- server final 优先于 Watch local hint。
- 记录 false endpoint 案例。

### TTS 首包慢

处理：

- 第一短句更短。
- TTS session 预热。
- provider benchmark 先行。
- 不等完整句再合成。

### 打断后旧音频残留

处理：

- local-first stop。
- generation id。
- 清本地队列。
- 清 server queue。
- Watch 丢弃旧 generation。

### 属灵边界失控

处理：

- `ScriptureCompanionPolicy` server-side prompt 固化。
- 首句模板/半模板。
- 危机场景独立 safety branch。
- 记录 transcript 后抽样 review。

## 最终决策门槛

小智式级联链路成为 Deep Response 主线，当且仅当：

- 真 Watch P90 首响小于 2 秒。
- 打断体验稳定。
- 5-10 分钟连续对话稳定。
- 同一个 session 能自然完成多轮“一句接一句”的持续沟通。
- 用户插话、主动告别、长时间静默结束都被视为正常会话行为。
- session 记忆、summary 和历史写入链路稳定。
- 第一声质量符合 Scripture Companion。
- iPhone 不在核心链路中也能稳定工作。

如果达不到：

- 继续优化 provider / endpoint / audio codec。
- 用 OpenAI Realtime voice agent 做对照 POC。
- 只有在实测证明必要时，才重新讨论 iPhone relay。
