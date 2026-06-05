# DeepResponse 产品自检实验室最终交付说明

交付对象：后续继续开发 DeepResponse 产品的 Codex。

## 1. 当前状态

Repo root:

- `/Users/nicho/Documents/New project`

项目目录:

- `/Users/nicho/Documents/New project/FocusFence`

当前分支:

- `codex/deep-response-lab`

最新 commit:

- 本轮提交后以 `git log -1 --oneline` 为准。

Push 状态:

- 本轮提交后应 push 到 `origin/codex/deep-response-lab`。

工作区:

- 本轮完成后应保持干净。
- 最终验收必须重新检查 `git status --short --branch`。

## 2. 实验室总入口命令

标准入口:

```bash
cd "/Users/nicho/Documents/New project/FocusFence"
npm run deep:lab:selftest
```

常用参数:

```bash
npm run deep:lab:selftest -- --out-dir /private/tmp/deep-response-lab-manual
npm run deep:lab:selftest -- --skip-build
npm run deep:lab:selftest -- --skip-sim
npm run deep:lab:selftest -- --endpoint http://124.174.96.149:8797
npm run deep:lab:selftest -- --turns 4
npm run deep:lab:selftest -- --watch-turns 2
npm run deep:lab:selftest -- --fail-fast
```

重要说明:

- `--skip-sim` 只能用于调试 server/audio/report，不可作为最终验收。
- 最终验收必须跑不带 `--skip-sim` 的 `npm run deep:lab:selftest`。
- 默认 endpoint 是 Fire/Volcengine: `http://124.174.96.149:8797`

运行前置条件:

- Mac 上有 Xcode / `xcodebuild` / `xcrun simctl`。
- 可用 watchOS Simulator。
- 网络能访问 Fire/Volcengine DeepResponse endpoint。
- 仓库在 `codex/deep-response-lab`。
- 从 `/Users/nicho/Documents/New project/FocusFence` 运行 npm 命令。

## 3. 最新一次成功 selftest 报告目录

最新成功报告目录:

```text
/private/tmp/deep-response-lab-selftest-2026-06-05T05-37-31-389Z
```

核心结果:

- `overall`: `PASS`
- `failures`: `[]`
- screenshots: `2`
- audio audits: `4`
- server sessions: `3`

## 4. 报告目录结构

最新报告目录内容:

```text
/private/tmp/deep-response-lab-selftest-2026-06-05T05-37-31-389Z/
├── summary.json
├── summary.md
├── server-events.json
├── timing.json
├── turns.json
├── audio-audit.json
├── simulated-mic-speech.pcm
├── audio/
│   ├── turn_1780637851476_1.pcm
│   ├── turn_1780637856824_2.pcm
│   ├── turn_1780637862078_3.pcm
│   └── turn_1780637866567_4.pcm
└── screenshots/
    ├── running.png
    └── done.png
```

文件说明:

- `summary.json`: 机器判定合同，后续 Codex 应优先看这个。
- `summary.md`: 人类可读摘要。
- `server-events.json`: DeepResponse server session/turn/generation events 归档。
- `timing.json`: 每个 turn 的 ASR/LLM/TTS/HTTP timing。
- `turns.json`: session 级摘要。
- `audio-audit.json`: AI 返回音频的 PCM 审计结果。
- `audio/*.pcm`: 每个 turn 返回给 Watch/准备播放的音频 artifact。
- `screenshots/running.png`: Watch Simulator 运行中截图。
- `screenshots/done.png`: Watch Simulator 完成截图。
- raw console log 目前不单独落盘；需要时请运行时自行重定向，例如：

```bash
npm run deep:lab:selftest -- --out-dir /tmp/lab > /tmp/lab.log 2>&1
```

## 5. `summary.json` 关键字段

### `overall`

- `PASS` 或 `FAIL`。
- 后续开发 gate 只接受 `PASS`。

### `mouth`

“嘴巴”，音频 fixture 模拟用户说话。

覆盖场景:

- `normal_turn`
- `multi_turn`
- `silent_recovery`
- `goodbye_end`
- `interrupt_entry`

`mouth.ok` 必须为 `true`。

### `eye`

“眼睛”，Watch Simulator + DeepResponseWatchLab 可见路径。

包含:

- `screenshots`
- `stateFlow`
- `checkedFields`
- `watch`

