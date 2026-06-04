import test from "node:test";
import assert from "node:assert/strict";

import { parseHTTPSmokeArgs } from "./test-deep-response-http-smoke.mjs";

test("parseHTTPSmokeArgs accepts cascade pipeline mode", () => {
  const args = parseHTTPSmokeArgs([
    "--pcm", "fixtures/speech.pcm",
    "--pipeline-mode", "cascade",
    "--retries", "0",
    "--idle-timeout-ms", "50",
    "--idle-observe-ms", "1000"
  ]);

  assert.equal(args.pcmPath, "fixtures/speech.pcm");
  assert.equal(args.pipelineMode, "cascade");
  assert.equal(args.retries, 0);
  assert.equal(args.idleTimeoutMs, 50);
  assert.equal(args.idleObserveMs, 1000);
});
