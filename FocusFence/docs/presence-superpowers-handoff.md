# 与神同在 / Presence 新会话交接文档

更新日期：2026-05-28

这份文档用于在新 Codex 会话里，加载 `@superpowers` 插件后继续开发当前项目。请新会话优先阅读本文件，再读代码。

## 一句话目标

把 Apple Watch Ultra 的 Action Button 变成用户日常最低摩擦的语音入口：无论是回转、祷告、灵感、待办、日志、圣经问题还是普通 AI 问答，都可以一键开始录音；结束后快速得到 Watch 一屏回应，并在 iPhone 端保存原始录音、转写、分类、标签、整理结果和趋势。

## 当前工作目录

项目路径：

```bash
/Users/nicho/Documents/New project/FocusFence
```

主要工程：

- `Focus.xcodeproj`
- Scheme：`Presence`
- iPhone bundle：`com.nicho.WithGod`
- Watch bundle：`com.nicho.WithGod.watchkitapp`
- Supabase Edge Function：`supabase/functions/presence-process/index.ts`

注意：当前 git 仓库根目录是：

```bash
/Users/nicho/Documents/New project
```

在 `FocusFence` 里执行 `git status` 会看到大量 untracked 文件。不要只靠 git diff 判断上下文，优先读本交接文档和关键文件。

## 当前产品状态

已经跑通的主流程：

1. Apple Watch Ultra Action Button 触发快捷指令。
2. 快捷指令打开 Watch App「与神同在」。
3. Watch App 自动进入「正在听你说」录音状态。
4. 用户点击「结束记录」。
5. Watch 上传录音到 Supabase Edge Function。
6. 服务端保存录音到 Supabase Storage。
7. 服务端转写、生成 quick Watch response。
8. Watch 展示 AI 生成的一屏短回应。
9. iPhone 自动同步新记录，详情页可以播放录音，显示转写、分类、标签、整理和耗时。
10. 服务端后台继续做 full analysis，覆盖同一条记录的完整详情。

用户实测：

- 普通完整链路主观约 `6s`。
- iPhone 详情 timing 显示约 `6.5s`。
- 关 Wi-Fi 后更慢一些，用户不确定 Watch 走蜂窝还是 iPhone 蓝牙/网络。
- Watch 端 Action Button 冷启动可以自动录音。
- 曾出现：如果 Watch App 已在后台存活，按 Action Button 打开后不自动录音。已做事件触发修复，但需要真机复测。

## 当前关键设计决策

### 1. Watch 不直接请求 OpenAI

当前链路是：

```text
Watch -> Supabase Edge Function -> OpenAI
```

所以国内网络风险主要在：

- Watch -> Supabase HTTPS/WebSocket
- Supabase -> OpenAI

不是 Watch 直连 OpenAI。

### 2. 服务端 quick-first

服务端现在不是等完整整理后再回 Watch，而是：

1. 上传音频
2. 创建 signed audio URL
3. 转写
4. `analyzeQuickWatchResponse()`
5. upsert quick record，返回 Watch
6. 后台 `finalizeFullRecord()` 做完整整理

之前尝试过“一次主分析直接生成完整结果”，实测更慢：smoke test 约 `11s+`，所以已回退到 quick-first。

### 3. Realtime 当前并不是真正端到端快速回应

当前 Watch 已经有 realtime 分片上传代码，但实际逻辑是：

```text
Watch PCM chunks -> Supabase WS -> OpenAI Realtime transcription
stop -> input_audio_buffer.commit
OpenAI transcription completed
服务端再调用 Responses API 的 analyzeQuickWatchResponse()
服务端发 watch_response
```

也就是说，现在只流式上传音频和转写，最后回应仍要等另一次 LLM 调用。要根本提速，需要让 quick card 生成也进入 Realtime 会话，或者至少先用脚本精确测出每段耗时。

## 关键文件地图

### Watch 端

