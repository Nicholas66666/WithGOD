import test from "node:test";
import assert from "node:assert/strict";

import { parseHTTPAbortArgs } from "./test-deep-response-http-abort.mjs";

test("parseHTTPAbortArgs accepts next-turn validation", () => {
  const args = parseHTTPAbortArgs([
    "--pcm", "fixtures/speech.pcm",
    "--pipeline-mode", "cascade",
    "--expect-next-turn"
  ]);

  assert.equal(args.pipelineMode, "cascade");
  assert.equal(args.expectNextTurn, true);
});
