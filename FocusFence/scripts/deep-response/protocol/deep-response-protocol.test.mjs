import test from "node:test";
import assert from "node:assert/strict";

import {
  DEEP_RESPONSE_EVENTS,
  buildDeepResponseURL,
  decodeDeepResponseMessage,
  encodeDeepResponseMessage,
  isDeepResponseRealtimePath
} from "./deep-response-protocol.mjs";

test("buildDeepResponseURL converts HTTP server URL to deep response WebSocket URL", () => {
  assert.equal(
    buildDeepResponseURL("http://127.0.0.1:8797").toString(),
    "ws://127.0.0.1:8797/deep-response/realtime"
  );
  assert.equal(
    buildDeepResponseURL("https://example.com/base").toString(),
    "wss://example.com/base/deep-response/realtime"
  );
});

test("isDeepResponseRealtimePath only accepts the dedicated route", () => {
  assert.equal(isDeepResponseRealtimePath("/deep-response/realtime"), true);
  assert.equal(isDeepResponseRealtimePath("/presence/process?realtime=1"), false);
});

test("encodeDeepResponseMessage and decodeDeepResponseMessage preserve event payloads", () => {
  const encoded = encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.SessionStart, {
    sessionID: "s1",
    sampleRate: 16000
  });

  assert.deepEqual(decodeDeepResponseMessage(encoded), {
    type: "session.start",
    sessionID: "s1",
    sampleRate: 16000
  });
});

test("DEEP_RESPONSE_EVENTS includes provider-mode output events", () => {
  assert.equal(DEEP_RESPONSE_EVENTS.TranscriptFinal, "transcript.final");
  assert.equal(DEEP_RESPONSE_EVENTS.AssistantTextDelta, "assistant.text_delta");
});
