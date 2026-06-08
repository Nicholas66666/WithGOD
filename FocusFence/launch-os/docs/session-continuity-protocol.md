# 会话连续性协议

## 目标

让 Launch OS 工作跨 Codex 会话持续可追溯，不依赖聊天记忆。

## 机制

使用两层机制：

1. 仓库里的 `launch-os/` 记录。
2. 本地 Codex Skill：`/Users/nicho/.codex/skills/focusfence-launch-os`。

Skill 会要求未来会话先读 Launch OS 记录，再执行动作；有意义的工作完成后必须更新 daily、decisions、data 和看板。

## 如何稳定触发

这个 Skill 的 description 已经覆盖 `FocusFence`、`Scripture companion overseas launch`、`Launch OS dashboard`、`SEMrush`、`Google Ads research`、`daily launch records`、`decision logs`、`Volcengine public dashboard deployment` 等关键词。因此后续你不需要逐字说“使用 skill”，只要消息里出现这些项目语境，Codex 就应该自动使用它。

最稳定的触发方式是在新线程第一句话带上项目名或对象，例如：

```text
继续 FocusFence Launch OS
继续圣经手表海外上线
继续 SEMrush 关键词研究
更新 Launch OS 看板
```

如果你只说“继续”或“开干”，没有任何项目上下文，系统可能无法可靠判断应该使用哪个 Skill。为降低这个风险，本仓库也把 `launch-os/` 作为真正信息源；即使 Skill 没触发，只要进入这个仓库继续工作，也应先读 `launch-os/README.md` 和最新 daily。

## 必须读取

未来会话应读取：

- `launch-os/README.md`
- `launch-os/data/processed/dashboard-state.json`
- latest `launch-os/daily/*.md`
- relevant files under `launch-os/decisions/`
- `git status --short`

## 必须记录

- 每一个实质进展。
- 每一个商业决策。
- 每一次云服务或网络变更。
- 每一次付费研究数据拉取。
- 每一个错误或被修正的假设。
- 每一个产生或可能产生费用的动作。

## 语言规则

所有 Launch OS 记录、复盘、决策、看板文字默认使用中文。只有关键词、广告文案、命令、API 字段、URL 和引用原文保留英文。

## 验证

更新记录后运行：

```bash
npm run launch:dashboard:build
npm run launch:verify
```

如果公网看板需要同步最新内容，把 `launch-os/` 同步到 ECS，并重启 `launch-os.service`。
