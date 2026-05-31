import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const project = readFileSync(new URL("../project.yml", import.meta.url), "utf8");
const presenceWatchApp = readFileSync(new URL("../Sources/PresenceWatchApp/PresenceWatchApp.swift", import.meta.url), "utf8");
const labInfo = readFileSync(new URL("../Sources/DeepResponseWatchLab/Info.plist", import.meta.url), "utf8");
const realtimeClient = readFileSync(new URL("../Sources/DeepResponseWatchLab/DeepResponseRealtimeClient.swift", import.meta.url), "utf8");

test("PresenceWatch keeps its normal entry point without DeepResponse debug routing", () => {
  assert(!presenceWatchApp.includes("DeepResponseDebugView()"));
  assert(!presenceWatchApp.includes("DeepResponseDebugEnabled"));
});

test("DeepResponseWatchLab is a separate Watch target with its own bundle id and realtime endpoint", () => {
  assert(project.includes("DeepResponseWatchLab:"));
  assert(project.includes("PRODUCT_BUNDLE_IDENTIFIER: $(APP_BUNDLE_PREFIX).DeepResponseWatchLab"));
  assert(project.includes("DeepResponseRealtimeEndpoint: \"$(DEEP_RESPONSE_REALTIME_ENDPOINT)\""));
  assert(project.includes("WKWatchOnly: true"));
  assert(project.includes("NSLocalNetworkUsageDescription:"));
  assert(labInfo.includes("NSLocalNetworkUsageDescription"));
  assert(!labInfo.includes("WKRunsIndependentlyOfCompanionApp"));
});

test("DeepResponseWatchLab preserves HTTPS endpoints for HTTP transport", () => {
  assert(realtimeClient.includes("case \"https\":"));
  assert(realtimeClient.includes("case \"wss\":"));
  assert(realtimeClient.includes("return \"https\""));
});
