import assert from "node:assert/strict";
import { test } from "node:test";

import { createWatchWssEchoServer } from "./watch-wss-echo-server.mjs";

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

function waitForMessage(socket) {
  return new Promise((resolve, reject) => {
    socket.addEventListener("message", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("serves health and echoes binary frames", async () => {
  const app = createWatchWssEchoServer({ pingIntervalMs: 0 });
  await app.listen(0, "127.0.0.1");

  try {
    const health = await fetch(`http://127.0.0.1:${app.port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true, service: "watch-wss-echo" });

    const socket = new WebSocket(`ws://127.0.0.1:${app.port}/ws/echo`);
    socket.binaryType = "arraybuffer";
    await waitForOpen(socket);

    const payload = new Uint8Array([0x57, 0x53, 0x4c, 0x01, 0x02, 0x03]);
    socket.send(payload);

    const event = await waitForMessage(socket);
    assert.deepEqual([...new Uint8Array(event.data)], [...payload]);
    socket.close();
  } finally {
    await closeServer(app.server);
  }
});

test("acks abort control messages", async () => {
  const app = createWatchWssEchoServer({ pingIntervalMs: 0 });
  await app.listen(0, "127.0.0.1");

  try {
    const socket = new WebSocket(`ws://127.0.0.1:${app.port}/ws/audio-echo`);
    await waitForOpen(socket);

    socket.send(JSON.stringify({ type: "abort", generation: 7 }));

    const event = await waitForMessage(socket);
    assert.deepEqual(JSON.parse(event.data), {
      type: "abort_ack",
      generation: 7,
    });
    socket.close();
  } finally {
    await closeServer(app.server);
  }
});
