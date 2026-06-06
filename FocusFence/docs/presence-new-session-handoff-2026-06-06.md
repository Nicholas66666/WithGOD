# Presence / 与神同在新会话开发交接

更新日期：2026-06-06

这份文档给后续新 Codex 会话使用。目标是让新会话不用重新猜项目背景，可以直接继续「与神同在 / Presence」老包和 DeepResponse/Volcengine 相关开发。

## 0. 当前仓库状态

Repo root:

```bash
/Users/nicho/Documents/New project
```

项目目录:

```bash
/Users/nicho/Documents/New project/FocusFence
```

当前分支：

```bash
codex/deep-response-lab
```

交接时最近提交：

```text
dac8b8f Add WatchLab recording watchdog
fe5f841 Bound WatchLab auto listening endpointing
a8dbd48 Keep WatchLab mic active during playback
a30ca53 Record final DeepResponse Watch experience pass
d36d1f4 Tighten DeepResponse Watch experience selftest
```

交接时工作区是干净的：

```bash
git -C "/Users/nicho/Documents/New project" status --short --branch
# ## codex/deep-response-lab...origin/codex/deep-response-lab
```

进入项目：

```bash
cd "/Users/nicho/Documents/New project/FocusFence"
```

不要打印 `.env.local`、`supabase/.env.local`、`.volcengine/*` 里的真实 secret。

## 1. 产品框架

「与神同在 / Presence」是 Apple Watch 优先的一键语音记录入口。

核心体验：

```text
按一下，说话；再按一下，结束。
```

用户不需要判断 App 在前台、后台还是未启动。Action Button 是最低摩擦入口，Watch 屏幕按钮是可见的等价入口。

当前项目里有几条线：

1. `Presence` / `PresenceWatch`
   - 稳定老包主流程。
   - Watch 一键录音，结束后上传 Supabase，生成 Quick Response。
   - iPhone 展示历史、录音、转写、分类、经文、详情。

2. `DeepResponseWatchLab`
   - 独立 Watch Lab 包，显示名 `DeepLab`。
   - 用于 DeepResponse 小智式连续语音对话 POC。
   - 当前仍是 Lab，不要默认合进 Presence 老包主流程。

3. `WatchSocketLab`
   - 历史 socket 实验包。
   - 当前 DeepResponse 主线已经明确：Watch 端不用 WebSocket，走 HTTP。

## 2. Presence 老包稳定主流程

Watch 主流程：

```text
Action Button / Watch 屏幕按钮
-> TurningRecorderViewModel.startRecording()
-> WatchAudioRecorder 写 m4a 文件
-> 用户再次按 Action Button 或点击「结束记录」
-> TurningRecorderViewModel.stopRecording()
-> 小于 3.5 秒：删除本地文件，不上传、不分析
-> 大于等于 3.5 秒：TurningReflectionService POST 到 Supabase Edge Function
-> Supabase Function 上传音频、转写、生成 Quick Response
-> Watch 显示一屏回应
-> iPhone 通过 server sync 拉取记录
```

Action Button 当前目标行为：

- App 未启动，未录音：按 Action Button，启动并直接录音。
- App 后台 / 表盘，未录音：按 Action Button，唤起并直接录音。
- App 前台，未录音：按 Action Button，直接录音。
- 正在录音：再次按 Action Button，复用屏幕「结束记录」逻辑停止。
- 正在上传整理：忽略，不重复上传、不打断。
- 1 秒内重复触发去重，防止 AppIntent + URL 双通道造成一次按键被处理两次。

iPhone 主流程：

```text
PresenceApp
-> PresenceRecordStore.startConnectivity()
-> WatchConnectivity activate
-> startServerSync()
-> 每 2 秒 GET Supabase 最近记录
-> merge 到本地 records
-> 列表/详情展示
```

用户成功时看到：

- Watch 录音中：「正在听你说」。
- 停止后：「正在上传整理」。
- 成功后：Quick Response 卡片，字段是 `eyebrow/headline/body/footnote`。
- iPhone：新记录出现，详情能播放录音，显示转写、分类、完整整理和 timing。
- 3.5 秒内误触：Watch 显示「3.5 秒以内的误触录音已丢弃。」，不上传、不分析。

## 3. 核心文件地图

### Presence Watch

- `Sources/PresenceWatchApp/PresenceWatchApp.swift`
  - Watch App 入口。
  - 创建 `TurningRecorderViewModel`。
  - 激活 `WatchAudioTransfer`。
  - 处理 `withgod://...` URL。
  - 运行 debug-only realtime smoke tester。

