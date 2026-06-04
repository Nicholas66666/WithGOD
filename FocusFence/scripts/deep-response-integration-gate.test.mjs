import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const gate = readFileSync("docs/superpowers/plans/2026-06-04-deep-response-integration-gate.md", "utf8");
const plan = readFileSync("docs/superpowers/plans/2026-05-31-deep-response-true-streaming.md", "utf8");
const presenceWatchApp = readFileSync("Sources/PresenceWatchApp/PresenceWatchApp.swift", "utf8");
const deepLabClient = readFileSync("Sources/DeepResponseWatchLab/DeepResponseRealtimeClient.swift", "utf8");

test("DeepResponse integration gate keeps product integration explicitly blocked by default", () => {
  assert.match(gate, /Status: blocked until explicit user approval/i);
  assert.match(gate, /Quick Response main flow stays untouched/i);
  assert.match(gate, /DeepResponseWatchLab remains the active test package/i);
  assert.match(gate, /Watch transport remains HTTP-only/i);
  assert.match(gate, /No WebSocket feasibility or fallback work/i);
  assert.match(gate, /Rollback tag required before integration/i);
  assert.match(gate, /Feature flag required before main app entry/i);
  assert.match(gate, /Product-experience spot check is optional and user-requested/i);
});

test("DeepResponse integration gate matches current code boundaries", () => {
  assert.doesNotMatch(presenceWatchApp, /DeepResponseDebugView|DeepResponseRealtimeClient|DeepLab/);
  assert.doesNotMatch(deepLabClient, /URLSessionWebSocketTask|connectionStage = "ws:/);
  assert.match(deepLabClient, /URLSession\.shared\.upload/);
  assert.match(deepLabClient, /URLSession\.shared\.data/);
  assert.match(plan, /No change to Quick Response main flow until user explicitly approves product integration/);
  assert.match(plan, /There is a rollback tag before integration/);
});
