import test from "node:test";
import assert from "node:assert/strict";

import {
  parseHTTPAbortArgs,
  summarizeNextTurnAfterAbort
} from "./test-deep-response-http-abort.mjs";

test("parseHTTPAbortArgs accepts next-turn validation", () => {
  const args = parseHTTPAbortArgs([
    "--pcm", "fixtures/speech.pcm",
    "--pipeline-mode", "cascade",
    "--expect-next-turn"
  ]);

  assert.equal(args.pipelineMode, "cascade");
  assert.equal(args.expectNextTurn, true);
});

test("summarizeNextTurnAfterAbort records authoritative turn completion", () => {
  const summary = summarizeNextTurnAfterAbort({
    turnID: "turn-after-abort",
    generationID: "gen-after-abort",
    events: [
      { type: "transcript_final", generationID: "gen-after-abort", text: "今天很累。" },
      { type: "assistant_text_delta", generationID: "gen-after-abort", delta: "我听见你。" },
      { type: "audio_done", generationID: "gen-after-abort" },
      { type: "turn_done", generationID: "gen-after-abort" }
    ],
    audioChunks: [{ audioByteLength: 100 }]
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.audioDone, true);
  assert.equal(summary.turnDone, true);
});