- `Sources/PresenceWatchApp/TurningAppIntents.swift`
  - Watch AppIntent / AppShortcuts。
  - 动作名：「开始回转记录」。
  - `openAppWhenRun = true`。
  - `perform()` 写入 `WatchShortcutStore`，并打开 `withgod://record/start`。
  - Action Button 应配置这个 AppIntent 动作，不要让用户手写 URL 快捷指令。

- `Sources/PresenceWatchApp/TurningRecorderViewModel.swift`
  - Watch 录音状态机核心。
  - 管理 `isRecording`、`isProcessing`、`reflection`、`errorMessage`。
  - 处理 Action Button 请求消费、去重、开始/停止、误触丢弃、静音保护、上传、Quick Response 状态。
  - 当前误触阈值是 `3.5` 秒。
  - 错误文案「记录已保存，但暂时无法生成反馈。」在这里。

- `Sources/PresenceWatchApp/WatchTurningView.swift`
  - Watch 主 UI。
  - 显示空闲、录音、处理中、Quick Response。
  - `.task` 和 scene active 时消费 pending shortcut 请求。
  - 屏幕按钮调用 `recorder.toggleRecording()`。

- `Sources/PresenceWatchApp/WatchAudioRecorder.swift`
  - `AVAudioRecorder` 封装。
  - AAC m4a、16 kHz、单声道。
  - 提供 metering 给静音判断。
  - 当前 Presence 主流程不是 realtime streaming。

- `Sources/PresenceWatchApp/TurningReflectionService.swift`
  - Watch HTTP POST 上传到服务端。
  - 从 Info.plist 读 `PresenceWatchProcessEndpoint` 和 `PresenceWatchClientToken`。
  - Header 包含 `X-Presence-Source`、`X-Presence-Local-Record-ID`、`X-Presence-Request-ID`、`X-Presence-Duration-Seconds`、`X-Presence-Client-Token`。
  - 里面有 `WatchRealtimeReflectionSession`，但不是稳定主流程。

- `Sources/PresenceWatchApp/WatchAudioTransfer.swift`
  - WatchConnectivity。
  - 目前主要用于接收 iPhone 侧 `startRecording` 命令。

- `Sources/PresenceWatchApp/WatchRealtimeAudioStreamer.swift`
  - 实验性 realtime 音频流工具。
  - 不要误接入 Presence 主流程。

- `Sources/PresenceWatchApp/WatchRealtimeSmokeTester.swift`
  - `--realtime-smoke` 调试入口。
  - 只用于验证 WebSocket/realtime 可行性，不是产品主流程。

- `Sources/PresenceWatchApp/WatchSilentHaptics.swift`
  - 开始/结束触觉反馈。

### Presence iPhone

- `Sources/PresenceApp/PresenceApp.swift`
  - iPhone App 入口。
  - 创建 `PresenceRecordStore`。
  - onAppear 启动 connectivity。
  - scene active 时刷新服务端记录。

- `Sources/PresenceApp/PresenceHomeView.swift`
  - iPhone 首页、列表、详情、播放器 UI。
  - 列表行显示时间、类型、摘要、时长、经文、标签等。
  - 当前删除是卡片内 trash 按钮，不是系统左滑删除。

- `Sources/PresenceApp/PresenceRecordStore.swift`
  - 本地 records store。
  - 保存 `presence-records.json`。
  - 处理 WatchConnectivity 文件。
  - 调服务端、合并服务端记录、缓存远端音频、删除本地记录。
  - 当前每 2 秒 server sync。

- `Sources/PresenceApp/PresenceServiceClient.swift`
  - iPhone 到 Supabase Function 的 POST/GET client。
  - 从 Info.plist 读 `PresenceProcessEndpoint` 和 `PresenceClientToken`。

- `Sources/PresenceApp/PresenceRecord.swift`
  - 记录模型。
  - 包含 duration、transcript、type、tags、watchResponse、detail、state、timing、realtimeDiagnostic。

- `Sources/PresenceApp/PresenceAppIntents.swift`
  - iPhone 侧 AppIntent。
  - 可通过 WatchConnectivity 向 Watch 发 `startRecording` 命令。

- `Sources/PresenceApp/PresenceSpeechTranscriber.swift`
  - iPhone 本地 fallback 转写。

- `Sources/PresenceApp/PresenceAnalyzer.swift`
  - iPhone 本地 fallback 分析。

### Supabase / Presence backend

