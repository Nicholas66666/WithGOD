import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const debugViewSource = readFileSync("Sources/DeepResponseWatchLab/DeepResponseDebugView.swift", "utf8");

test("DeepResponse Watch debug UI presents assistant reply as one god field", () => {
  assert.match(debugViewSource, /Text\("god: \\\(/);
  assert.doesNotMatch(debugViewSource, /Text\("first: /);
  assert.doesNotMatch(debugViewSource, /Text\("more: /);
});