- `Sources/PresenceWatchApp/PresenceWatchApp.swift`
  - Watch app 入口。
  - 激活 WatchAudioTransfer。
  - `.onOpenURL` 会调用 `recorder.startFromShortcut()`。

- `Sources/PresenceWatchApp/TurningAppIntents.swift`
  - AppIntent：`StartTurningRecordIntent`
  - `openAppWhenRun = true`
  - `perform()` 里调用 `WatchShortcutStore.requestStartRecording()`。
  - 用户的 Action Button 快捷指令最终执行这个动作。

- `Sources/PresenceWatchApp/TurningRecorderViewModel.swift`
  - Watch 录音主状态机。
  - `startOnInitialDisplayIfNeeded()`：冷启动/首次显示自动录音。
  - `startFromShortcut()`：快捷指令触发。
  - `consumePendingShortcutStartRepeatedly()`：短时间内多次尝试消费 Action Button 请求。
  - `startRecording()`：启动稳定录音文件 + realtime streamer。
  - `stopRecording()`：停止录音、发送 WatchConnectivity、本地文件上传到服务端、realtime/fallback 赛跑。
  - 误触过滤：录音时长 `< 1.4s` 会忽略并删除文件。
  - 已移除 Watch 前台 Timer 轮询，不要重新加常驻轮询，用户明确担心耗电。

- `Sources/PresenceWatchApp/WatchTurningView.swift`
  - Watch UI。
  - `.task`：首次显示时调用 `startOnInitialDisplayIfNeeded()` 和消费 shortcut 请求。
  - `.onChange(scenePhase == .active)`：从后台回前台时消费 shortcut 请求。
  - 不再有 0.35s Timer 轮询。

- `Sources/PresenceWatchApp/WatchRealtimeAudioStreamer.swift`
  - AVAudioEngine tap。
  - 输入音频转换成 PCM 16-bit、24kHz、mono。
  - `audioChunks()` 输出 `AsyncStream<Data>`。

- `Sources/PresenceWatchApp/TurningReflectionService.swift`
  - 普通 HTTP POST：`TurningReflectionService.reflect(...)`
  - WebSocket realtime：`WatchRealtimeReflectionSession`
  - realtime URL：把 `https` endpoint 改成 `wss`，query `?realtime=1`。
  - 当前只接收 `watch_response` 或 `error`。

- `Sources/PresenceWatchApp/WatchAudioRecorder.swift`
  - 稳定 m4a 录音文件来源，普通上传和 iPhone 本地保存依赖它。

- `Sources/PresenceWatchApp/WatchAudioTransfer.swift`
  - WatchConnectivity 把本地录音传给 iPhone，用于本地快速占位和补充本地音频。
  - 最终产品主链路应是 Watch -> Server，Watch -> iPhone 只是本地快速占位/补充。

- `Sources/PresenceWatchApp/WatchSilentHaptics.swift`
  - 开始/结束触觉反馈。
  - 用户测试后选择 `directionUp` / `directionDown` 这类触觉，因为强触感通常伴随声音；声音不能接受。

### iPhone 端

- `Sources/PresenceApp/PresenceRecord.swift`
  - 数据模型。
  - `PresenceProcessingTiming` 包含 upload/signed_url/transcription/quick/full 等耗时。

- `Sources/PresenceApp/PresenceRecordStore.swift`
  - iPhone 记录状态和同步。
  - WatchConnectivity 收到文件后创建本地占位。
  - `syncFromServer()` 自动拉服务端记录。
  - `cacheRemoteAudioIfNeeded()` 下载远程录音到本地，提升播放稳定性。

- `Sources/PresenceApp/PresenceServiceClient.swift`
  - iPhone 调服务端 POST/GET。
  - 解码 `audioResponseURL`、`processingTiming`、`realtimeDiagnostic`。

- `Sources/PresenceApp/PresenceHomeView.swift`
  - iPhone 首页和详情页。
  - 详情页包含原始录音播放器、处理耗时面板。
  - UI 目前用户仍觉得不够优雅、可读性有问题，后续需要重做视觉。