最新状态流:

```text
Listening -> Recording -> Thinking -> Speaking -> Waiting playback -> Listening -> Done
```

检查字段:

- `you`
- `god`
- `timing`
- `error`

当前不是 OCR，全量 UI 状态精确判断依赖截图 + source/state-machine tests。

### `ear`

“耳朵”，审计返回给 Watch/准备播放的 PCM 音频。

检查:

- 非静音
- duration
- RMS
- peak
- clipping
- received/queued/scheduled/completed bytes proxy
- expected duration vs actual drain timing proxy

不能替代真实扬声器、AirPods、音量、人耳听感。

### `server`

“服务端”，归档 server 证据。

包含:

- conversation session
- idle session
- abort session
- turn/generation events
- ASR/LLM/TTS/HTTP timing
- `turn_done` / `session_end` / abort 证据

`server-events.json` 事件带 `source` 字段，便于确认覆盖来源:

- `conversation_turn`
- `conversation_lifecycle`
- `idle`
- `abort`
- `abort_next_turn`

### `judge`

“裁判”，总判定。

- `judge.ok` 必须为 `true`。
- `judge.failures` 必须为空。
- 如果失败，先看这里定位类别。

### `turns`

- 当前结构里 session 摘要写在 `turns.json`。
- 每 turn 的详细事件和 timing 在 `server-events.json` / `timing.json` / `summary.json.server.timing`。

### `failures`

- 顶层输出会打印 failures。
- summary 中主要看 `judge.failures`。
- FAIL 时不要继续产品开发，先修失败原因。

## 6. 最新一次 selftest 核心结果摘要

报告:

- `/private/tmp/deep-response-lab-selftest-2026-06-05T05-37-31-389Z/summary.json`

overall:

- `PASS`

覆盖场景:

- 正常 turn: PASS
- 多轮连续对话: PASS
- 静音/无输入恢复: PASS
- 拜拜/用户结束 session: PASS
- 打断入口/abort next turn: PASS

server sessions:

- conversation: PASS
- idle: PASS
- abort: PASS

首响/耗时:

- 4 个 conversation turn 的 `http_stop_to_first_audio_ms`:
  - `205ms`
  - `198ms`
  - `206ms`
  - `197ms`
- `http_first_audio_after_first_phrase_ms`:
  - `121ms`
  - `109ms`
  - `115ms`
  - `114ms`
- `voice_pipeline_total_ms` 大约:
  - `4230ms` 到 `4250ms`
- `llm_first_token_ms` 大约:
  - `369ms` 到 `437ms`
- `llm_total_ms` 大约:
  - `646ms` 到 `799ms`

音频审计:

- 4 个 turn 均 PASS。
- PCM 文件均非静音。
- RMS 大约: `0.118` 到 `0.139`
- peak 大约: `0.914` 到 `0.963`
- clippedSamples: 全部 `0`
- 音频时长大约: `5.0s` 到 `6.3s`
- 每 turn bytes 大约: `243KB` 到 `304KB`

UI 状态流:

- PASS
- 保存了:
  - `/private/tmp/deep-response-lab-selftest-2026-06-05T05-37-31-389Z/screenshots/running.png`
  - `/private/tmp/deep-response-lab-selftest-2026-06-05T05-37-31-389Z/screenshots/done.png`
- 状态流记录:

```text
Listening -> Recording -> Thinking -> Speaking -> Waiting playback -> Listening -> Done
```

server events:

- 齐全。
- `server-events.json` 覆盖 conversation turn、conversation lifecycle、idle、abort、abort next-turn。
- 可从以下文件追查:
  - `/private/tmp/deep-response-lab-selftest-2026-06-05T05-37-31-389Z/server-events.json`
  - `/private/tmp/deep-response-lab-selftest-2026-06-05T05-37-31-389Z/timing.json`

## 6A. 本轮产品自检优化记录

本轮 baseline:

- `npm run test:node`: PASS，`270/270`
- `npm run deep:watchlab:build:volc`: `BUILD SUCCEEDED`
- `npm run deep:lab:selftest`: PASS，报告 `/private/tmp/deep-response-lab-selftest-2026-06-05T05-29-25-247Z`

发现的问题:

