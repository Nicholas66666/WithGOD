import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const gate = readFileSync("docs/superpowers/plans/2026-06-04-deep-response-integration-gate.md", "utf8");
const productDecision = readFileSync("docs/superpowers/plans/2026-06-05-deep-response-product-integration-decision.md", "utf8");
const plan = readFileSync("docs/superpowers/plans/2026-05-31-deep-response-true-streaming.md", "utf8");
const activeState = readFileSync("docs/superpowers/plans/2026-05-31-deep-response-active-state.md", "utf8");
const presenceWatchApp = readFileSync("Sources/PresenceWatchApp/PresenceWatchApp.swift", "utf8");
const deepLabClient = readFileSync("Sources/DeepResponseWatchLab/DeepResponseRealtimeClient.swift", "utf8");
const deepResponseServer = readFileSync("scripts/deep-response-server.mjs", "utf8");
const quickResponseSourceRoots = ["Sources/PresenceWatchApp", "Sources/PresenceApp"];
const forbiddenWatchWebSocketScriptFiles = [
  "scripts/watch-wss-echo-server.mjs",
  "scripts/watch-wss-echo-server.test.mjs",
  "scripts/test-deep-response-echo.mjs",
  "scripts/test-deep-response-echo.test.mjs",
  "scripts/test-deep-response-realtime.mjs",
  "scripts/test-deep-response-realtime.test.mjs"
];
const forbiddenQuickResponsePatterns = [
  /DeepResponse/u,
  /DeepLab/u,
  /deep-response/u
];

test("DeepResponse integration gate keeps product integration explicitly blocked by default", () => {
  assert.match(gate, /Status: blocked until explicit user approval/i);
  assert.match(gate, /Quick Response main flow stays untouched/i);
  assert.match(gate, /DeepResponseWatchLab remains the active test package/i);
  assert.match(gate, /Watch transport remains HTTP-only/i);
  assert.match(gate, /No WebSocket feasibility or fallback work/i);
  assert.match(gate, /Rollback tag required before integration/i);
  assert.match(gate, /Feature flag required before main app entry/i);
  assert.match(gate, /Product-experience spot check is optional and user-requested/i);
  assert.match(gate, /Directory-level source guard required for PresenceWatchApp and PresenceApp/i);
});

test("DeepResponse has an explicit S6 product integration decision artifact", () => {
  assert.match(productDecision, /Decision: keep DeepResponse in the independent Lab target/i);
  assert.match(productDecision, /Do not integrate into Quick Response/i);
  assert.match(productDecision, /HTTP-only/i);
  assert.match(productDecision, /self-test/i);
  assert.match(productDecision, /explicit user approval/i);
  assert.match(productDecision, /rollback tag/i);
  assert.match(productDecision, /Feature flag/i);
  assert.match(productDecision, /DeepResponseWatchLab/i);
  assert.match(productDecision, /Quick Response main flow stays untouched/i);
});

test("DeepResponse integration gate matches current code boundaries", () => {
  assert.doesNotMatch(presenceWatchApp, /DeepResponseDebugView|DeepResponseRealtimeClient|DeepLab/);
  assert.doesNotMatch(deepLabClient, /URLSessionWebSocketTask|connectionStage = "ws:/);
  assert.match(deepLabClient, /URLSession\.shared\.upload/);
  assert.match(deepLabClient, /URLSession\.shared\.data/);
  assert.match(plan, /No change to Quick Response main flow until user explicitly approves product integration/);
  assert.match(plan, /There is a rollback tag before integration/);
});

test("DeepResponse active-state handoff matches current HTTP-only self-test policy", () => {
  assert.match(activeState, /Watch 端 transport 固定使用 HTTP/u);
  assert.match(activeState, /完全不再考虑 Watch WebSocket/u);
  assert.match(activeState, /自测试优先/u);
  assert.match(activeState, /用户人工 Watch 真机测试不作为常规推进条件/u);
  assert.match(activeState, /DeepResponseWatchLab/u);
  assert.match(activeState, /Quick Response/u);
  assert.doesNotMatch(activeState, /WebSocket Spike Rules|feasibility spike|只允许做隔离 feasibility spike/u);
});

test("DeepResponse integration gate scans all Quick Response app sources", () => {
  const failures = collectForbiddenQuickResponseReferences(quickResponseSourceRoots, forbiddenQuickResponsePatterns);
  assert.deepEqual(failures, []);
});

test("DeepResponse self-test suite does not include client-facing WebSocket spike files", () => {
  const trackedScriptFiles = collectSourceFiles(["scripts"]);
  const forbiddenPresent = forbiddenWatchWebSocketScriptFiles.filter((file) => trackedScriptFiles.includes(file));

  assert.deepEqual(forbiddenPresent, []);
});

test("DeepResponse server exposes HTTP session transport without client-facing WebSocket upgrade", () => {
  assert.doesNotMatch(deepResponseServer, /acceptWebSocketUpgrade|server\.on\("upgrade"|handleRealtimeConnection/u);
  assert.match(deepResponseServer, /handleHTTPSessionCreate/u);
  assert.match(deepResponseServer, /handleHTTPSessionRoute/u);
});

function collectForbiddenQuickResponseReferences(roots, patterns) {
  const failures = [];
  for (const file of collectSourceFiles(roots)) {
    const source = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      if (pattern.test(source)) {
        failures.push({ file, pattern: pattern.source });
      }
    }
  }
  return failures;
}

function collectSourceFiles(roots) {
  const files = [];
  for (const root of roots) {
    collectSourceFilesInto(root, files);
  }
  return files.sort();
}

function collectSourceFilesInto(path, files) {
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      collectSourceFilesInto(join(path, entry), files);
    }
    return;
  }
  if (/\.(swift|plist|mjs)$/u.test(path)) {
    files.push(path);
  }
}
