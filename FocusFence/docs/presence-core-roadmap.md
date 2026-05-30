# Presence 三条核心主线

更新日期：2026-05-28

当前产品接下来按三条主线推进。每条主线独立记录、独立验收，一个一个实现。

## 核心交互原则

文档：

- `docs/presence-interaction-principles.md`
- `docs/presence-interaction-open-questions.md`
- `docs/presence-energy-optimization.md`
- `docs/presence-system-overview.md`

原则：

- 产品入口必须极简。
- Action Button 和屏幕按钮必须围绕同一套录音状态机工作。
- 已经调通的前台、后台、未启动状态下 Action Button 自动开始录音体验不能被破坏。
- 新增能力优先复用现有开始/停止流程，不拆出复杂分支。

## 1. Recording Stability

文档：

- `docs/recording-stability-p0.md`

目标：

Apple Watch 录音不能在用户不知情的情况下停止、失效或丢失内容。除了用户手动结束和明确超长静音保护以外，任何中断都必须可检测、可恢复或清楚提示。

当前状态：

- 已记录为 P0。
- 已梳理高风险来源：音频中断、后台限制、假静音、轻声祷告误判、recorder 异常结束。
- 后续先加诊断，再改恢复策略。

## 2. Quick Response Design

文档：

- `docs/superpowers/specs/2026-05-28-quick-response-design.md`

目标：

把 Watch 结束录音后的第一屏回应做成一个短而有分量的经文锚点。它不是摘要，而是属灵辨明的一屏回应。

当前状态：

- 已定义适合经文回应的类型。
- 已定义不应硬套经文的类型。
- 已定义 `eyebrow/headline/body/footnote` 的内容责任。
- 后续实现应先改服务端 quick prompt 和样例测试。

## 3. Deep Response Design

文档：

- `docs/superpowers/specs/2026-05-28-deep-response-design.md`

目标：

在强情绪、创伤闪回、极深痛苦祷告等场景下，不把 Watch 塞成长文，而是邀请用户进入一段以圣经为中心的语音陪伴对话。

当前状态：

- 已暂定名称：Deep Response。
- 已定义产品形态：Anchor -> Invitation -> Scripture Companion。
- 已定义身份边界：不冒充神，不冒充圣灵，而是帮助用户和圣经对话。
- 已明确需要真正 realtime 才能做好。

## 推进顺序建议

1. 先做 Quick Response。
   - 成本低。
   - 直接提升当前已跑通链路。
   - 不依赖 realtime。

2. 并行记录 Recording Stability 的复现场景。
   - 用户日常使用时继续捕捉触发条件。
   - 下一阶段加入诊断。

3. 再做 Deep Response。
   - 它依赖 realtime 语音对话。
   - 需要先把技术链路跑通，再做体验。

## Realtime 当前结论

Realtime 对 Quick Response 不是第一优先级，但对 Deep Response 是必要前提。

当前项目里已经有服务端 WebSocket 和 Watch realtime 相关代码，但还没有形成稳定、端到端、可产品化的 Watch 语音对话链路。