- 产品 bug: 当前自动化覆盖下未发现阻塞 DeepResponse Watch Lab 真实体验的产品 bug。
- 实验室局限: baseline `server-events.json` 只归档 conversation turn 事件，未归档 conversation lifecycle、idle、abort、abort next-turn 的事件明细，会阻塞后续用报告判断 goodbye/silent/interrupt。
- 环境问题: 无。
- 可接受后续增强: OCR/像素语义 UI 检查、真实扬声器/人耳听感、更多 fixture、真机辅助体验 checklist。

修复:

- `scripts/deep-response-lab.mjs` 新增 server evidence 聚合，归档 conversation lifecycle、idle、abort、abort next-turn 事件。
- `scripts/test-deep-response-http-smoke.mjs` 的 idle probe 返回已观察事件。
- `scripts/test-deep-response-http-abort.mjs` 的 abort probe 和 abort 后下一轮 summary 返回已观察事件。
- `scripts/deep-response-lab.test.mjs` 增加回归，防止上述证据来源从报告中消失。

修复后证据:

- focused: `node --test scripts/deep-response-lab.test.mjs scripts/test-deep-response-http-smoke.test.mjs scripts/test-deep-response-http-abort.test.mjs` PASS，`18/18`
- full product lab: `npm run deep:lab:selftest` PASS，报告 `/private/tmp/deep-response-lab-selftest-2026-06-05T05-37-31-389Z`
- `summary.json.overall`: `PASS`
- mouth/eye/ear/server/judge: all `PASS`
- `server-events.json` 已包含 `user_goodbye` session_end、`idle_timeout` session_end、`idle_goodbye_complete` audio_done、abort 事件和 abort next-turn `turn_done`

## 7. 已纳入回归的真实产品层问题

本次实验室实际捕获并修复了一个真实产品层问题。

问题:

- server 可能先发出/被 Watch 观察到 `turn_done`，而 audio pull 稍后才拿到音频。
- 旧 Watch 逻辑在看到 `turn_done` 后就退出 HTTP polling。
- 如果同轮 audio pull 没有拿到音频，Watch 可能错过随后到达的 AI 音频。

修复:

- `DeepResponseRealtimeClient.pollHTTPSessionUntilDone()` 现在记录:
  - `sawTurnDone`
  - `sawAudioDone`
  - `receivedAudioForCurrentTurn`
- 普通 turn 只有在 `turn_done + audio_done + 实际收到音频` 后才退出。
- `session_end` 仍可直接结束。
- provider error 可通过 `lastError` 退出。

回归测试:

- 文件:
  - `/Users/nicho/Documents/New project/FocusFence/scripts/deep-response-watch-ui.test.mjs`
- 测试名:
  - `DeepResponse Watch HTTP polling waits for audio after turn_done before exiting`

关于 `llm 0 · tts 0` timing 显示问题:

- 已纳入稳定 source regression。
- 文件:
  - `/Users/nicho/Documents/New project/FocusFence/scripts/deep-response-watch-ui.test.mjs`
- 覆盖点:
  - `DeepResponseTiming` 解码 cascade LLM fields。
  - Watch UI 使用 `watchSummaryText`。
  - 防止 UI 回退到旧的 `llm_first_phrase_ms / tts_first_audio_ms` 直读方式。
- 测试名:
  - `DeepResponse Watch timing summary supports cascade LLM metrics`
- 当前实验室完成标准主要由“捕获并修复 Watch turn_done/audio race”满足；`llm 0 · tts 0` 也保留为 Node/source 回归 gate。

## 8. 已跑过的验证命令和结果

最终验证命令:

```bash
cd "/Users/nicho/Documents/New project/FocusFence"
npm run deep:lab:selftest
```

结果:

- PASS
- 输出:
  - `/private/tmp/deep-response-lab-selftest-2026-06-05T05-37-31-389Z/summary.json`
  - `/private/tmp/deep-response-lab-selftest-2026-06-05T05-37-31-389Z/summary.md`

Node tests:

```bash
npm run test:node
```

结果:

- PASS
- `270/270` passed

DeepResponseWatchLab build:

```bash
npm run deep:watchlab:build:volc
```

结果:

- BUILD SUCCEEDED

其他相关 focused tests:

```bash
node --test scripts/deep-response-lab.test.mjs
```

结果:

- PASS

