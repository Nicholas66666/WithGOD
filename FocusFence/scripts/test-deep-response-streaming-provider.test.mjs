import test from "node:test";
import assert from "node:assert/strict";

import {
  parseStreamingProviderArgs,
  summarizeStreamingProviderResult
} from "./test-deep-response-streaming-provider.mjs";

test("parseStreamingProviderArgs requires a PCM fixture", () => {
  assert.throws(() => parseStreamingProviderArgs([]), /--pcm/);
  assert.deepEqual(parseStreamingProviderArgs(["--pcm", "fixtures/speech.pcm"]), {
    pcmPath: "fixtures/speech.pcm",
    contextPath: "",
    outputAudioPath: "",
    replayIntervalMs: 50
  });
});

test("parseStreamingProviderArgs accepts context output and replay interval", () => {
  assert.deepEqual(parseStreamingProviderArgs([
    "--pcm",
    "fixtures/speech.pcm",
    "--context",
    "fixtures/context.json",
    "--out-audio",
    "/tmp/out.pcm",
    "--replay-interval-ms",
    "10"
  ]), {
    pcmPath: "fixtures/speech.pcm",
    contextPath: "fixtures/context.json",
    outputAudioPath: "/tmp/out.pcm",
    replayIntervalMs: 10
  });
});

test("summarizeStreamingProviderResult reports first playable audio timing", () => {
  const summary = summarizeStreamingProviderResult({
    transcript: "我很累",
    first: {
      text: "我听见你很累。",
      audioByteLength: 100
    },
    followup: {
      text: "我们慢慢来。",
      audioByteLength: 200
    },
    timing: {
      transcript_final_ms: 2000,
      llm_first_phrase_ms: 3500,
      first_tts_first_audio_ms: 500,
      voice_pipeline_total_ms: 7000
    },
    providerMeta: { ttsMode: "websocket" }
  });

  assert.deepEqual(summary, {
    ok: true,
    transcript: "我很累",
    firstText: "我听见你很累。",
    followupText: "我们慢慢来。",
    audioByteLength: 300,
    timing: {
      asr_final_ms: 2000,
      llm_first_phrase_ms: 3500,
      tts_first_audio_ms: 500,
      first_playable_audio_ms: 6000,
      total_ms: 7000
    },
    providerMeta: { ttsMode: "websocket" }
  });
});
