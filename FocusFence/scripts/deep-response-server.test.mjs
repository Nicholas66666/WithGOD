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

test("DeepResponse server echoes HTTP audio payloads for Watch lab channel validation", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "echo",
    log: false
  });

  try {
    const payload = Buffer.from("watch-audio");
    const response = await fetch(`http://127.0.0.1:${server.port}/debug/http-echo`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Deep-Response-Client": "http-echo-test"
      },
      body: payload
    });
    assert.equal(response.ok, true);
    assert.equal(response.headers.get("content-type"), "application/octet-stream");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);

    await waitFor(async () => {
      const debug = await fetchJSON(`http://127.0.0.1:${server.port}/debug/events`);
      return debug.events.some((event) => event.type === "http_echo"
        && event.bytes === payload.length
        && event.deepResponseClient === "http-echo-test");
    });
  } finally {
    await server.close();
  }
});

test("DeepResponse server completes an HTTP realtime turn with JSON audio response", async () => {
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
          responseText: "HTTP fallback response",
          firstPhrase: "HTTP fallback response",
          audioChunks: [Buffer.from("http-provider-audio")],
          audioByteLength: Buffer.byteLength("http-provider-audio"),
          timing: { voice_pipeline_total_ms: 42 },
          providerMeta: { transport: "http" }
        };
      }
    })
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/deep-response/http-turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Deep-Response-Client": "http-turn-test",
        "X-Deep-Response-Session": "http-session"
      },
      body: Buffer.from("watch-turn-audio")
    });
    assert.equal(response.ok, true);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.sessionID, "http-session");
    assert.equal(body.transcript, "chunks:1");
    assert.equal(body.text, "HTTP fallback response");
    assert.equal(Buffer.from(body.audioBase64, "base64").toString("utf8"), "http-provider-audio");
    assert.equal(body.audioByteLength, 19);
    assert.equal(body.sampleRate, 24000);
    assert.equal(body.timing.voice_pipeline_total_ms, 42);
    assert.deepEqual(body.providerMeta, { transport: "http" });

    await waitFor(async () => {
      const debug = await fetchJSON(`http://127.0.0.1:${server.port}/debug/events`);
      return debug.events.some((event) => event.type === "http_turn"
        && event.bytes === Buffer.byteLength("watch-turn-audio")
        && event.deepResponseClient === "http-turn-test")
        && debug.events.some((event) => event.type === "http_turn_complete"
          && event.audioByteLength === 19
          && event.transcript === "chunks:1"
          && event.text === "HTTP fallback response"
          && event.timing?.voice_pipeline_total_ms === 42);
    });
  } finally {
    await server.close();
  }
});

test("DeepResponse server chunks HTTP realtime turn PCM before provider pipeline", async () => {
  const seenChunkSizes = [];
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async run({ audioChunks }) {
        for await (const chunk of audioChunks) {
          seenChunkSizes.push(chunk.byteLength);
        }
        return {
          transcript: `chunks:${seenChunkSizes.length}`,
          responseText: "chunked",
          firstPhrase: "chunked",
          audioChunks: [Buffer.from("chunked-audio")],
          audioByteLength: Buffer.byteLength("chunked-audio"),
          timing: {},
          providerMeta: {}
        };
      }
    })
  });

  try {
    const payload = Buffer.alloc(6_800, 1);
    const response = await fetch(`http://127.0.0.1:${server.port}/deep-response/http-turn`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: payload
    });
    assert.equal(response.ok, true);
    const body = await response.json();
    assert.equal(body.transcript, "chunks:3");
    assert.deepEqual(seenChunkSizes, [3_200, 3_200, 400]);
  } finally {
    await server.close();
  }
});

test("DeepResponse server HTTP realtime turn echoes audio in echo mode", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "echo",
    log: false
  });

  try {
    const payload = Buffer.from("watch-turn-audio");
    const response = await fetch(`http://127.0.0.1:${server.port}/deep-response/http-turn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Deep-Response-Client": "http-turn-echo-test",
        "X-Deep-Response-Session": "http-echo-session"
      },
      body: payload
    });
    assert.equal(response.ok, true);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.sessionID, "http-echo-session");
    assert.equal(body.transcript, "");
    assert.equal(body.text, "echo");
    assert.equal(Buffer.from(body.audioBase64, "base64").toString("utf8"), "watch-turn-audio");
    assert.equal(body.audioByteLength, payload.length);
    assert.equal(body.sampleRate, 16000);
    assert.equal(body.providerMeta.mode, "echo");
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
