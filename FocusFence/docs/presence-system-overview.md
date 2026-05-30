# Presence 系统总览

更新日期：2026-05-29

这份文档用于后续继续开发「与神同在」时快速理解现有功能、代码结构、数据流、交互原则和优化方向。

## 一句话产品定义

与神同在是 Apple Watch 优先的一键语音记录入口。

核心体验是：

```text
按一下，说话；再按一下，结束。
```

用户不需要先思考 App 是否在前台、后台或未启动。Action Button 是最低摩擦入口；Watch 屏幕按钮是可见的等价入口。

## 当前产品能力

### Watch 端

- 通过 Action Button / 快捷指令 / AppIntent 启动录音。
- App 前台、后台、未启动时，未录音状态下按 Action Button 都应直接开始录音。
- 正在录音时再次按 Action Button，应复用屏幕「结束记录」逻辑停止录音。
- 屏幕按钮支持「开始记录」和「结束记录」。
- 3.5 秒以内录音视为误触，直接丢弃，不上传、不分析。
- 超过 3.5 秒录音后上传服务端处理。
- Watch 上显示一屏 Quick Response。
- Watch 端保留一个 debug-only realtime smoke tester，用于验证 WebSocket/Realtime 可行性，不是主流程。

### iPhone 端

- 展示记录列表、概览指标和最近标签。
- 详情页展示录音播放、转写、分类、经文/祷告/行动/问答等结构化内容。
- 列表支持删除本地记录和本地音频文件。
- 支持从服务端同步最近记录。
- 支持缓存远端录音到本地以便播放。

### Supabase 服务端

- `presence-process` Edge Function 接收 Watch/iPhone 上传的音频。
- 上传音频到 Supabase Storage `presence-audio`。
- 调 OpenAI 转写音频。
- 先生成 Quick Response 并写入 `presence_records`。
- 后台继续生成完整分析并更新同一条记录。
- 支持 GET 拉取最近记录。
- 支持 WebSocket realtime smoke path。

## 代码结构

### Watch App

- `Sources/PresenceWatchApp/PresenceWatchApp.swift`
  - Watch App 入口。
  - 注入 `TurningRecorderViewModel`。
  - 激活 `WatchAudioTransfer`。
  - 处理 `withgod://...` URL。
  - 运行 debug-only realtime smoke tester。

- `Sources/PresenceWatchApp/WatchTurningView.swift`
  - Watch 主界面。
  - 空闲/录音/处理中状态显示。
  - Quick Response 卡片显示。
  - 监听 scene active 后消费 Action Button 请求。

- `Sources/PresenceWatchApp/TurningRecorderViewModel.swift`
  - Watch 录音状态机核心。
  - 管理 `isRecording`、`isProcessing`、`reflection`、`errorMessage`。
  - 处理 Action Button 请求、屏幕按钮点击、去重、开始/停止、误触丢弃、静音保护。
  - 录音结束后调用 `TurningReflectionService` 上传并拿回应。

- `Sources/PresenceWatchApp/WatchAudioRecorder.swift`
  - `AVAudioRecorder` 封装。
  - 当前使用 AAC m4a，16 kHz，单声道。
  - 支持 meter，用于静音判断。
  - 当前不支持主流程 realtime streaming。

- `Sources/PresenceWatchApp/TurningReflectionService.swift`
  - Watch 到服务端的 POST 上传。
  - 也包含 `WatchRealtimeReflectionSession`，用于 WebSocket realtime smoke。

- `Sources/PresenceWatchApp/TurningAppIntents.swift`
  - Watch AppIntent / AppShortcuts。
  - 当前对外动作名仍是「开始回转记录」，内部已按状态 toggle。

- `Sources/PresenceWatchApp/WatchAudioTransfer.swift`
  - 接收 iPhone WatchConnectivity 发来的 `startRecording` 命令。

- `Sources/PresenceWatchApp/WatchRealtimeAudioStreamer.swift`
  - `AVAudioEngine` tap 到 24 kHz PCM 的实验性 realtime 音频流。
  - 当前未接入主录音流程。

- `Sources/PresenceWatchApp/WatchRealtimeSmokeTester.swift`
  - `--realtime-smoke` 启动参数下运行。
  - 用合成 PCM tone 验证 Watch 模拟器到 Supabase/OpenAI realtime path。

- `Sources/PresenceWatchApp/WatchSilentHaptics.swift`
  - 录音开始/停止触感反馈。

### iPhone Presence App

- `Sources/PresenceApp/PresenceApp.swift`
  - iPhone App 入口。
  - 创建 `PresenceRecordStore`。

- `Sources/PresenceApp/PresenceHomeView.swift`
  - 首页、列表、详情页和播放器 UI。
  - 列表行显示类型、时间、时长、摘要、经文、标签和处理状态。
  - 详情页显示 timing 和 realtime diagnostic。

- `Sources/PresenceApp/PresenceRecordStore.swift`
  - iPhone 本地记录 store。
  - 处理 WatchConnectivity 收到的录音文件。
  - 本地保存 `presence-records.json`。
  - 调服务端处理、合并服务端记录、缓存远端音频、删除本地记录。
  - 当前存在 2 秒一次 server sync 循环。

- `Sources/PresenceApp/PresenceServiceClient.swift`
  - iPhone 到 Supabase Function 的 POST/GET client。

