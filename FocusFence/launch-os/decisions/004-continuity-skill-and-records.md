# 决策 004：用 Skill 和仓库记录保持连续性

## 决策

同时使用仓库记录和本地 Codex Skill，保证 Launch OS 在跨会话时不依赖聊天记忆。

## 考虑选项

- 只依赖聊天记忆。
- 只依赖仓库记录。
- 使用仓库记录 + 项目专用 Skill。

## 证据

- 聊天历史可能被压缩或丢失。
- 仓库文件可版本管理、可审计。
- Skill 可以提示未来会话先读取 Launch OS 记录再行动。

## 最终选择

在 `/Users/nicho/.codex/skills/focusfence-launch-os` 创建 `focusfence-launch-os`，并把长期可信信息源放在 `launch-os/` 下。

## 推翻条件

如果未来会话中 Skill 触发不稳定，或出现更可靠的项目级指令机制，再重新评估。
