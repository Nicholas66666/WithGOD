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
  assert.match(command, /--expect-llm-started-from-partial/);
  assert.match(command, /--expect-ark-model doubao-seed-character-251128/);
  assert.match(command, /--expect-ark-fallback-model ''/);
  assert.match(command, /--forbid-identical-consecutive-replies/);
  assert.match(command, /--forbid-text-pattern '大卫\.\*歌利亚'/);
  assert.match(command, /--forbid-text-pattern '你知道\.\*为什么'/);
  assert.match(command, /--forbid-text-pattern '\[:：\]\\s\*\$\|给你\(找\|读\)一句\|再给你\(找\|读\)一句\|再找一句\|你还想听\|你还是想听\|你又想听\|喊累\|没说完\|只说\.\*想听\|是还想听\|你\(\?:今天\)\?还是\(\?:觉得\|有点\)\?累\|你又累\|你又\(\?:觉得\|感到\)\(\?:累\|疲惫\)'/);
  assert.match(command, /--forbid-text-pattern '从哪卷书\|哪卷书\.\*开始\|哪句经文\.\*开始'/);
  assert.match(command, /--forbid-text-pattern '从哪里开始\|想从哪里开始'/);
  assert.match(command, /--forbid-text-pattern '《\[\^》\]\+》\(\?:里\)\?说\|经上说\|圣经说\|主说\|神说\|耶稣说'/);
  assert.match(command, /--forbid-text-pattern '那来\|来句\|听这句\|缓缓神'/);
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

test("package exposes standard Fire Volcengine DeepResponse continuous conversation gate", () => {
  const command = packageJSON.scripts?.["deep:volc:conversation:full"] || "";

  assert.match(command, /npm run deep:http-conversation:test --/);
  assert.match(command, /--endpoint http:\/\/124\.174\.96\.149:8797/);
  assert.match(command, /--pcm \/private\/tmp\/deep-response-http-speed\.pcm/);
  assert.match(command, /--turns 8/);
  assert.match(command, /--pipeline-mode cascade/);
  assert.match(command, /--wait-ms 800/);
  assert.match(command, /--max-opening-stem-repeats 2/);
  assert.match(command, /--end-reason user_goodbye/);
  assert.match(command, /--expect-session-end/);
  assert.match(command, /--expect-late-audio-409/);
  assert.match(command, /--expect-memory-recalled/);
  assert.match(command, /--expect-memory-persisted/);
  assert.match(command, /--forbid-identical-consecutive-replies/);
  assert.match(command, /--max-assistant-reply-chars 48/);
  assert.match(command, /--min-assistant-reply-chars 8/);
  assert.match(command, /--max-stop-to-first-audio-ms 2500/);
  assert.match(command, /--forbid-text-pattern '\[:：\]\\s\*\$\|给你\(找\|读\)一句\|再给你\(找\|读\)一句\|再找一句\|你还想听\|你还是想听\|你又想听\|喊累\|没说完\|只说\.\*想听\|是还想听\|你\(\?:今天\)\?还是\(\?:觉得\|有点\)\?累\|你又累\|你又\(\?:觉得\|感到\)\(\?:累\|疲惫\)'/);
  assert.match(command, /--forbid-text-pattern '《\[\^》\]\+》\(\?:里\)\?说\|经上说\|圣经说\|主说\|神说\|耶稣说'/);
  assert.match(command, /--forbid-text-pattern '那来\|来句\|听这句\|缓缓神'/);
});

test("package exposes a single DeepResponse full self-test gate", () => {
  const command = packageJSON.scripts?.["deep:selftest:full"] || "";

  assert.match(command, /npm run test:node/);
  assert.match(command, /npm run deep:volc:smoke:full/);
  assert.match(command, /npm run deep:volc:conversation:full/);
  assert.match(command, /npm run deep:watchlab:build:volc/);
  assert.match(command, /&&/);
});

test("package does not expose Watch or DeepResponse WebSocket development entrypoints", () => {
  const scriptNames = Object.keys(packageJSON.scripts || {});

  assert(!scriptNames.includes("watch:wss:echo"));
  assert(!scriptNames.includes("deep:echo:test"));
  assert(!scriptNames.includes("deep:realtime:test"));
});
