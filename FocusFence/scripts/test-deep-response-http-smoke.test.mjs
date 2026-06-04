import test from "node:test";
import assert from "node:assert/strict";

import { startDeepResponseServer } from "./deep-response-server.mjs";
import {
  parseHTTPSmokeArgs,
  runHTTPIdleProbe
} from "./test-deep-response-http-smoke.mjs";

test("parseHTTPSmokeArgs accepts cascade pipeline mode", () => {
  const args = parseHTTPSmokeArgs([
    "--pcm", "fixtures/speech.pcm",
    "--pipeline-mode", "cascade",
    "--wait-ms", "750",
    "--retries", "0",
    "--idle-timeout-ms", "50",
    "--idle-observe-ms", "1000"
  ]);

  assert.equal(args.pcmPath, "fixtures/speech.pcm");
  assert.equal(args.pipelineMode, "cascade");
  assert.equal(args.waitMs, 750);
  assert.equal(args.retries, 0);
  assert.equal(args.idleTimeoutMs, 50);
  assert.equal(args.idleObserveMs, 1000);
});

test("runHTTPIdleProbe verifies idle session end and rejects late audio", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false
  });

  try {
    const summary = await runHTTPIdleProbe({
      endpoint: `http://127.0.0.1:${server.port}`,
      idleTimeoutMs: 20,
      idleObserveMs: 1_000,
      pollMs: 25
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.endReason, "idle_timeout");
    assert.equal(summary.rejectedStatus, 409);
  } finally {
    await server.close();
  }
});
