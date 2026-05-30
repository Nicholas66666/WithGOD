import test from "node:test";
import assert from "node:assert/strict";

import { parseRealtimeArgs } from "./test-deep-response-realtime.mjs";

test("parseRealtimeArgs requires a PCM fixture", () => {
  assert.throws(() => parseRealtimeArgs([]), /--pcm/);
  assert.deepEqual(parseRealtimeArgs(["--pcm", "/tmp/speech.pcm"]), {
    endpoint: "http://127.0.0.1:8797",
    pcmPath: "/tmp/speech.pcm",
    chunkMs: 100,
    outputAudioPath: "",
    verbose: false
  });
});