```bash
node --test --test-name-pattern "HTTP polling waits for audio after turn_done" scripts/deep-response-watch-ui.test.mjs
```

结果:

- RED 后修复，再 GREEN

```bash
node --test scripts/deep-response-lab.test.mjs scripts/run-deep-response-watch-sim-fakemic.test.mjs scripts/package-scripts.test.mjs
```

结果:

- PASS

## 9. 修改/新增的主要文件清单

新增:

- `/Users/nicho/Documents/New project/FocusFence/scripts/deep-response-lab.mjs`
  - 产品自检实验室总 runner。
  - 负责 mouth/eye/ear/server/judge 聚合。
  - 生成 `summary.json` / `summary.md` / audio/server/timing artifacts。

- `/Users/nicho/Documents/New project/FocusFence/scripts/deep-response-lab.test.mjs`
  - 实验室 contract tests。
  - 覆盖 CLI 解析、音频审计、summary 五类结构、judge failure。

- `/Users/nicho/Documents/New project/FocusFence/docs/deep-response-product-selftest-lab.md`
  - 后续 Codex 使用说明/runbook。

- `/Users/nicho/Documents/New project/FocusFence/docs/superpowers/plans/2026-06-05-deep-response-product-selftest-lab.md`
  - 实现计划和任务分解。

- `/Users/nicho/Documents/New project/FocusFence/docs/deep-response-selftest-lab-final-handoff.md`
  - 本最终交付整理文件。

修改:

- `/Users/nicho/Documents/New project/FocusFence/package.json`
  - 新增 `deep:lab:selftest`。

- `/Users/nicho/Documents/New project/FocusFence/scripts/package-scripts.test.mjs`
  - 防止入口命令被删。

- `/Users/nicho/Documents/New project/FocusFence/scripts/test-deep-response-http-conversation.mjs`
  - 新增 `--include-evidence`。
  - 可保留 raw events/audio chunks 给实验室归档。
  - 默认 compact 输出不变。

- `/Users/nicho/Documents/New project/FocusFence/scripts/run-deep-response-watch-sim-fakemic.mjs`
  - 无 booted watchOS simulator 时自动 boot 一个可用 simulator。
  - 让实验室更接近一键运行。

- `/Users/nicho/Documents/New project/FocusFence/Sources/DeepResponseWatchLab/DeepResponseRealtimeClient.swift`
  - 修复 Watch HTTP polling 过早退出问题。
  - 等待 `turn_done + audio_done + 实际音频`。

- `/Users/nicho/Documents/New project/FocusFence/scripts/deep-response-watch-ui.test.mjs`
  - 新增 Watch polling regression gate。
  - 保留 timing display regression gate。

- `/Users/nicho/Documents/New project/FocusFence/docs/superpowers/plans/2026-05-31-deep-response-active-state.md`
  - 记录产品自检实验室、最新命令、报告结构、限制、真实 bug 和回归。

## 10. 给后续 Codex 的使用说明

什么时候必须跑 selftest:

- 改 DeepResponse 连续对话。
- 改 WatchLab 录音/上传/轮询/播放/状态显示。
- 改打断/barge-in。
- 改 session end / goodbye / idle timeout。
- 改 memory candidate / memory recall。
- 改 server event/audio/timing。
- 改 DeepResponse 语音输出、TTS、ASR、LLM cascade。
- 改任何可能影响 `you/god/timing/error` Watch UI 的逻辑。

推荐流程:

1. 先读:
   - `docs/deep-response-product-selftest-lab.md`
   - `docs/superpowers/plans/2026-05-31-deep-response-active-state.md`
2. 改动前跑一次 baseline:
   - `npm run deep:lab:selftest`
3. 实施产品改动。
4. 跑:
   - `npm run test:node`
   - `npm run deep:watchlab:build:volc`
   - `npm run deep:lab:selftest`
5. 全部 PASS 后再 commit/push。

selftest FAIL 时先看:

1. `summary.json`
2. `summary.json.overall`
3. `summary.json.judge.failures`
4. `summary.json.mouth.scenarios`
5. `summary.json.eye.screenshots`
6. `summary.json.ear.audits`
7. `summary.json.server.sessions`
8. `server-events.json`
9. `timing.json`
10. `audio-audit.json`

通常是产品 bug 的失败:

