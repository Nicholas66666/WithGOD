# Deep Response Product Self-Test Lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable DeepResponse product self-test laboratory that simulates speech, observes WatchLab UI, audits returned audio, archives server evidence, and emits a PASS/FAIL report for later Codex work.

**Architecture:** Add a Node lab runner that orchestrates existing HTTP conversation/abort/idle probes plus the DeepResponseWatchLab simulator fake-mic path. Keep Watch transport HTTP-only and keep the lab scoped to `DeepResponseWatchLab` and `scripts/deep-response-server.mjs`; do not route anything through the old Quick Response app path.

**Tech Stack:** Node.js test runner, existing DeepResponse HTTP probe scripts, watchOS simulator via `xcrun simctl`, `xcodebuild` DeepResponseWatchLab build, PCM16 fixture/audio auditing, Markdown/JSON report generation.

---

## Files

- Create `scripts/deep-response-lab.mjs`
  - Parse `deep:lab:selftest` CLI options.
  - Run mouth/server probes for normal turn, multi-turn, idle/silence recovery, goodbye session end, and abort/barge-in entrance.
  - Run Watch simulator fake mic and archive screenshots.
  - Audit PCM16 audio returned by server probes.
  - Write `summary.json`, `summary.md`, server event archives, timing details, audio artifacts, and screenshot references.
  - Return process exit 0 only when the judge marks overall PASS.
- Modify `scripts/test-deep-response-http-conversation.mjs`
  - Preserve raw per-turn event and audio metadata in summaries so the lab can archive turn/session/generation evidence and audit audio.
- Modify `scripts/run-deep-response-watch-sim-fakemic.mjs`
  - Boot a watchOS simulator automatically when none is already booted.
  - Return screenshot metadata and status usable by the lab.
- Add `scripts/deep-response-lab.test.mjs`
  - Cover CLI parsing, audio audit thresholds, summary shape, and judge failure handling.
- Modify `package.json`
  - Add `deep:lab:selftest`.
- Modify `docs/superpowers/plans/2026-05-31-deep-response-active-state.md`
  - Record the new lab command, coverage, limitations, and later Codex usage instructions.
- Create `docs/deep-response-product-selftest-lab.md`
  - Human-readable runbook for running and interpreting the lab.

## Tasks

### Task 1: RED Tests For Lab Contracts

**Files:**
- Create: `scripts/deep-response-lab.test.mjs`
- Create: `scripts/deep-response-lab.mjs`

- [ ] Add tests that assert `parseDeepResponseLabArgs()` accepts endpoint, out dir, turns, skip-build, skip-sim, and fail-fast options.
- [ ] Add tests that assert `auditPCM16Audio()` fails silent PCM, passes non-silent PCM, reports RMS, peak, clipping, duration, expected drain time, and byte counts.
- [ ] Add tests that assert `buildLabSummary()` always contains `overall`, `mouth`, `eye`, `ear`, `server`, and `judge`.
- [ ] Add tests that assert missing required scenarios cause `overall: "FAIL"`.
- [ ] Run `node --test scripts/deep-response-lab.test.mjs` and verify RED failures caused by missing exports.

### Task 2: GREEN Lab Core

**Files:**
- Modify: `scripts/deep-response-lab.mjs`

- [ ] Implement CLI parsing with defaults:
  - endpoint `http://124.174.96.149:8797`
  - out dir under `/private/tmp/deep-response-lab-selftest-<timestamp>`
  - fixture `Resources/DeepResponseWatchLab/simulated-mic-speech.pcm`
  - server turns `4`
  - Watch simulator turns `2`
- [ ] Implement PCM16 audio audit for mono int16 buffers.
- [ ] Implement summary/judge helpers that produce stable five-category output and deterministic failure reasons.
- [ ] Run `node --test scripts/deep-response-lab.test.mjs` and verify GREEN.

### Task 3: Preserve Probe Evidence

**Files:**
- Modify: `scripts/test-deep-response-http-conversation.mjs`
- Modify: `scripts/deep-response-lab.test.mjs`

- [ ] Add a failing test that `summarizeTurn()` can optionally include raw event and audio chunk metadata.
- [ ] Extend `summarizeTurn()` with `includeEvidence` support, preserving event type, seq, timing, turnID, generationID, and audio chunk byte/sample-rate/base64 metadata.
- [ ] Ensure existing callers keep their compact shape by default.
- [ ] Run focused tests for conversation and lab.

### Task 4: Server/Mouth/Ear Runner

**Files:**
- Modify: `scripts/deep-response-lab.mjs`

- [ ] Call `runHTTPConversationProbe()` for a four-turn conversation with `endReason: "user_goodbye"`, session end, late audio 409, memory candidate, memory recall when available, partial-start, audio-before-turn-done, and timing gates.
- [ ] Call `runHTTPIdleProbe()` to represent silent/no-input recovery.
- [ ] Call `runHTTPAbortProbe()` to represent interrupt/barge-in entry.
- [ ] Archive `server-events.json`, `turns.json`, `timing.json`, and `audio-audit.json`.
- [ ] Write concatenated returned audio PCM artifacts for audited turns.
- [ ] Map evidence into `mouth`, `ear`, `server`, and `judge` result blocks.

### Task 5: Watch Simulator Eye Runner

**Files:**
- Modify: `scripts/run-deep-response-watch-sim-fakemic.mjs`
- Modify: `scripts/deep-response-lab.mjs`

- [ ] Add automatic watchOS simulator boot fallback when no booted watch is found.
- [ ] Run fake-mic WatchLab from the lab unless `--skip-sim` is set.
- [ ] Archive `running.png` and `done.png` into report screenshots.
- [ ] Judge screenshots as PASS when files exist and the runner reports `ok: true`; record that OCR-free UI state detection is limited to screenshot evidence and source-level state gates.

### Task 6: Report And Entrypoint

**Files:**
- Modify: `package.json`
- Modify: `scripts/deep-response-lab.mjs`

- [ ] Add `npm run deep:lab:selftest`.
- [ ] Write `summary.json` and `summary.md`.
- [ ] Include clear scenario rows: normal turn, multi-turn, silent recovery, goodbye end, interrupt entry.
- [ ] Include exact artifacts paths and limitations for audio/speaker coverage.
- [ ] Exit 1 on FAIL.

### Task 7: Docs, Verification, Commit, Push

**Files:**
- Create: `docs/deep-response-product-selftest-lab.md`
- Modify: `docs/superpowers/plans/2026-05-31-deep-response-active-state.md`

- [ ] Document how later Codex should run `npm run deep:lab:selftest`.
- [ ] Document report interpretation, coverage, artifacts, limitations, and hardware listening caveats.
- [ ] Run `npm run test:node`.
- [ ] Run `npm run deep:watchlab:build:volc`.
- [ ] Run `npm run deep:lab:selftest`.
- [ ] Fix failures or record blocked external simulator/server conditions with evidence.
- [ ] Commit and push to `codex/deep-response-lab`.
- [ ] Confirm `git status --short --branch` is clean.
