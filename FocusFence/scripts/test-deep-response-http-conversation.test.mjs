import test from "node:test";
import assert from "node:assert/strict";

import {
  parseHTTPConversationArgs,
  summarizeTurn
} from "./test-deep-response-http-conversation.mjs";

test("parseHTTPConversationArgs accepts cascade pipeline mode", () => {
  const args = parseHTTPConversationArgs([
    "--pcm", "fixtures/speech.pcm",
    "--pipeline-mode", "cascade"
  ]);

  assert.equal(args.pipelineMode, "cascade");
});

test("summarizeTurn concatenates streaming text deltas without inserting spaces", () => {
  const summary = summarizeTurn({
    turnID: "turn-1",
    generationID: "gen-1",
    turnStartedAt: 0,
    uploadStartedAt: 0,
    uploadEndedAt: 100,
    endedAt: 500,
    firstAudioAt: 250,
    uploadChunks: 1,
    encodedUploadBytes: 10,
    decodedUploadBytes: 10,
    events: [
      { type: "transcript_final", text: "今天我累。" },
      { type: "assistant_text_delta", delta: "我听见" },
      { type: "assistant_text_delta", delta: "你真的很累。" },
      { type: "timing", timing: { voice_pipeline_total_ms: 400 } }
    ],
    audioChunks: [{ audioByteLength: 100 }]
  });

  assert.equal(summary.text, "我听见你真的很累。");
  assert.equal(summary.stopToFirstAudioMs, 150);
});
