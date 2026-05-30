import test from "node:test";
import assert from "node:assert/strict";

import {
  buildClientWebSocketFrame,
  buildServerWebSocketFrame,
  tryReadWebSocketFrame
} from "./ws-frame.mjs";

test("tryReadWebSocketFrame decodes masked client binary frames", () => {
  const payload = Buffer.from([1, 2, 3, 4, 5]);
  const frame = buildClientWebSocketFrame(0x2, payload, Buffer.from([9, 8, 7, 6]));

  const decoded = tryReadWebSocketFrame(frame);

  assert.equal(decoded.opcode, 0x2);
  assert.deepEqual(decoded.payload, payload);
  assert.equal(decoded.bytesRead, frame.byteLength);
});

test("tryReadWebSocketFrame waits for complete frames", () => {
  const frame = buildServerWebSocketFrame(0x1, Buffer.from("hello"));

  assert.equal(tryReadWebSocketFrame(frame.subarray(0, 3)), null);
  assert.equal(tryReadWebSocketFrame(frame).payload.toString("utf8"), "hello");
});
