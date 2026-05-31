import test from "node:test";
import assert from "node:assert/strict";

import {
  chunkPCM16,
  parseHTTPSessionArgs,
  summarizeHTTPSessionResult
} from "./test-deep-response-http-session.mjs";

test("parseHTTPSessionArgs requires a PCM fixture by default", () => {
  assert.throws(() => parseHTTPSessionArgs([]), /--pcm/);
  assert.deepEqual(parseHTTPSessionArgs(["--pcm", "fixtures/speech.pcm"]), {
    endpoint: "http://127.0.0.1:8797",
    pcmPath: "fixtures/speech.pcm",
    chunkMs: 100,
    uploadSleepMs: null,
    pollMs: 250,
    timeoutMs: 90_000,
    outputAudioPath: "",
    deflate: false,
    verbose: false
  });
});

test("parseHTTPSessionArgs accepts endpoint chunk polling and output options", () => {
  assert.deepEqual(parseHTTPSessionArgs([
    "--endpoint",
    "https://example.test",
    "--pcm",
    "fixtures/speech.pcm",
    "--chunk-ms",
    "40",
    "--upload-sleep-ms",
    "0",
    "--poll-ms",
    "100",
    "--timeout-ms",
    "120000",
    "--out-audio",
    "/tmp/out.pcm",
    "--deflate",
    "--verbose"
  ]), {
    endpoint: "https://example.test",
    pcmPath: "fixtures/speech.pcm",
    chunkMs: 40,
    uploadSleepMs: 0,
    pollMs: 100,
    timeoutMs: 120_000,
    outputAudioPath: "/tmp/out.pcm",
    deflate: true,
    verbose: true
  });
});

test("chunkPCM16 splits PCM into realtime-sized chunks", () => {
  const pcm = Buffer.alloc(16_000 * 2);
  const chunks = [...chunkPCM16(pcm, { sampleRate: 16_000, chunkMs: 100 })];

  assert.equal(chunks.length, 10);
  assert.equal(chunks[0].byteLength, 3_200);
});

test("summarizeHTTPSessionResult reports first audio and timing", () => {
  const summary = summarizeHTTPSessionResult({
    startedAt: 1_000,
    uploadStartedAt: 1_100,
    uploadEndedAt: 1_300,
    firstAudioAt: 2_000,
    endedAt: 2_500,
    sessionID: "drs_1",
    uploadChunks: 2,
    encodedUploadBytes: 80,
    decodedUploadBytes: 160,
    events: [
      { type: "session_ready" },
      { type: "transcript_final", text: "我很累" },
      { type: "assistant_text_delta", delta: "我听见你很累。" },
      { type: "timing", timing: { voice_pipeline_total_ms: 1234 } }
    ],
    audioChunks: [
      { audioByteLength: 100 },
      { audioByteLength: 200 }
    ]
  });

  assert.deepEqual(summary, {
    ok: true,
    elapsedMs: 1_500,
    uploadMs: 200,
    firstAudioMs: 1_000,
    stopToFirstAudioMs: 700,
    sessionID: "drs_1",
    uploadChunks: 2,
    encodedUploadBytes: 80,
    decodedUploadBytes: 160,
    transcript: "我很累",
    text: "我听见你很累。",
    audioByteLength: 300,
    audioChunks: 2,
    timing: { voice_pipeline_total_ms: 1234 }
  });
});
