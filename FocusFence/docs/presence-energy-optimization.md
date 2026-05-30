# Presence 能耗优化策略

更新日期：2026-05-29

目标：尽可能省 Watch 电量，但不牺牲核心交互、录音可靠性和 Deep Response 的语音流畅性。

核心原则：

- 录音可靠性高于省电。
- Deep Response 阶段，语音沟通流畅性高于省电。
- 不用高频轮询换体验。
- Watch 可以承担必要的实时任务，但不承担非实时重活。
- iPhone 和服务端优先承担整理、同步、长期存储和重计算。

## Deep Response 的特殊优先级

普通 Quick Response 阶段，Watch 应尽量只做录音、一次上传和一屏回应。

Deep Response 阶段不同。它的核心价值是语音对话流畅性：

- 首响快。
- 可打断。
- 不明显卡顿。
- 连续对话自然。

因此 Deep Response 不能预设“Watch 只采集，其他都交给 iPhone/server”。如果 Watch 本地 VAD、音频预处理、分片上传、流式播放或打断检测能显著降低延迟，就应该允许 Watch 承担这些任务。

功耗优化必须服从 POC 指标。只有在不损害首响、打断和自然度时，才把任务迁移到 iPhone 或 server。

## 当前 Watch 端耗电来源

### 1. 录音本身

`AVAudioRecorder` 使用麦克风、编码器和音频会话。这是核心成本，不能为了省电破坏。

当前配置：

- AAC m4a。
- 16 kHz。
- 单声道。

评价：

- 这个配置已经相对省电和省流量。
- 对语音记录足够。

### 2. 静音检测

录音开始 5 秒后，每 250ms 读取一次 `averagePower()`。

风险：

- 频率不算极高，但长期录音时仍有持续任务。
- 当前依赖 meter，若 recorder 失效可能误判。

建议：

- 第一阶段不立刻降低频率，避免影响 60 秒静音保护判断。
- 加 recording diagnostics 后，再考虑改成 500ms 或 1s。
- 静音保护必须和 recorder health 分开判断。

### 3. 网络上传

当前 Watch 停止录音后一次性 POST m4a 到 Supabase。

评价：

- 这符合“Watch 尽量只上传一次”的原则。
- 不应改成 Watch 持续同步 iPhone。

### 4. Realtime 实验代码

`WatchRealtimeAudioStreamer` 和 `WatchRealtimeReflectionSession` 存在，但不接入主流程。

策略：

- 不在 Quick Response 主流程启用。
- Deep Response 阶段优先验证小智式级联链路。
- Watch 是否承担长期双向 realtime，不按省电预设，按首响、打断、稳定性和续航 POC 决定。

### 5. 快捷指令请求消费

当前没有高频常驻轮询。

只在：

- App 启动 `.task`
- scene active
- NotificationCenter / Darwin notification
- openURL

触发短时间重复消费请求。

评价：

- 这符合省电原则。
- 之前移除 0.35s Timer 是正确方向。

## 当前 iPhone 端耗电来源

### 1. 2 秒 server sync

`PresenceRecordStore.startServerSync()` 当前每 2 秒 `refreshFromServer()`。

优点：

- 简单。
- 能较快把服务端结果同步到 iPhone。

缺点：

- iPhone 前台时也偏频繁。
- 如果未来支持后台，会更不合适。
- 会触发网络、JSON decode、音频缓存检查。

建议优化：

- 短期：只在 iPhone App 前台 active 时运行。
- 中期：录音结束后进入“短时间快速同步窗口”，例如前 30 秒每 2 秒，之后退避到 15-60 秒。
- 长期：用 push / Supabase realtime / 手动 refresh 替代常驻短轮询。

### 2. 远端音频缓存

merge 后会对有 `audioRemoteURL` 的记录创建下载任务。

风险：

- 列表同步时可能下载用户未打开的音频。

建议：

- 后续改为懒加载：详情页或用户点播放时再下载。
- 列表只展示 duration、summary、scripture，不主动缓存全部音频。

## 服务端能耗/成本来源

### 1. 转写

每条正常录音都会调用 OpenAI transcription。

已优化：

- 3.5 秒以内误触不上传，因此不转写。

### 2. Quick + Full 双阶段分析

当前先 quick analysis，再后台 full analysis。

优点：

- Watch 更快拿到一屏回应。

成本：

- 每条记录至少一次转写 + quick 模型 + full 模型。

后续策略：

- Quick Response 质量稳定前保留。
- 如果 full analysis 用户不常看，可延迟到 iPhone 打开详情时生成。
- 或按类型决定是否 full analysis：待办/灵感可轻量，回转/祷告/问题再完整。

### 3. Voice TTS

当前只有明确 `watchVoice` 才生成语音。

策略：

- Quick Response 默认不要 TTS。
- Deep Response 才进入语音链路。

## 推荐省电优化优先级

### P0：不能做的事

- 不恢复 Watch 端高频 Timer 轮询。
- 不缩短静音停止到让用户害怕停顿。
- 不为了省电牺牲 Deep Response 的首响、打断和对话自然度。
- 不让 Watch 承担非实时的完整整理、长期同步和复杂历史管理。

### P1：低风险优化

1. iPhone server sync 改成前台 active + 指数退避。
2. iPhone 远端音频改成懒下载。
3. 给 Watch stop reason / recorder health 加诊断，先观测再调静音检测频率。

### P2：中风险优化

1. 静音检测频率从 250ms 调到 500ms 或 1s。
2. 根据录音时长动态调整 meter 检测频率。
3. Quick/full analysis 按类型分层，减少不必要 full analysis。

### P3：Deep Response 阶段再评估

1. 小智式 ASR/LLM/TTS 级联链路。
2. Watch 本地 VAD、音频预处理、实时上传、流式播放、打断检测。
3. iPhone 是否作为 realtime bridge，只在 POC 证明更快或更稳时采用。
4. Watch/server 直连是否比 Watch/iPhone/server 更适合首响关键路径。

## 当前建议

下一步不要先改 Watch 录音能耗。

先做：

1. Action Button toggle 真机验证。
2. Recording Stability diagnostics。
3. iPhone sync 退避和音频懒下载。

这样能省电，但不碰最敏感的录音可靠性。