- `supabase/functions/presence-process/index.ts`
  - Presence 生产 Edge Function。
  - `GET /health`
  - `GET ?limit=N`
  - `POST` 接收音频，上传 Storage，转写，生成 Quick Response，写入 `presence_records`。
  - 后台 `finalizeFullRecord()` 做完整分析。
  - 文件里有 WebSocket realtime smoke path，但稳定 Presence 主流程是普通 POST。

- `supabase/migrations/202605250001_presence_records.sql`
  - 创建 `presence_records` 表和 storage。

- `supabase/migrations/202605250002_presence_audio_mime_types.sql`
  - 音频 MIME 类型迁移。

- `supabase/migrations/202605260002_presence_processing_timing.sql`
  - processing timing 字段。

- `supabase/migrations/202605280001_presence_duration_seconds.sql`
  - duration 字段。

### DeepResponse / DeepLab

- `Sources/DeepResponseWatchLab/*`
  - 独立 Watch Lab。
  - 当前不应混进 `PresenceWatchApp`。

- `scripts/deep-response-server.mjs`
  - Dedicated DeepResponse Node server。
  - 当前 HTTP endpoints，包括：
    - `GET /health`
    - `GET /debug/events`
    - `GET /debug/config`
    - `POST /deep-response/http-turn`
    - `POST /deep-response/http-turn-v2`
    - `POST /deep-response/sessions`
    - session audio/events/audio/end/abort routes

- `scripts/deep-response/providers/*`
  - 火山/豆包 provider：
    - `doubao-asr.mjs`
    - `ark-llm.mjs`
    - `doubao-tts.mjs`

- `scripts/deep-response/pipeline/*`
  - ASR -> LLM -> TTS pipeline。
  - 包含 phrase chunker、TTS queue、VoicePipeline。

- `docs/deep-response-product-selftest-lab.md`
  - DeepResponse 产品自检实验室说明。

- `docs/deep-response-selftest-lab-final-handoff.md`
  - 最新 DeepResponse selftest 交付说明。

- `docs/volcengine-provider-handoff.md`
  - 火山/豆包 provider 已验证资源说明。

- `docs/superpowers/plans/2026-06-04-deep-response-volcengine-deployment.md`
  - 火山 ECS 部署记录，替代 Render 的核心依据。

## 4. project.yml 结构

`project.yml` 里当前 schemes：

- `Focus`
- `Presence`
- `DeepResponseWatchLab`
- `WatchSocketLab`

关键 bundle id：

- iPhone Presence：`com.nicho.WithGod`
- Watch Presence：`com.nicho.WithGod.watchkitapp`
- DeepLab：`com.nicho.DeepResponseWatchLab`
- SocketLab：`com.nicho.WatchSocketLab`

Presence iPhone Info.plist 注入：

- `PresenceClientToken: "$(PRESENCE_CLIENT_TOKEN)"`
- `PresenceProcessEndpoint: "$(PRESENCE_PROCESS_ENDPOINT)"`

Presence Watch Info.plist 注入：

- `PresenceWatchClientToken: "$(PRESENCE_CLIENT_TOKEN)"`
- `PresenceWatchProcessEndpoint: "$(PRESENCE_PROCESS_ENDPOINT)"`

DeepLab Info.plist 注入：

- `DeepResponseRealtimeEndpoint: "$(DEEP_RESPONSE_REALTIME_ENDPOINT)"`

## 5. 环境变量

不要打印真实值。

Presence 构建 `.env.local` 需要：

```bash
PRESENCE_PROCESS_ENDPOINT=...
PRESENCE_CLIENT_TOKEN=...
```

Supabase 部署 `supabase/.env.local` 需要：

```bash
SUPABASE_PROJECT_REF=...
SUPABASE_ACCESS_TOKEN=...
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
PRESENCE_SUPABASE_SECRET_KEY=...
SUPABASE_DB_PASSWORD=...
PRESENCE_CLIENT_TOKEN=...
OPENAI_API_KEY=...
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
OPENAI_FAST_ANALYSIS_MODEL=gpt-4.1-nano
OPENAI_ANALYSIS_MODEL=gpt-5.5
OPENAI_SPEECH_MODEL=gpt-4o-tts
OPENAI_SPEECH_VOICE=alloy
```

DeepResponse / Volcengine `.env.local` 和 `supabase/.env.local` 已有配置。根据 `docs/volcengine-provider-handoff.md`，必需字段：

```bash
ARK_API_KEY=...
DOUBAO_SPEECH_APP_ID=...
DOUBAO_SPEECH_ACCESS_TOKEN=...
```

