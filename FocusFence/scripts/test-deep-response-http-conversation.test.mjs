import test from "node:test";
import assert from "node:assert/strict";

import {
  parseHTTPConversationArgs,
  summarizeTurn
} from "./test-deep-response-http-conversation.mjs";

test("parseHTTPConversationArgs accepts cascade pipeline mode", () => {
  const args = parseHTTPConversationArgs([
    "--pcm", "fixtures/speech.pcm",
    "--pipeline-mode", "cascade",
    "--wait-ms", "750"
  ]);

  assert.equal(args.pipelineMode, "cascade");
  assert.equal(args.waitMs, 750);
});

test("parseHTTPConversationArgs accepts session-end validation options", () => {
  const args = parseHTTPConversationArgs([
    "--pcm", "fixtures/speech.pcm",
    "--turns", "8",
    "--end-reason", "user_goodbye",
    "--expect-session-end",
    "--expect-late-audio-409"
  ]);

  assert.equal(args.turns, 8);
  assert.equal(args.endReason, "user_goodbye");
  assert.equal(args.expectSessionEnd, true);
  assert.equal(args.expectLateAudio409, true);
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

test("summarizeTurn reports HTTP phrase and audio receive timing", () => {
  const summary = summarizeTurn({
    turnID: "turn-1",
    generationID: "gen-1",
    turnStartedAt: 0,
    uploadStartedAt: 0,
    uploadEndedAt: 100,
    endedAt: 600,
    firstAudioAt: 260,
    uploadChunks: 1,
    encodedUploadBytes: 10,
    decodedUploadBytes: 10,
    events: [
      { type: "transcript_final", text: "今天我累。" },
      { type: "assistant_phrase", text: "我听见你。", receivedAtMs: 220 },
      { type: "assistant_text_delta", delta: "我听见你。" },
      { type: "timing", timing: { transcript_final_ms: 900 } }
    ],
    audioChunks: [{ audioByteLength: 100, receivedAtMs: 260 }]
  });

  assert.equal(summary.timing.http_stop_to_first_phrase_ms, 120);
  assert.equal(summary.timing.http_stop_to_first_audio_ms, 160);
  assert.equal(summary.timing.http_first_audio_after_first_phrase_ms, 40);
});
