import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJSON = JSON.parse(readFileSync("package.json", "utf8"));

test("package exposes standard Fire Volcengine DeepResponse full smoke gate", () => {
  const command = packageJSON.scripts?.["deep:volc:smoke:full"] || "";

  assert.match(command, /npm run deep:http-smoke:test --/);
  assert.match(command, /--endpoint http:\/\/124\.174\.96\.149:8797/);
  assert.match(command, /--pcm \/private\/tmp\/deep-response-http-speed\.pcm/);
  assert.match(command, /--pipeline-mode cascade/);
  assert.match(command, /--wait-ms 800/);
  assert.match(command, /--idle-goodbye/);
  assert.match(command, /--expect-memory-recalled/);
  assert.match(command, /--expect-memory-persisted/);
  assert.match(command, /--expect-idle-memory-persisted/);
  assert.match(command, /--expect-abort-next-turn/);
  assert.match(command, /--expect-ark-model doubao-seed-character-251128/);
  assert.match(command, /--expect-ark-fallback-model ''/);
  assert.match(command, /--forbid-identical-consecutive-replies/);
  assert.match(command, /--forbid-text-pattern '大卫\.\*歌利亚'/);
  assert.match(command, /--forbid-text-pattern '你知道\.\*为什么'/);
  assert.match(command, /--forbid-text-pattern '从哪卷书\|哪卷书\.\*开始\|哪句经文\.\*开始'/);
  assert.match(command, /--forbid-text-pattern '从哪里开始\|想从哪里开始'/);
});

test("package exposes standard DeepResponse WatchLab Volcengine build gate", () => {
  const command = packageJSON.scripts?.["deep:watchlab:build:volc"] || "";

  assert.match(command, /DEEP_RESPONSE_REALTIME_ENDPOINT=http:\/\/124\.174\.96\.149:8797/);
  assert.match(command, /xcodebuild -project Focus\.xcodeproj/);
  assert.match(command, /-scheme DeepResponseWatchLab/);
  assert.match(command, /-destination generic\/platform=watchOS/);
  assert.match(command, /-derivedDataPath \/private\/tmp\/focus-deepresponse-watchlab-volc-build/);
  assert.match(command, /\bbuild\b/);
});

test("package exposes a single DeepResponse full self-test gate", () => {
  const command = packageJSON.scripts?.["deep:selftest:full"] || "";

  assert.match(command, /npm run test:node/);
  assert.match(command, /npm run deep:volc:smoke:full/);
  assert.match(command, /npm run deep:watchlab:build:volc/);
  assert.match(command, /&&/);
});

test("package does not expose Watch or DeepResponse WebSocket development entrypoints", () => {
  const scriptNames = Object.keys(packageJSON.scripts || {});

  assert(!scriptNames.includes("watch:wss:echo"));
  assert(!scriptNames.includes("deep:echo:test"));
  assert(!scriptNames.includes("deep:realtime:test"));
});
