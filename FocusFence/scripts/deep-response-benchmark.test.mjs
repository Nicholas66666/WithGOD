import test from "node:test";
import assert from "node:assert/strict";

import { chunkPCM16, parseBenchmarkArgs, summarizeBenchmarkResult } from "./deep-response-benchmark.mjs";

test("parseBenchmarkArgs requires an explicit PCM fixture", () => {
  assert.throws(() => parseBenchmarkArgs([]), /--pcm/);
  assert.deepEqual(parseBenchmarkArgs(["--pcm", "fixtures/sample.pcm"]), {
    pcmPath: "fixtures/sample.pcm",
    contextPath: "",
    outputAudioPath: "",
    replayIntervalMs: 100
  });
});

test("parseBenchmarkArgs accepts replay interval", () => {
  assert.deepEqual(parseBenchmarkArgs(["--pcm", "fixtures/sample.pcm", "--replay-interval-ms", "20"]), {
    pcmPath: "fixtures/sample.pcm",
    contextPath: "",
    outputAudioPath: "",
    replayIntervalMs: 20
  });
});

test("summarizeBenchmarkResult keeps provider timing and omits audio bytes", () => {
  const result = summarizeBenchmarkResult({
    transcript: "我很累",
    responseText: "我听见你真的很累。",
    firstPhrase: "我听见你真的很累。",
    audioByteLength: 128,
    timing: { voice_pipeline_total_ms: 1234 },
    providerMeta: { ttsMode: "websocket" }
  });

  assert.deepEqual(result, {
    transcript: "我很累",
    responseText: "我听见你真的很累。",
    firstPhrase: "我听见你真的很累。",
    audioByteLength: 128,
    timing: { voice_pipeline_total_ms: 1234 },
    providerMeta: { ttsMode: "websocket" }
  });
});

test("chunkPCM16 splits fixture audio into realtime-sized frames", () => {
  const pcm = Buffer.alloc(16_000 * 2);
  const chunks = [...chunkPCM16(pcm, { sampleRate: 16_000, chunkMs: 100 })];

  assert.equal(chunks.length, 10);
  assert.equal(chunks[0].byteLength, 1_600 * 2);
});
