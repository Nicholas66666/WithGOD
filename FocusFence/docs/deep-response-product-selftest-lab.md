# DeepResponse Product Self-Test Lab

The product self-test lab is the default gate before future DeepResponse product work. It is scoped to `DeepResponseWatchLab` and the DeepResponse HTTP server only; it does not exercise the old Quick Response package or switch the Watch transport away from HTTP.

## Run

```bash
npm run deep:lab:selftest
```

For a real continuous Watch Simulator experience gate, run:

```bash
npm run deep:watchlab:experience:10
```

This launches `DeepResponseWatchLab` in the watchOS Simulator with fake mic autorun enabled, sends 10 continuous user turns through the Watch HTTP client path to Fire/Volcengine, then writes a product experience report with screenshots, server events, audio audits, timing, and per-turn assistant openings.

Useful debug variants:

```bash
npm run deep:lab:selftest -- --out-dir /private/tmp/deep-response-lab-manual
npm run deep:lab:selftest -- --skip-build
npm run deep:lab:selftest -- --skip-sim
npm run deep:watchlab:experience:10 -- --out-dir /private/tmp/deep-response-watch-sim-experience-manual
```

`--skip-sim` is only for debugging server/audio/report behavior. It intentionally fails the final judge because the completion gate requires Watch Simulator screenshots.

## Report

Each run writes a report directory, for example:

```text
/private/tmp/deep-response-lab-selftest-...
├── summary.json
├── summary.md
├── server-events.json
├── timing.json
├── turns.json
├── audio-audit.json
├── audio/*.pcm
└── screenshots/running.png, screenshots/done.png
```

`summary.json` is the machine contract. It always includes:

- `overall`: `PASS` or `FAIL`.
- `mouth`: speech fixture scenarios for normal turn, multi-turn, silent recovery, goodbye end, and interrupt entry.
- `eye`: Watch Simulator evidence, screenshot paths, and targeted screenshot audits for visible orange error/status badges.
- `ear`: PCM audio audits for returned assistant audio.
- `server`: session/turn/generation evidence from DeepResponse server events.
- `judge`: required scenarios and failure reasons.

`summary.md` is the short human-readable version.

`server-events.json` preserves the source of each archived event in `source`:

- `conversation_turn`: normal and multi-turn transcript, assistant, audio, timing, and `turn_done` events.
- `conversation_lifecycle`: explicit user-goodbye `session_end` plus memory lifecycle events.
- `idle`: silent/no-input recovery, idle goodbye audio, idle `session_end`, and memory events.
- `abort`: interrupt/barge-in abort entry events.
- `abort_next_turn`: the recovery turn after abort, including transcript, assistant audio, timing, and `turn_done`.

## Coverage

The lab covers:

- Normal speech turn through the DeepResponse HTTP cascade path.
- Multi-turn continuous conversation in one server session.
- Silent/no-input recovery via idle timeout and idle goodbye.
- User goodbye session end plus late-audio rejection.
- Interrupt/barge-in entry via the abort probe and next-turn recovery.
- Watch Simulator fake microphone path through `DeepResponseWatchLab`, with screenshots.
- Audio non-silence, duration, RMS, peak, clipping, received/queued/scheduled/completed byte proxies, and expected duration versus drain timing.
- Server upload/download bytes, ASR/LLM/TTS timing, `turn_done`, `session_end`, abort, provider errors, and generation identity evidence where emitted.

The 10-turn Watch Simulator experience gate additionally verifies:

- 10 consecutive fake-mic turns through `DeepResponseWatchLab` and the real HTTP session client.
- Each turn has transcript, assistant text, assistant audio bytes, `audio_done`, `turn_done`, and timing evidence.
- The final Watch screenshot reaches `Sim mic done` instead of staying in `Waiting playback`.
- Assistant opening stems and exact opening sentences do not repeat in a way that masks real conversational quality problems.
- Blocking provider/client errors such as `-999`, `-1001`, `Volc_Server_Error`, provider errors, empty ASR/god output, silent audio, and timeout-like error events are treated as failures.

## Limits

The ear audit verifies PCM bytes that the Watch/server path received and prepared to play. It cannot prove the real Apple Watch speaker, AirPods route, volume, acoustic output, or human-perceived voice quality.

The eye audit archives Watch Simulator screenshots and relies on existing source/state-machine tests for precise state assertions. It is not a full OCR or pixel-semantic UI inspector, and it does not replace a small optional real-device listening check after automated gates pass.

The screenshot audit intentionally checks only for targeted visible orange error/status pixels in the Watch status area. It is meant to catch product-blocking stale error banners such as `Upload 502`; it is not a general-purpose visual understanding system.

## For Later Codex

Before changing DeepResponse continuous conversation, barge-in, memory, session end, timing display, or WatchLab UI state:

1. Run `npm run deep:lab:selftest`.
2. Inspect `summary.json` first. Treat any `overall: "FAIL"` as a blocking regression.
3. Use `judge.failures` to find the failing category.
4. Use `server-events.json`, `timing.json`, and `audio-audit.json` for the detailed root-cause trail.
5. Use `screenshots/running.png` and `screenshots/done.png` to confirm the WatchLab visible path.
6. After the lab passes, still run `npm run test:node` and `npm run deep:watchlab:build:volc` before committing.