推荐非 secret defaults：

```bash
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3
ARK_MODEL=doubao-seed-character-251128
ARK_FALLBACK_MODEL=

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

不要使用这些旧失败资源，除非重新验证：

- `volc.seedasr.sauc.duration`
- `seed-tts-2.0`

## 6. 火山 / Render / DeepResponse 当前状态

火山 ECS 测试资源已经存在，不是从零开始。

当前火山 endpoint：

```text
http://124.174.96.149:8797
```

Health：

```bash
curl -s http://124.174.96.149:8797/health
```

预期：

```json
{"ok":true,"service":"deep-response","mode":"provider","providerConfigured":true}
```

火山资源记录：

- Region: `cn-beijing`
- Zone: `cn-beijing-a`
- VPC: `vpc-2f8f58w0r2zgg4f4pzyvq1rpw`
- Subnet: `subnet-1c197y7hkhu685e8j71rmq8vd`
- Security group: `sg-2f8f59lo5jp4w4f4pzyq8cq72`
- ECS: `i-yenp6zqgao4c5qvvn50z`
- Instance type: `ecs.g4i.large`，2 vCPU / 8 GiB
- EIP: `124.174.96.149`
- EIP bandwidth: `5Mbps`

ECS 目录：

```text
/opt/deep-response/repo/FocusFence
```

systemd service：

```bash
deep-response.service
```

服务命令：

```bash
npm run deep:server:provider
```

常用远端诊断：

```bash
ssh -i .volcengine/drs-test-key ubuntu@124.174.96.149 'systemctl status deep-response --no-pager'
ssh -i .volcengine/drs-test-key ubuntu@124.174.96.149 'journalctl -u deep-response -n 100 --no-pager'
```

手动 redeploy：

```bash
ssh -i .volcengine/drs-test-key ubuntu@124.174.96.149 '
  cd /opt/deep-response/repo &&
  sudo git fetch origin codex/deep-response-lab &&
  sudo git reset --hard origin/codex/deep-response-lab &&
  cd FocusFence &&
  sudo systemctl restart deep-response &&
  systemctl is-active deep-response