- `normal_turn` 失败。
- `multi_turn` 失败。
- `silent_recovery` 没有 idle/session_end。
- `goodbye_end` 没有 session_end 或 late audio 未被 409 拒绝。
- `interrupt_entry` abort 后仍有 stale audio，或 next turn 失败。
- audio audit 静音、RMS 过低、clipping、bytes 为 0。
- Watch screenshots 缺失或 simulator run 失败但环境可用。
- `server-events.json` 缺 `turn_done` / `audio_done` / `session_end` / generation 证据。
- timing 异常，比如首响过慢、first audio after first phrase 过慢。

可能是环境问题的失败:

- Fire/Volcengine endpoint 访问失败。
- `xcrun simctl` 找不到可用 watchOS simulator。
- Xcode/watchOS simulator build 失败且与 Swift 源码无关。
- Simulator install/launch 被 CoreSimulator/CoreDevice 卡住。
- 网络瞬断导致远端 HTTP probe timeout。
- 这类失败也要写清楚证据，不能直接当 PASS。

当前仍不能覆盖的真实硬件/听感问题:

- Apple Watch 真实扬声器是否实际出声。
- AirPods/蓝牙路由。
- 系统音量、静音模式、真实环境噪声。
- 人耳主观听感、音色自然度、口播舒适度。
- 真机 watchOS 上与 simulator 不一致的音频 session 行为。
- 真实手腕操作 ergonomics。
- 完整 OCR/像素级 UI semantic 检查。

## 11. 不属于本目标、仍是后续增强项

不属于本目标:

- 不把 DeepResponse 合入 Quick Response 正式老包。
- 不改 Watch 主链路为 WebSocket。
- 不做真机 Watch 自动化替代人类体验。
- 不做完美人耳级扬声器监听。
- 不覆盖所有未来产品功能。
- 不把 DeepResponse 产品本身做到最终“小智级”完整体验。
- 不做无尽性能优化或漂亮 UI。

后续可增强:

- 对 screenshots 做 OCR 或 Vision-based UI state extraction。
- 记录 raw console / xcodebuild / simctl logs 到报告目录。
- 加 ASR 回听返回音频，做语音内容级耳朵审计。
- 加更多 fixtures: 不同情绪、不同长度、不同结束意图、不同打断时机。
- 加真机 Watch 辅助体验 checklist，但仍不能替代自动化 gate。
- 更细化 provider error 分类和自动 triage。

## 12. 目标完成

目标完成。

逐条对照完成标准:

1. 有稳定总入口命令:
   - 已有 `npm run deep:lab:selftest`。
   - 可自动 build/install/launch Watch Simulator Lab。
   - 可输出报告目录。

2. 报告目录包含要求文件:
   - `summary.json`
   - `summary.md`
   - `screenshots/running.png`
   - `screenshots/done.png`
   - `server-events.json`
   - `timing.json`
   - `audio-audit.json`
   - `audio/*.pcm`

3. 自动化覆盖要求场景:
   - `normal_turn`: PASS
   - `multi_turn`: PASS
   - `silent_recovery`: PASS
   - `goodbye_end`: PASS
   - `interrupt_entry`: PASS

4. selftest 能自动判定 PASS/FAIL:
   - `summary.json.overall`
   - `summary.json.judge.ok`
   - `summary.json.judge.failures`

5. 捕获并修复真实产品层问题:
   - 捕获 Watch `turn_done` 早于 audio pull 时可能错过音频的问题。
   - 已修复 Watch polling。
   - 已加 regression gate。
   - `llm 0 · tts 0` timing 显示问题也保留为 Node/source 回归。

6. 验证通过:
   - `npm run deep:lab:selftest`: PASS
   - `npm run test:node`: `270/270` passed
   - `npm run deep:watchlab:build:volc`: BUILD SUCCEEDED

7. 文档完成:
   - `docs/deep-response-product-selftest-lab.md`
   - `docs/superpowers/plans/2026-06-05-deep-response-product-selftest-lab.md`
   - active-state 已更新“给后续 Codex”的使用说明和限制。

8. commit/push/干净:
   - commit: `e583f7f Add DeepResponse product self-test lab`
   - 已 push 到 `origin/codex/deep-response-lab`
   - 工作区干净。

因此可以结束本目标，不继续无尽优化。
