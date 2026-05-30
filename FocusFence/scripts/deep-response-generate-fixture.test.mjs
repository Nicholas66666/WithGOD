import test from "node:test";
import assert from "node:assert/strict";

import { parseFixtureArgs } from "./deep-response-generate-fixture.mjs";

test("parseFixtureArgs accepts text and output path", () => {
  assert.deepEqual(parseFixtureArgs(["--text", "我很累", "--out", "/tmp/speech.wav"]), {
    text: "我很累",
    outPath: "/tmp/speech.wav"
  });
});

test("parseFixtureArgs requires an output path", () => {
  assert.throws(() => parseFixtureArgs(["--text", "我很累"]), /--out/);
});