### 服务端

- `supabase/functions/presence-process/index.ts`
  - Supabase Edge Function 主文件。
  - `POST`：普通完整音频上传。
  - `GET`：列出记录。
  - `WebSocket`：`?realtime=1` 走 `handleRealtimeSocket()`。
  - `transcribeAudio()`：OpenAI transcription。
  - `analyzeQuickWatchResponse()`：quick Watch response。
  - `finalizeFullRecord()`：后台完整分析。

- `supabase/migrations/202605250001_presence_records.sql`
  - `presence_records` 表。

- `supabase/migrations/202605250002_presence_audio_mime_types.sql`
  - audio mime 类型调整。

- `supabase/migrations/202605260002_presence_processing_timing.sql`
  - processing timing 字段。

### 文档

- `docs/presence-supabase-production.md`
  - Supabase 生产服务端部署说明。

- `docs/realtime-watch-response-plan.md`
  - 旧版分阶段延迟优化计划。仍有参考价值，但以本交接文档为准。

- `docs/presence-superpowers-handoff.md`
  - 本文件。

## 环境变量和密钥

本地 iPhone/Watch 构建使用：

```bash
.env.local
```

里面应包含：

```bash
PRESENCE_PROCESS_ENDPOINT=https://clliaevassjqgpeovaqf.functions.supabase.co/presence-process
PRESENCE_CLIENT_TOKEN=...
```

不要在回复里打印真实 token。

Supabase 部署使用：

```bash
supabase/.env.local
```

典型字段：

```bash
SUPABASE_PROJECT_REF=...
SUPABASE_ACCESS_TOKEN=...
SUPABASE_URL=...
SUPABASE_SECRET_KEY=...
SUPABASE_DB_PASSWORD=...
OPENAI_API_KEY=...
PRESENCE_CLIENT_TOKEN=...
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-transcribe
OPENAI_ANALYSIS_MODEL=gpt-5.5
OPENAI_FAST_ANALYSIS_MODEL=gpt-4.1-nano
OPENAI_SPEECH_MODEL=gpt-4o-tts
OPENAI_SPEECH_VOICE=alloy
```

用户之前问过 service role key，已配置完成。

Supabase 项目：

- project ref：`clliaevassjqgpeovaqf`
- 项目名用户称为：`WithGOD`

## 构建和安装命令

构建前必须 source `.env.local`，否则 Watch/iPhone Info.plist 里的 endpoint/token 可能为空。

```bash
cd "/Users/nicho/Documents/New project/FocusFence"
set -a && source .env.local && set +a
xcodebuild -project Focus.xcodeproj \
  -scheme Presence \
  -configuration Debug \
  -destination generic/platform=iOS \
  -derivedDataPath /Users/nicho/Library/Developer/Xcode/DerivedData/Focus-cybkojzcswzxyscwwemxdhsnugsk \
  build
```

检查构建产物配置：

```bash
plutil -p /Users/nicho/Library/Developer/Xcode/DerivedData/Focus-cybkojzcswzxyscwwemxdhsnugsk/Build/Products/Debug-iphoneos/Presence.app/Watch/Presence.app/Info.plist | rg -n "PresenceWatch(ClientToken|ProcessEndpoint)" -A1 -B1
plutil -p /Users/nicho/Library/Developer/Xcode/DerivedData/Focus-cybkojzcswzxyscwwemxdhsnugsk/Build/Products/Debug-iphoneos/Presence.app/Info.plist | rg -n "Presence(ClientToken|ProcessEndpoint)" -A1 -B1
```

iPhone 安装：

```bash
xcrun devicectl device install app \
  --timeout 120 \
  --device 8A2F1809-F392-52F3-A63D-36193C6DA857 \
  /Users/nicho/Library/Developer/Xcode/DerivedData/Focus-cybkojzcswzxyscwwemxdhsnugsk/Build/Products/Debug-iphoneos/Presence.app
```

Watch 安装：

