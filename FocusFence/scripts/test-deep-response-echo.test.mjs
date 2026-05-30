import test from "node:test";
import assert from "node:assert/strict";

import { parseEchoArgs } from "./test-deep-response-echo.mjs";

test("parseEchoArgs uses local DeepResponse server defaults", () => {
  assert.deepEqual(parseEchoArgs([]), {
    endpoint: "http://127.0.0.1:8797",
    durationMs: 1_000,
    chunkMs: 100,
    verbose: false
  });
});

test("parseEchoArgs accepts endpoint and chunk options", () => {
  assert.deepEqual(parseEchoArgs(["--endpoint", "http://localhost:9999", "--duration-ms", "2000", "--chunk-ms", "200", "--verbose"]), {
    endpoint: "http://localhost:9999",
    durationMs: 2_000,
    chunkMs: 200,
    verbose: true
  });
});
