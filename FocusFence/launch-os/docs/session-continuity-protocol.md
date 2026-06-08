# Session Continuity Protocol

## Goal

Keep Launch OS work durable across Codex sessions without relying on chat memory.

## Mechanism

There are two layers:

1. Repository records under `launch-os/`.
2. A local Codex Skill named `focusfence-launch-os` under `/Users/nicho/.codex/skills/focusfence-launch-os`.

The Skill tells future Codex sessions to read Launch OS records first, then update daily notes, decisions, data, and the dashboard after meaningful work.

## How To Trigger

In a future thread, say one of:

```text
继续 FocusFence Launch OS
继续圣经手表海外上线
继续 SEMrush 关键词研究
更新 Launch OS 看板
```

## Required Startup Reads

Future sessions should read:

- `launch-os/README.md`
- `launch-os/data/processed/dashboard-state.json`
- latest `launch-os/daily/*.md`
- relevant files under `launch-os/decisions/`
- `git status --short`

## What Must Be Recorded

- Every material progress item.
- Every commercial decision.
- Every cloud/network change.
- Every paid research data pull.
- Every mistake or corrected assumption.
- Every cost-bearing or potentially cost-bearing action.

## Verification

After updating records:

```bash
npm run launch:dashboard:build
npm run launch:verify
```

If public dashboard freshness matters, sync `launch-os/` to the ECS and restart `launch-os.service`.