```bash
xcrun devicectl device install app \
  --timeout 120 \
  --device 6B873DBC-11D7-5F93-AA64-96FB0531C28B \
  /Users/nicho/Library/Developer/Xcode/DerivedData/Focus-cybkojzcswzxyscwwemxdhsnugsk/Build/Products/Debug-watchos/Presence.app
```

设备 IDs：

- iPhone：`8A2F1809-F392-52F3-A63D-36193C6DA857`
- Watch：`6B873DBC-11D7-5F93-AA64-96FB0531C28B`

Watch 安装经常失败：

```text
Timed out while attempting to establish tunnel using negotiated network parameters.
```

常用处理：

```bash
killall CoreDeviceService
xcrun devicectl list devices --timeout 30
```

然后让用户确认：

- Watch 解锁、亮屏。
- Watch 靠近 iPhone。
- Mac、iPhone、Watch 在同一 Wi-Fi。

## Supabase 部署和 smoke test

部署：

```bash
npm run presence:supabase:deploy
```

健康检查：

```bash
npm run presence:supabase:health
```

普通 POST smoke test：

```bash
set -a && source .env.local && set +a
curl -s -w "\nHTTP:%{http_code}\nTIME:%{time_total}\n" \
  -X POST "$PRESENCE_PROCESS_ENDPOINT" \
  -H "Content-Type: audio/mp4" \
  -H "X-Presence-Source: codex-smoke-test" \
  -H "X-Presence-Client-Token: $PRESENCE_CLIENT_TOKEN" \
  --data-binary @/private/tmp/presence-smoke.m4a
```

最近一次普通 POST smoke test，quick-first 链路大概：

- `upload_ms`: 198ms
- `signed_url_ms`: 39ms
- `transcription_ms`: 1360ms
- `quick_analysis_ms`: 1086ms
- `quick_upsert_ms`: 243ms
- `quick_total_ms`: 2929ms
- HTTP total：约 4.6s

用户真实录音最近观测：

- Watch 主观约 6s。
- iPhone timing 约 6.5s。
- full analysis 常见 6-8s。

结论：上传不是瓶颈；转写和 LLM 波动是主瓶颈。realtime 的目标是把转写等待前移到说话过程中，并尽量减少 stop 后等待。

## OpenAI Realtime 官方要点

已用 OpenAI 官方 docs 核对：

- Realtime WebSocket 音频流用 `input_audio_buffer.append` 分片发送音频。
- VAD 关闭时，停止说话后需要 `input_audio_buffer.commit`。
- 然后需要 `response.create` 触发模型回应。
- 服务端可能返回：
  - `conversation.item.input_audio_transcription.delta`
  - `conversation.item.input_audio_transcription.completed`
  - `response.output_text.delta`
  - `response.output_text.done`
  - `response.done`

当前服务端只等 transcription completed 后再外部调用 Responses API。下一步应测试并改造为：

```text
session.update:
  - 输入音频 PCM 24kHz
  - 开启 transcription
  - turn_detection null
  - 指定 instructions：直接生成 watchResponse JSON

Watch sends audio chunks -> input_audio_buffer.append
Stop -> input_audio_buffer.commit
Server -> response.create
OpenAI -> response.output_text.delta / done
Server parses JSON -> sends watch_response to Watch
```

这样可以避免第二次 Responses API 调用。

## 下一阶段：流式传输测试方案

目标：不要让用户反复手动配合测试。能自测的全部自测，只有真表网络/Action Button 行为必须让用户验证。

### 阶段 A：服务端流式自测脚本

新增脚本建议：

```bash
scripts/test-presence-realtime.mjs
```

脚本职责：

