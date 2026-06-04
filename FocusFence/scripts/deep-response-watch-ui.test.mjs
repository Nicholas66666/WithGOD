import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const debugViewSource = readFileSync("Sources/DeepResponseWatchLab/DeepResponseDebugView.swift", "utf8");
const realtimeClientSource = readFileSync("Sources/DeepResponseWatchLab/DeepResponseRealtimeClient.swift", "utf8");

test("DeepResponse Watch debug UI presents assistant reply as one god field", () => {
  assert.match(debugViewSource, /Text\("god: \\\(/);
  assert.doesNotMatch(debugViewSource, /Text\("first: /);
  assert.doesNotMatch(debugViewSource, /Text\("more: /);
});

test("DeepResponse Watch HTTP session requests cascade pipeline mode", () => {
  assert.match(realtimeClientSource, /"pipelineMode"\s*:\s*"cascade"/);
  assert.doesNotMatch(realtimeClientSource, /request\.httpBody = #"\{"sampleRate":16000\}"#/);
});

test("DeepResponse Watch HTTP session appends streaming assistant deltas", () => {
  assert.match(realtimeClientSource, /lastTurnFirstText = Self\.appendText\(lastTurnFirstText, event\.delta\)/);
  assert.match(realtimeClientSource, /lastTurnFollowupText = Self\.appendText\(lastTurnFollowupText, event\.delta\)/);
  assert.doesNotMatch(realtimeClientSource, /lastTurnFirstText = event\.delta/);
  assert.doesNotMatch(realtimeClientSource, /lastTurnFollowupText = event\.delta/);
});
