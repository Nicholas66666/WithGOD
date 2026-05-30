import test from "node:test";
import assert from "node:assert/strict";

import { startDeepResponseServer } from "./deep-response-server.mjs";
import { DEEP_RESPONSE_EVENTS, buildDeepResponseURL, encodeDeepResponseMessage } from "./deep-response/protocol/deep-response-protocol.mjs";
import { RawWebSocketClient } from "./deep-response/lib/raw-websocket-client.mjs";

test("DeepResponse server echo mode streams audio and drops old audio after barge-in", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "echo",
    log: false
  });
  const received = { messages: [], audio: [] };
  let client = null;

  try {
    const url = buildDeepResponseURL(`http://127.0.0.1:${server.port}`);
    client = await RawWebSocketClient.connect(url, {
      "X-Deep-Response-Client": "node-test"
    });
    client.onText = (text) => received.messages.push(JSON.parse(text));
    client.onBinary = (chunk) => received.audio.push(Buffer.from(chunk));

    client.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.SessionStart, {
      sessionID: "test-session",
      sampleRate: 16000
    }));
    await waitFor(() => received.messages.some((message) => message.type === DEEP_RESPONSE_EVENTS.SessionReady));

    client.sendBinary(Buffer.from("old-audio"));
    await waitFor(() => received.audio.length === 1);

    client.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.BargeIn));
    client.sendBinary(Buffer.from("new-audio"));
    await waitFor(() => received.audio.length === 2);

    client.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.InputStop));
    await waitFor(() => received.messages.some((message) => message.type === DEEP_RESPONSE_EVENTS.AudioDone));
    await waitFor(() => received.messages.some((message) => message.type === DEEP_RESPONSE_EVENTS.Timing));

    assert.deepEqual(received.audio.map((chunk) => chunk.toString("utf8")), ["old-audio", "new-audio"]);
    assert(received.messages.some((message) => message.type === DEEP_RESPONSE_EVENTS.Timing));
  } finally {
    client?.close();
    await server.close();
  }
});

test("DeepResponse server exposes recent debug events for lab diagnosis", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "echo",
    log: false
  });
  let client = null;

  try {
    const health = await fetchJSON(`http://127.0.0.1:${server.port}/health`);
    assert.equal(health.ok, true);

    const url = buildDeepResponseURL(`http://127.0.0.1:${server.port}`);
    client = await RawWebSocketClient.connect(url, {
      "X-Deep-Response-Client": "debug-test"
    });
    client.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.SessionStart, {
      sessionID: "debug-session",
      sampleRate: 16000
    }));

    await waitFor(async () => {
      const debug = await fetchJSON(`http://127.0.0.1:${server.port}/debug/events`);
      return debug.events.some((event) => event.type === "health")
        && debug.events.some((event) => event.type === "upgrade" && event.deepResponseClient === "debug-test")
        && debug.events.some((event) => event.type === "realtime_connection")
        && debug.events.some((event) => event.type === "session_start");
    });
  } finally {
    client?.close();
    await server.close();
  }
});

test("DeepResponse server accepts HTTP probe payloads for Watch lab fallback diagnosis", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "echo",
    log: false
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/debug/http-probe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Deep-Response-Client": "http-probe-test"
      },
      body: Buffer.from("watch-probe")
    });
    assert.equal(response.ok, true);
    assert.deepEqual(await response.json(), {
      ok: true,
      bytes: 11
    });

    await waitFor(async () => {
      const debug = await fetchJSON(`http://127.0.0.1:${server.port}/debug/events`);
      return debug.events.some((event) => event.type === "http_probe"
        && event.bytes === 11
        && event.deepResponseClient === "http-probe-test");
    });
  } finally {
    await server.close();
  }
});

test("DeepResponse server provider mode runs pipeline and emits transcript text audio and timing", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async run({ audioChunks }) {
        const collected = [];
        for await (const chunk of audioChunks) {
          collected.push(chunk);
        }
        return {
          transcript: `chunks:${collected.length}`,
          responseText: "我在这里陪着你。",
          firstPhrase: "我在这里陪着你。",
          audioChunks: [Buffer.from("provider-audio")],
          audioByteLength: Buffer.byteLength("provider-audio"),
          timing: { voice_pipeline_total_ms: 123 },
          providerMeta: { ttsMode: "mock" }
        };
      }
    })
  });
  const received = { messages: [], audio: [] };
  let client = null;

  try {
    const url = buildDeepResponseURL(`http://127.0.0.1:${server.port}`);
    client = await RawWebSocketClient.connect(url, {
      "X-Deep-Response-Client": "node-test"
    });
    client.onText = (text) => received.messages.push(JSON.parse(text));
    client.onBinary = (chunk) => received.audio.push(Buffer.from(chunk));

    client.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.SessionStart, {
      sessionID: "provider-session",
      sampleRate: 16000
    }));
    await waitFor(() => received.messages.some((message) => message.type === DEEP_RESPONSE_EVENTS.SessionReady));
    client.sendBinary(Buffer.from("a"));
    client.sendBinary(Buffer.from("b"));
    client.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.InputStop));

    await waitFor(() => received.messages.some((message) => message.type === DEEP_RESPONSE_EVENTS.AudioDone));

    assert(received.messages.some((message) => message.type === DEEP_RESPONSE_EVENTS.TranscriptFinal && message.transcript === "chunks:2"));
    assert(received.messages.some((message) => message.type === DEEP_RESPONSE_EVENTS.AssistantTextDelta && message.delta === "我在这里陪着你。"));
    assert.deepEqual(received.audio.map((chunk) => chunk.toString("utf8")), ["provider-audio"]);
    assert(received.messages.some((message) => message.type === DEEP_RESPONSE_EVENTS.Timing && message.timing.voice_pipeline_total_ms === 123));
  } finally {
    client?.close();
    await server.close();
  }
});

async function waitFor(predicate, { timeoutMs = 2_000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("waitFor timeout");
}

async function fetchJSON(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true);
  return response.json();
}
