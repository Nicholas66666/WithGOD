import test from "node:test";
import assert from "node:assert/strict";

import { startDeepResponseServer } from "./deep-response-server.mjs";
import {
  collectForbiddenTextFailures,
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
    "--idle-observe-ms", "1000",
    "--forbid-text-pattern", "大卫.*歌利亚",
    "--forbid-text-pattern", "你知道.*为什么"
  ]);

  assert.equal(args.pcmPath, "fixtures/speech.pcm");
  assert.equal(args.pipelineMode, "cascade");
  assert.equal(args.waitMs, 750);
  assert.equal(args.retries, 0);
  assert.equal(args.idleTimeoutMs, 50);
  assert.equal(args.idleObserveMs, 1000);
  assert.deepEqual(args.forbiddenTextPatterns, ["大卫.*歌利亚", "你知道.*为什么"]);
});

test("collectForbiddenTextFailures flags obvious comfort-intent derailments", () => {
  const failures = collectForbiddenTextFailures([
    { turnID: "turn-1", text: "那我给你讲个轻松的。你知道大卫为什么能打败歌利亚吗？" },
    { turnID: "turn-2", text: "我听见你很累，先慢慢歇一下。" }
  ], ["大卫.*歌利亚", "你知道.*为什么"]);

  assert.deepEqual(failures, [
    { turnID: "turn-1", forbiddenPattern: "大卫.*歌利亚", text: "那我给你讲个轻松的。你知道大卫为什么能打败歌利亚吗？" },
    { turnID: "turn-1", forbiddenPattern: "你知道.*为什么", text: "那我给你讲个轻松的。你知道大卫为什么能打败歌利亚吗？" }
  ]);
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