1. 读取 `.env.local`。
2. 把 `PRESENCE_PROCESS_ENDPOINT` 转成 `wss://.../presence-process?realtime=1`。
3. 生成一段本地 PCM 24kHz mono int16 测试音频，或者读取 fixture PCM。
4. 建立 WebSocket。
5. 按 100-200ms 间隔发送 PCM chunk，模拟 Watch 实时说话。
6. 发送 `{"type":"stop"}`。
7. 打印 timing：
   - ws_connect_ms
   - session_ready_ms
   - first_chunk_sent_ms
   - chunks_sent
   - stop_sent_ms
   - first_transcript_delta_ms
   - transcript_completed_ms
   - response_create_sent_ms
   - first_output_text_delta_ms
   - watch_response_ms
   - total_ms
8. 打印收到的 transcript/watchResponse。

接受标准：

- Mac 本地跑服务端 realtime smoke test 成功。
- stop 后 watch_response 目标小于 2.5s。
- 失败时错误信息在终端清晰展示，不显示到 Watch UI。

### 阶段 B：改服务端 realtime 为同一 Realtime 会话生成 watchResponse

当前 `handleRealtimeSocket()` 应改造：

1. `session.update` 增加 instructions，让 Realtime 模型直接输出严格 JSON：

```json
{
  "type": "...",
  "summary": "...",
  "watchResponse": {
    "eyebrow": "...",
    "headline": "...",
    "body": "...",
    "footnote": "...",
    "accent": "green|blue|gold|red|gray"
  },
  "responseMode": "watchText|watchVoice|silentSave|iphoneOnly"
}
```

2. Stop 后：
   - `input_audio_buffer.commit`
   - `response.create`

3. 监听：
   - transcription delta/completed 只用于 timing 和保存 transcript。
   - `response.output_text.delta` 累积文本。
   - `response.output_text.done` 或 `response.done` 解析 JSON。
   - 解析成功后发 `watch_response` 给 Watch。

4. fallback：
   - 如果 realtime JSON 解析失败，服务端可以基于 transcript 调 `analyzeQuickWatchResponse()`。
   - 如果 realtime 完全失败，Watch 端已经有普通 POST fallback。

### 阶段 C：Watch 端 debug 自测入口

用户要求：能本地自测就不要每次让他测。

建议在 Watch App 增加 debug-only 流式测试入口或启动参数：

- 不走真实麦克风。
- 用固定 PCM 分片调用 `WatchRealtimeReflectionSession`。
- 在 iPhone 或 Xcode logs 显示 realtime diagnostic。

但这一步需要注意：模拟器和真 Watch 网络环境不同，模拟器只能测代码逻辑，不能证明真表国内网络能连 Supabase WebSocket。

### 阶段 D：真机最终验证

只有这些需要用户配合：

1. Action Button 在以下状态都能自动录音：
   - App 已杀掉/冷启动。
   - App 在后台。
   - App 前台显示上一条回应。
   - App 刚回前台。
2. Watch 真机 realtime 成功率。
3. 成功时 stop 后几秒显示回应。
4. 失败时是否自动走普通上传 fallback，且 iPhone 仍能拿到完整记录。

## Action Button 后台态问题当前状态

用户发现：

- 如果 Watch App 被杀掉，Action Button 可以打开并自动录音。
- 如果 Watch App 在后台存活，Action Button 打开后可能不会自动录音。

已经修改：

- `TurningAppIntents.swift`
  - `perform()` 改为调用 `WatchShortcutStore.requestStartRecording()`。
- `TurningRecorderViewModel.swift`
  - `WatchShortcutStore.requestStartRecording()` 会写入 UserDefaults 并发 `NotificationCenter` 通知。
  - ViewModel init 时监听 `WatchShortcutStore.startRequestedNotification`。
  - 收到通知后调用 `consumePendingShortcutStartRepeatedly()`。
- `WatchTurningView.swift`
  - `.task` 和 `.onChange(scenePhase == .active)` 会消费 pending shortcut。
  - 已移除 0.35 秒 Timer 轮询，避免 Watch 耗电争议。

未完成：

- 这版移除 Timer 后尚未成功安装到 Watch 真机复测。
- 上一次 iPhone 已安装成功，但 Watch 直装失败，因为 CoreDevice tunnel timeout。

