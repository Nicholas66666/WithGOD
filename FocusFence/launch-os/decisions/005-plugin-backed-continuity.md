# 决策 005：用插件增强 Launch OS 稳定触发

## 决策

创建并安装个人 Codex 插件 `focusfence-launch-os@personal`，作为 FocusFence Launch OS 的显式入口。插件内置 Launch OS Skill、中文记录规则、项目路径、看板地址、SEMrush/Google Ads/火山部署上下文和默认启动提示。

## 考虑选项

- 只依赖聊天记忆。
- 只依赖本地 Skill。
- 使用插件 + 仓库记录 + 本地 Skill 三层机制。

## 证据

- 聊天历史可能压缩或丢失。
- 单个 Skill 依赖上下文匹配，不能保证完全无上下文的“继续”一定触发。
- 插件可以在 Codex UI 中被显式选择，稳定性高于被动匹配。
- 仓库记录仍然是长期 source of truth，可审计、可提交、可公网展示。

## 最终选择

采用三层连续性机制：

- 显式入口：`focusfence-launch-os@personal` 插件。
- 事实来源：`/Users/nicho/Documents/New project/FocusFence/launch-os/`。
- 备用触发：`/Users/nicho/.codex/skills/focusfence-launch-os`。

以后新线程最稳做法是在 composer 中选择 `FocusFence Launch OS` 插件；如果不选插件，也至少在第一句话包含 `FocusFence Launch OS` 或 `圣经手表海外上线`。

## 推翻条件

如果 Codex 后续支持项目级永久指令、自动工作区绑定或更强的线程记忆机制，可重新评估是否还需要个人插件作为入口。