Do not use user-operated Watch testing as the phase gate. Real hardware listening remains an extra experience confirmation after automated self-test evidence is already green.

## Latest Product Self-Test Pass

Run date: 2026-06-06.

Report:

```text
/private/tmp/deep-response-lab-selftest-2026-06-06T00-59-04-691Z
```

Result:

- `summary.json.overall`: `PASS`
- `mouth`, `eye`, `ear`, `server`, `judge`: all `PASS`
- Scenarios covered: `normal_turn`, `multi_turn`, `goodbye_end`, `silent_recovery`, `interrupt_entry`
- Audio audits: 4/4 PASS; no silent audio or clipping
- Audio audit bytes: 224,256-273,006 bytes per conversation turn
- Screenshots checked: `screenshots/running.png` and `screenshots/done.png`
- Screenshot audits: 2/2 PASS; both screenshots had `orangeStatusPixels: 0`
- Server events: 111 total; 6 `input_stop`, 6 `audio_done`, 6 `turn_done`, 2 `session_end`, 1 `abort`, 0 error events
- Timing: max `http_stop_to_first_audio_ms` `472`; max first phrase to first audio `281`; 4/4 turns started LLM from partial transcript

Findings from this pass:

- Baseline standard self-test reported `PASS`, but screenshot inspection showed a visible orange `Upload 502` badge in both `running.png` and `done.png`.
- Product bug: a transient HTTP upload failure followed by a successful retry left `lastError`/`lastErrorCode` visible on the Watch UI, which could mislead product testing even though the turn recovered.
- Blocking lab defect: the `eye` category only required screenshot capture, so a visible Watch error badge could still pass the final judge.
- Environment issues: none in this run.
- Accepted follow-ups: full OCR/pixel-semantic UI checks, true speaker/human hearing checks, broader fixture coverage, and real acoustic echo cancellation quality remain outside this product self-test pass.

Fix in this pass:

- `DeepResponseRealtimeClient.uploadHTTPSessionAudio` now clears `lastError` and `lastErrorCode` after a successful upload retry.
- The product self-test lab now audits Watch Simulator screenshots for targeted orange error/status pixels in the status area and fails `eye`/`judge` if found.
- Focused regression tests cover clearing transient upload errors and failing the judge when screenshot audit detects a visible UI error.

Evidence:

- Focused tests: `node --test scripts/deep-response-watch-ui.test.mjs scripts/deep-response-lab.test.mjs`, 62/62 PASS.
- Old bad screenshot audit proof: `/private/tmp/deep-response-lab-selftest-2026-06-06T00-54-46-464Z/screenshots/done.png` failed with 1,149 orange status pixels.
- `npm run test:node`: 285/285 PASS.
- `npm run deep:watchlab:build:volc`: PASS.
- `npm run deep:lab:selftest`: PASS.
- Visible Simulator was activated before the standard self-test run; screenshots show `Waiting playback` during the run and `Sim mic done` at completion, with no stale orange error badge.
- Server evidence included normal/multi-turn `turn_done`, user-goodbye `session_end`, idle-timeout `session_end`, and abort entry/recovery events.
- Source/state tests still guard the playback barge-in monitor behavior: the monitor does not pass speaker-monitor chunks into the upload path. Simulator validation cannot prove real acoustic echo cancellation quality.

## Latest 10-Turn Watch Simulator Experience Pass

Run date: 2026-06-05.

Report:

```text
/private/tmp/deep-response-watch-sim-experience-final
```

Result:

- `summary.json.overall`: `PASS`
- Watch turns requested: 10
- Server turns observed: 10
- Audio audits: 10/10 PASS
- Server session: `drs_67e65a8eb1234423b6d4829f276cfc18`
- Server events: 164 total; 10 `input_stop`, 10 `transcript_final`, 10 `audio_done`, 10 `timing`, 10 `turn_done`
- Blocking errors: none found for `-999`, `-1001`, `Volc_Server_Error`, provider errors, empty ASR/god output, silent audio, or timeout-like error events
- Screenshots checked: `running.png` showed legal `Waiting playback`; `done.png` showed `Sim mic done`

Product bug found and fixed:

- Baseline 10-turn Watch fake-mic evidence showed repeated comfort openings in adjacent turns: `先把...` repeated across turns 1-2, and `我陪...` repeated across turns 7-8.
- The product normalization guard now treats common comfort opening stems such as `我陪`, `先把`, `不用`, `今天`, and `那今` as one-use recent stems and has a larger replacement pool.
- Focused regression: `VoicePipeline streamCascadeTurn avoids repeating the previous opening stem`.
- The final 10-turn experience rerun passed with 10 distinct openings and no repeated exact opening sentence.

Residual risk:

- The 10-turn experience uses the existing fake mic fixture, so it validates continuous Watch/client/server behavior rather than broad speech intent diversity.
- Goodbye/session-end and interrupt/barge-in are covered by the standard self-test server evidence and Watch/source gates, not by a separate 10-turn Watch goodbye fixture in this pass.