## 用户对 UI/体验的明确要求

### Watch

- Action Button 必须是最低摩擦入口。
- 按键后必须马上进入录音，不要再点屏幕。
- 开始录音不能有声音，只能触觉提示。
- 结束录音不能有声音，只能触觉提示。
- 强触感往往伴随系统声音，因此现在先使用 `directionUp` / `directionDown`。
- 短误触录音要自动忽略，现在 `<1.4s` 已忽略。
- 默认不能语音回应。
- 只有用户明确说“语音回答我/用声音告诉我/直接说出来”等，才允许 Watch 播放语音。
- 一屏文字回应要能一眼看懂，不需要滚动。
- Word Cloud 海报风格是长期目标，但当前实现用户多次不满意。暂时应先保证内容和速度，不要继续在低质量 word cloud 上耗时间。

### iPhone

- 要自动同步，不手动刷新。
- 详情页必须能播放原始录音。
- 播放器要专业：总时长、当前进度、拖动、暂停、前后跳转。
- UI 当前太难看、文字可读性差，需要后续重做，但不是流式传输当前第一优先级。
- 处理状态要清楚，不能一上来红色失败，后来又成功。
- 开发诊断信息不要显示在 Watch 上，可以放 iPhone 开发诊断区。

## 当前已知问题

1. Watch 真机安装不稳定
   - 经常 CoreDevice tunnel timeout。
   - 需要用户解锁 Watch、亮屏、同 Wi-Fi、靠近 iPhone 后重试。

2. Realtime 在真 Watch 上曾出现 `NSURLErrorDomain Code=-1009`
   - 报错：`The Internet connection appears to be offline`
   - URL：`wss://clliaevassjqgpeovaqf.functions.supabase.co/presence-process?realtime=1`
   - Mac 本地 WebSocket smoke 曾成功过，因此问题可能是真表网络路径/Supabase WebSocket 国内稳定性。

3. 当前 realtime 不是端到端回应流式
   - 只流式音频和转写。
   - quick card 仍然走第二次 Responses API。

4. UI 仍不满意
   - Watch quick response card 需要后续重新设计。
   - iPhone 明亮 UI 可读性差，需要重新做视觉层级和颜色对比。

5. 当前 repo git 状态不干净
   - 很多文件 untracked。
   - 不要做 destructive git 操作。

## 下一次新会话建议第一步

新会话加载 Superpowers 后，直接做这几步：

1. 阅读本文件：

```bash
sed -n '1,260p' docs/presence-superpowers-handoff.md
```

2. 阅读关键 realtime 代码：

```bash
sed -n '280,455p' supabase/functions/presence-process/index.ts
sed -n '1,140p' Sources/PresenceWatchApp/WatchRealtimeAudioStreamer.swift
sed -n '130,275p' Sources/PresenceWatchApp/TurningReflectionService.swift
sed -n '1,220p' Sources/PresenceWatchApp/TurningRecorderViewModel.swift
```

3. 新增服务端 realtime 自测脚本：

```bash
scripts/test-presence-realtime.mjs
```

4. 先跑 Mac -> Supabase -> OpenAI Realtime 的自动化测试，不让用户配合。

5. 根据测试结果改 `handleRealtimeSocket()`，把 quick card 生成合并进 OpenAI Realtime 会话。

6. 部署 Supabase：

```bash
npm run presence:supabase:deploy
```

7. 再构建安装 Watch/iPhone，真机验证 Action Button 后台态和 realtime 成功率。

## 新会话不要做的事

- 不要重新设计产品目标，当前目标已经明确。
- 不要把 Watch 默认语音回应打开。
- 不要在 Watch 上显示 realtime error 的长技术报错。
- 不要重新加 Watch 前台 Timer 轮询。
- 不要只做普通上传优化，用户明确要求从根本上推进流式上传。
- 不要让用户反复测试本地可自动化验证的环节。
- 不要打印 `.env.local` 里的真实 token/key。
- 不要使用 destructive git 命令。