'
```

已有脚本：

```bash
npm run deep:volc:deploy
npm run deep:volc:smoke:full
npm run deep:volc:conversation:full
npm run deep:watchlab:build:volc
npm run deep:selftest:full
```

当前 package.json 中关键脚本：

```bash
npm run deep:provider:check
npm run deep:server:provider
npm run deep:volc:deploy
npm run deep:http-smoke:test
npm run deep:volc:smoke:full
npm run deep:volc:conversation:full
npm run deep:watchlab:build:volc
npm run deep:lab:selftest
npm run deep:selftest:full
npm run presence:quick:samples:live
npm run test:node
```

Render 只保留为 rollback，不是默认路径：

```bash
npm run deep:rollback:render:deploy
npm run deep:rollback:render:sync-env
```

历史火山 smoke 结果：

- Render stop-to-first-audio 约 `1682ms` / `1993ms`。
- 火山 stop-to-first-audio 曾测得约 `448ms` / `454ms`。
- 后续产品 selftest 中 `http_stop_to_first_audio_ms` 曾达到约 `197ms-240ms`。
- 2026-06-06 最新火山 smoke：turn stop-to-first-audio 约 `232ms` / `229ms`，failures `[]`。
- 最新 10-turn Watch Simulator experience pass：10/10 turn，audio audits 10/10 PASS，无 `-999`、`-1001`、`Volc_Server_Error`、provider errors、silent audio、timeout-like errors。

## 7. DeepResponse 当前关键决策

当前决策文件：

```text
docs/superpowers/plans/2026-06-05-deep-response-product-integration-decision.md
```

结论：

- DeepResponse 仍保持在独立 Lab target。
- 不要默认集成进 Quick Response / PresenceWatchApp / 稳定用户流。
- `DeepResponseWatchLab` 是当前唯一用户可见 POC surface。
- Watch transport 是 HTTP-only。
- Watch 端不要再做 WebSocket。
- provider 内部 WebSocket 允许，因为 Doubao ASR/TTS 需要。
- 不要把 iPhone 放进核心 realtime 链路。
- 用户人工 Watch 测试不是开发 gate；先跑自动化、自检、模拟器、火山 smoke。

DeepResponse 自检 gate：

```bash
npm run deep:lab:selftest
npm run deep:watchlab:experience:10
npm run test:node
npm run deep:watchlab:build:volc
```

最新通过记录：

- `docs/deep-response-product-selftest-lab.md`
- `docs/deep-response-selftest-lab-final-handoff.md`

## 8. 马上要迭代的两件事

### 任务 1：用火山引擎全面替代 Render

目标不是再研究一遍，而是基于现有火山资源，把 Render 依赖全部迁移干净，并部署调试到可继续开发的稳定状态。

现有火山资源和 endpoint：

```text
http://124.174.96.149:8797
```

现有部署计划：

```text
docs/superpowers/plans/2026-06-04-deep-response-volcengine-deployment.md
```

现有 provider 交接：

```text
docs/volcengine-provider-handoff.md
docs/volcengine-provider-setup.md
```

应该做：

1. 全局查 Render 相关脚本、文档、默认 endpoint、测试命令、env 同步逻辑。
2. 判断哪些仍需保留为 rollback，哪些应迁移为 Volcengine 默认。
3. 用现有火山 ECS 或必要时新开火山资源，全面替代 Render。
4. 把部署脚本、health check、smoke test、WatchLab build endpoint、selftest 默认 endpoint 统一到火山。
5. 保留 Render 只作为明确 rollback，不作为默认路径。
6. 跑通火山 deploy + health + smoke + conversation + WatchLab build。
7. 更新文档，把“新会话应该怎么部署、怎么验证、怎么回滚”写清楚。

重要边界：

- 不要打印 secret。
- 不要把 Volcengine provider 逻辑写进 Watch；Watch 只连我们自己的 server protocol。
- 不要为了替代 Render 顺手改 Presence Quick Response 主录音状态机。
- 不要把 DeepResponse 合进 Presence 老包，除非用户明确批准 integration。

建议验收命令：

```bash
npm run deep:provider:check
npm run deep:volc:deploy
curl -s http://124.174.96.149:8797/health
npm run deep:volc:smoke:full
npm run deep:volc:conversation:full
npm run deep:watchlab:build:volc
npm run deep:lab:selftest
npm run test:node
```

如果修改默认 endpoint 或 package scripts，补充相关测试。

### 任务 2：重做 Quick Response 提示词，让回答马上创造价值

当前 Quick Response 在：

```text
supabase/functions/presence-process/index.ts
```

主要函数：

```text
analyzeQuickWatchResponse()
analyzeTranscript()
realtimeQuickInstructions()
```

Quick Response 旧规格：

```text
docs/superpowers/specs/2026-05-28-quick-response-design.md
```

新的产品方向：

Quick Response 不只是“给一句经文”，而是用户刚说完后，Watch 上马上出现一条能对当下有帮助的回应。它要能：

- 安抚强情绪。
- 帮用户从恐惧、羞耻、焦虑、委屈里先稳住。
- 给属灵上清醒、温柔、不过界的一句话。
- 给一个很小、此刻可执行的转向动作。
- 对祷告、自省、回转、情绪、关系冲突给有分量的回应。
- 对灵感、待办、普通记录不要强行属灵化。
- 对危险/危机表达，要现实支持优先，不只属灵安慰。

Quick Response 的 Watch 卡片字段继续用：

```json
{
  "eyebrow": "4-8字",
  "headline": "2-6字",
  "body": "10-28字",
  "footnote": "经文出处/小动作/状态"
}
```

建议内容策略：

1. 强情绪 / 创伤 / 焦虑：
   - 先稳住，不解释原因。
   - 允许用户痛苦存在。
   - 给一句可靠经文原则或现实锚点。
   - 给一个当下动作：呼吸、坐下、喝水、找安全的人、先不做决定。

2. 羞耻 / 自责 / 认罪：
   - 不控告、不压迫。
   - 区分“承认罪”和“被羞耻吞掉”。
   - 指向恩典、赦免、回到神面前。
   - 可用：约一 1:9、罗 8:1。

3. 怒气 / 被冒犯 / 想反击：
   - 先暂停，不急于回应。
   - 指向慢慢说、柔和回答、交给神。
   - 可用：雅 1:19、箴 15:1。

4. 祷告 / 交托：
   - 像安静陪伴和确认，不要总结成待办。
   - 让用户感觉“神听见我向祂说话”，但不要冒充神说话。
   - 可用：腓 4:6、诗 34:18 等高置信经文。

5. 灵感 / 想法 / 待办：
   - 不强行加经文。
   - 直接保存重点，给一个小下一步。

6. 普通问题：
   - 直接短答；复杂内容放 iPhone 详情。
   - Watch 不做长解释。

禁止：

- 泛泛鸡汤。
- “已记下 / 正在整理 / 稍后查看”这类流程话。
- 审判、控告、定罪。
- 滥用“你应该”。
- 编造经文出处。
- 每条都硬套经文。
- 冒充神、圣灵、耶稣直接对用户说话。
- 危机场景只给属灵话语而不给现实支持。

已有样例测试覆盖：

- 焦虑害怕
- 羞耻自责
- 创伤闪回
- 孤独被抛弃
- 怒气想反击
- 认罪悔改
- 祷告交托
- 饶恕关系
- 灵感
- 待办
- 普通问题
- 危机边界

验收标准：

- 每个样例都生成合法 JSON。
- Watch Response 不超过一屏。
- `headline` 2-6 字。
- `body` 10-28 字。
- 经文出处只用高置信来源；不确定就不写具体章节。
- 情绪类回应必须能当下安抚或开导，不只是摘要。
- 灵感/待办不强行属灵化。
- 危机/危险表达必须包含现实支持方向。
- 不出现禁止话术。
- Supabase Function 部署后 smoke 成功。
- iPhone 详情仍保留完整整理，不被 Quick Response 限制。

当前实现补充：

- `quickResponseProductRules()` 约束 Watch 第一屏短卡片、禁用流程话、禁用冥想化改写、限制高置信经文池。
- `normalizeWatchResponse()` / `highConfidenceWatchResponse()` 对危机、焦虑、羞耻、创伤、孤独、怒气、认罪、交托、饶恕、灵感、待办、普通问题做高置信兜底，避免模型漂移。
- Quick schema 对 `eyebrow/headline/body/footnote` 有长度上限。
- `scripts/presence-quick-response-quality.test.mjs` 做静态/fixture 回归。
- `npm run presence:quick:samples:live` 会实际调用 fast model 跑 12 个中文样例，输出 JSON 卡片并校验字段长度、禁用词、危机现实支持、普通记录不强行属灵化、经文池。

2026-06-06 最新 Quick Response 验证：

- `npm run presence:quick:samples:live`：12/12 pass，failed `0`，latency p50 约 `1579ms`，p90 约 `2635ms`，max 约 `2873ms`。
- Supabase deployed `presence-process` health：`{"ok":true,"openaiConfigured":true,"supabaseConfigured":true}`。
- Supabase raw-audio smoke 5 次：`quick_total_ms` 为 `1928/2052/2475/2789/3406`，p50 约 `2475ms`，p90 低于 `3.5s`。
- Smoke card 示例：`{"eyebrow":"把心交托","headline":"先呼吸","body":"先把惧怕交给主，慢慢吸气三次。","footnote":"腓 4:6","accent":"blue"}`。

## 9. 优先阅读顺序

新会话先读：

```bash
sed -n '1,260p' docs/presence-system-overview.md
sed -n '1,260p' docs/presence-interaction-principles.md
sed -n '1,260p' docs/deep-response-product-selftest-lab.md
sed -n '1,260p' docs/volcengine-provider-handoff.md
sed -n '1,260p' docs/superpowers/plans/2026-06-04-deep-response-volcengine-deployment.md
sed -n '1,260p' docs/superpowers/plans/2026-06-05-deep-response-product-integration-decision.md
sed -n '1,260p' docs/superpowers/specs/2026-05-28-quick-response-design.md
```

然后看代码：

```bash
sed -n '1,260p' package.json
sed -n '1,260p' project.yml
sed -n '1,320p' scripts/deep-response-server.mjs
sed -n '1,260p' scripts/deep-response/lib/env.mjs
sed -n '1,260p' supabase/functions/presence-process/index.ts
sed -n '1,280p' Sources/PresenceWatchApp/TurningRecorderViewModel.swift
sed -n '1,220p' Sources/PresenceWatchApp/TurningReflectionService.swift
```

## 10. 不要做的事

- 不要打印 secret。
- 不要把 DeepResponse 直接塞进 PresenceWatchApp，除非用户明确批准 integration。
- 不要让 Watch 端重新走 WebSocket。
- 不要把 iPhone 放进 DeepResponse 首响关键路径。
- 不要破坏 Action Button 老包稳定行为。
- 不要重新加 Watch 高频轮询。
- 不要为了省电牺牲录音可靠性。
- 不要让 Quick Response 变成长篇讲道。
- 不要把每条记录都强行套经文。
- 不要让用户人工 Watch 测试成为开发 gate；能自动化的先自动化。
