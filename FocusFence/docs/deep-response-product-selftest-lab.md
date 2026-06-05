# DeepResponse Product Self-Test Lab

The product self-test lab is the default gate before future DeepResponse product work. It is scoped to `DeepResponseWatchLab` and the DeepResponse HTTP server only; it does not exercise the old Quick Response package or switch the Watch transport away from HTTP.

## Run

```bash
npm run deep:lab:selftest
```

Useful debug variants:

```bash
npm run deep:lab:selftest -- --out-dir /private/tmp/deep-response-lab-manual
npm run deep:lab:selftest -- --skip-build
npm run deep:lab:selftest -- --skip-sim
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
- `eye`: Watch Simulator evidence and screenshot paths.
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

## Limits

The ear audit verifies PCM bytes that the Watch/server path received and prepared to play. It cannot prove the real Apple Watch speaker, AirPods route, volume, acoustic output, or human-perceived voice quality.

The eye audit archives Watch Simulator screenshots and relies on existing source/state-machine tests for precise state assertions. It is not a full OCR or pixel-semantic UI inspector, and it does not replace a small optional real-device listening check after automated gates pass.

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

Run date: 2026-06-05.

Report:

```text
/private/tmp/deep-response-lab-selftest-2026-06-05T05-37-31-389Z
```

Result:

- `summary.json.overall`: `PASS`
- `mouth`, `eye`, `ear`, `server`, `judge`: all `PASS`
- Scenarios covered: `normal_turn`, `multi_turn`, `goodbye_end`, `silent_recovery`, `interrupt_entry`
- Audio audits: 4/4 PASS; no silent audio or clipping; received/completed bytes matched
- Timing: HTTP stop-to-first-audio was 197-206ms across the four conversation turns
- Screenshots checked: `screenshots/running.png` and `screenshots/done.png`

Findings from this pass:

- Product bugs: none found under the current automated product-lab coverage.
- Blocking lab defects: fixed `server-events.json` evidence coverage so goodbye lifecycle, idle recovery, abort entry, and abort next-turn events are archived instead of only the conversation turn events.
- Environment issues: none in this run.
- Accepted follow-ups: OCR/pixel-semantic UI checks, true speaker/human hearing checks, and broader fixture coverage remain outside this product self-test pass.
