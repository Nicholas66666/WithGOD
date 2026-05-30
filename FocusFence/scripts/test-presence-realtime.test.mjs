import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRealtimeURL,
  chunkPCM,
  generateTonePCM16,
  isDirectRun,
  parseEnvFile
} from "./test-presence-realtime.mjs";

test("parseEnvFile reads simple dotenv content without exposing comments", () => {
  const env = parseEnvFile(`
    # comment
    PRESENCE_PROCESS_ENDPOINT="https://example.com/presence-process"
    PRESENCE_CLIENT_TOKEN='secret-token'
    EMPTY=
  `);

  assert.deepEqual(env, {
    PRESENCE_PROCESS_ENDPOINT: "https://example.com/presence-process",
    PRESENCE_CLIENT_TOKEN: "secret-token",
    EMPTY: ""
  });
});

test("buildRealtimeURL converts HTTP endpoint to realtime WebSocket URL", () => {
  assert.equal(
    buildRealtimeURL("https://example.com/presence-process").toString(),
    "wss://example.com/presence-process?realtime=1"
  );

  assert.equal(
    buildRealtimeURL("http://localhost:8787/presence/process?debug=1").toString(),
    "ws://localhost:8787/presence/process?debug=1&realtime=1"
  );
});

test("generateTonePCM16 and chunkPCM create 24kHz mono int16 audio chunks", () => {
  const pcm = generateTonePCM16({ durationMs: 1_000, sampleRate: 24_000, frequencyHz: 440 });
  assert.equal(pcm.byteLength, 24_000 * 2);

  const chunks = [...chunkPCM(pcm, { sampleRate: 24_000, chunkDurationMs: 200 })];
  assert.equal(chunks.length, 5);
  assert.equal(chunks[0].byteLength, 4_800 * 2);
});

test("isDirectRun handles script paths with spaces", () => {
  const scriptPath = "/tmp/New project/scripts/test-presence-realtime.mjs";
  assert.equal(
    isDirectRun(new URL("file:///tmp/New%20project/scripts/test-presence-realtime.mjs").href, scriptPath),
    true
  );
});
