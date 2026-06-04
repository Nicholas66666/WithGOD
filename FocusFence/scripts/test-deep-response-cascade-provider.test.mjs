import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCascadeProviderArgs,
  summarizeCascadeEvents
} from "./test-deep-response-cascade-provider.mjs";

test("parseCascadeProviderArgs requires a PCM fixture", () => {
  assert.throws(() => parseCascadeProviderArgs([]), /--pcm/);
  assert.deepEqual(parseCascadeProviderArgs(["--pcm", "fixtures/speech.pcm"]), {
    pcmPath: "fixtures/speech.pcm",
    contextPath: "",
    outputAudioPath: "",
    replayIntervalMs: 50,
    phraseMaxChars: 28,
    turns: 1
  });
});

test("parseCascadeProviderArgs accepts cascade probe options", () => {
  assert.deepEqual(parseCascadeProviderArgs([
    "--pcm", "fixtures/speech.pcm",
    "--context", "fixtures/context.json",
    "--out-audio", "/tmp/cascade.pcm",
    "--replay-interval-ms", "10",
    "--phrase-max-chars", "18",
    "--turns", "3"
  ]), {
    pcmPath: "fixtures/speech.pcm",
    contextPath: "fixtures/context.json",
    outputAudioPath: "/tmp/cascade.pcm",
    replayIntervalMs: 10,
    phraseMaxChars: 18,
    turns: 3
  });
});

test("summarizeCascadeEvents reports progressive phrase and audio timing", () => {
  const summary = summarizeCascadeEvents({
    elapsedMs: 1200,
    events: [
      { type: "transcript_partial", transcript: "今天我很累" },
      { type: "transcript_final", transcript: "今天我很累。" },
      { type: "assistant_text_delta", delta: "我听见你。" },
      { type: "assistant_phrase", text: "我听见你。", phraseIndex: 0, receivedAtMs: 1030 },
      { type: "audio_chunk", phraseIndex: 0, audioChunk: Buffer.alloc(100), receivedAtMs: 1120 },
      { type: "timing", timing: { transcript_final_ms: 900, llm_first_token_ms: 120, voice_pipeline_total_ms: 1100 } },
      { type: "turn_done", assistantText: "我听见你。" }
    ]
  });

  assert.deepEqual(summary, {
    ok: true,
    transcript: "今天我很累。",
    assistantText: "我听见你。",
    firstPhrase: "我听见你。",
    phraseCount: 1,
    audioChunkCount: 1,
    audioByteLength: 100,
    timing: {
      transcript_final_ms: 900,
      llm_first_token_ms: 120,
      first_phrase_elapsed_ms: 1030,
      first_phrase_after_transcript_final_ms: 130,
      first_audio_elapsed_ms: 1120,
      first_audio_after_transcript_final_ms: 220,
      first_audio_after_first_phrase_ms: 90,
      first_phrase_event_index: 3,
      first_audio_event_index: 4,
      first_audio_before_turn_done: true,
      voice_pipeline_total_ms: 1100,
      elapsed_ms: 1200
    }
  });
});