- `Sources/PresenceApp/PresenceRecord.swift`
  - 记录数据模型。
  - 包含处理状态、类型、标签、Watch Response、详情、timing、时长等。

- `Sources/PresenceApp/PresenceAppIntents.swift`
  - iPhone 侧 AppIntent。
  - 可通过 WatchConnectivity 向 Watch 发送 startRecording 命令。

- `Sources/PresenceApp/PresenceSpeechTranscriber.swift`
  - iPhone 本地 fallback 转写。

- `Sources/PresenceApp/PresenceAnalyzer.swift`
  - iPhone 本地 fallback 分析。

### Supabase

- `supabase/functions/presence-process/index.ts`
  - 核心服务端处理逻辑。
  - 支持 `GET /health`。
  - 支持 GET 最近 records。
  - 支持 POST 音频处理。
  - 支持 WebSocket realtime smoke。

- `supabase/migrations/202605250001_presence_records.sql`
  - 创建 `presence_records` 表和 storage。

- `supabase/migrations/202605250002_presence_audio_mime_types.sql`
  - 音频 MIME 类型相关迁移。

- `supabase/migrations/202605260002_presence_processing_timing.sql`
  - 增加 processing timing。

- `supabase/migrations/202605280001_presence_duration_seconds.sql`
  - 增加录音时长字段。

### Scripts

- `scripts/deploy-presence-supabase.sh`
  - 部署 Supabase Function。

- `scripts/check-presence-supabase.sh`
  - 检查 Supabase 配置/健康状态。

- `scripts/test-presence-realtime.mjs`
  - Mac 侧 WebSocket realtime smoke test。

- `scripts/test-presence-realtime.test.mjs`
  - Node test runner 下的脚本单测。

- `scripts/presence-server.mjs`
  - 本地开发服务脚本。

## 主流程数据流

### Watch 录音主流程

```text
Action Button / Watch 按钮
-> TurningRecorderViewModel.startRecording()
-> WatchAudioRecorder 写 m4a 文件
-> 用户按结束 / Action Button 二次点击 / 静音保护
-> TurningRecorderViewModel.stopRecording()
-> 小于 3.5 秒：删除本地文件并提示误触丢弃
-> 大于等于 3.5 秒：POST 到 Supabase Function
-> Function 上传音频、转写、生成 Quick Response
-> Watch 显示 Quick Response
-> Function 后台生成完整整理
-> iPhone 通过 server sync 拉到记录
```

### Action Button 请求路径

```text
Action Button
-> 快捷指令执行 AppIntent
-> WatchShortcutStore.requestStartRecording()
-> UserDefaults 标记 + NotificationCenter + Darwin notification
-> App 打开 withgod://record/start
-> PresenceWatchApp.onOpenURL
-> TurningRecorderViewModel.consumePendingShortcutStartIfNeeded()
```

当前状态逻辑：

- 空闲：开始录音。
- 正在录音：停止录音。
- 正在处理：忽略。
- 1 秒内重复触发：去重忽略。

### iPhone 同步流程

```text
iPhone App 启动
-> PresenceRecordStore.startConnectivity()
-> WCSession 激活
-> startServerSync()
-> 每 2 秒 GET Supabase 最近记录
-> merge 到本地 records
-> 如果有远端音频 URL，后台下载缓存
```

## 当前已确认的产品原则

- 入口必须简单。
- Action Button 是主入口。
- Watch 屏幕按钮是可见等价入口。
- 开始/停止必须复用同一套状态机。
- 录音可靠性高于省电优化。
- 省电优化不能通过高风险暂停、过早自动停止或高频轮询换取。
- Quick Response 阶段，Watch 尽量只做采集、一次上传和一屏回应；iPhone 信息来源应以服务器为准。
- Deep Response 阶段，流畅性高于功耗。Watch/iPhone/server 的分工必须由 POC 数据决定，允许 Watch 承担必要的本地实时处理。
- Deep Response 不默认打开，必须由 Quick Response 后邀请进入。

## 当前已知风险

- Watch 录音可能受系统音频中断、后台限制、系统杀进程、低电量、其他 App 抢麦克风影响。
- 现有静音检测依赖 `averagePower()`，底层 recorder 失效时可能被误判为静音。
- iPhone 当前 2 秒一次 server sync，简单但不省电。
- Watch 端当前没有系统性 recording diagnostics。
- `TurningRecorderViewModel` 已承担状态机、快捷指令、静音、上传、播放等多种职责，后续会变重。
- Realtime 代码存在但不在主流程，容易被误以为已经产品化。

## 重要文档索引

- `docs/presence-interaction-principles.md`
  - 核心交互原则。

- `docs/recording-stability-p0.md`
  - 录音不可静默中断 P0。

- `docs/superpowers/specs/2026-05-28-quick-response-design.md`
  - Quick Response 设计。

- `docs/superpowers/specs/2026-05-28-deep-response-design.md`
  - Deep Response 设计。

- `docs/presence-core-roadmap.md`
  - 三条核心主线。

- `docs/realtime-watch-response-plan.md`
  - Realtime/Watch response 早期计划。

- `docs/presence-supabase-production.md`
  - Supabase 生产部署说明。

- `docs/presence-superpowers-handoff.md`
  - 历史交接文档。
