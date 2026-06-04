import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";

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

test("DeepResponse server exposes non-secret debug config", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    env: {
      ARK_MODEL: "ark-model",
      DOUBAO_ASR_MODEL_NAME: "asr-model",
      DOUBAO_ASR_END_WINDOW_SIZE_MS: "300",
      DEEP_RESPONSE_AUDIO_REPLAY_INTERVAL_MS: "25"
    }
  });

  try {
    const config = await fetchJSON(`http://127.0.0.1:${server.port}/debug/config`);
    assert.equal(config.ok, true);
    assert.equal(config.mode, "provider");
    assert.equal(config.audioReplayIntervalMs, 25);
    assert.equal(config.firstPhraseMode, "llm");
    assert.equal(config.arkModel, "ark-model");
    assert.equal(config.asrModelName, "asr-model");
    assert.equal(config.asrEndWindowSizeMs, "300");
  } finally {
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

test("DeepResponse server completes a segmented HTTP turn with first and followup audio", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async runSegmented({ audioChunks }) {
        const collected = [];
        for await (const chunk of audioChunks) {
          collected.push(chunk);
        }
        return {
          transcript: `chunks:${collected.length}`,
          first: {
            text: "first phrase",
            audioChunks: [Buffer.from("first-audio")],
            audioByteLength: Buffer.byteLength("first-audio")
          },
          followup: {
            text: "followup phrase",
            audioChunks: [Buffer.from("followup-audio")],
            audioByteLength: Buffer.byteLength("followup-audio")
          },
          timing: { voice_pipeline_total_ms: 84 },
          providerMeta: { transport: "segmented" }
        };
      }
    })
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/deep-response/http-turn-v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Deep-Response-Client": "http-turn-v2-test",
        "X-Deep-Response-Session": "segmented-session"
      },
      body: Buffer.from("watch-turn-audio")
    });
    assert.equal(response.ok, true);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.sessionID, "segmented-session");
    assert.equal(body.transcript, "chunks:1");
    assert.equal(body.segments.length, 2);
    assert.equal(body.segments[0].kind, "first");
    assert.equal(body.segments[0].text, "first phrase");
    assert.equal(Buffer.from(body.segments[0].audioBase64, "base64").toString("utf8"), "first-audio");
    assert.equal(body.segments[1].kind, "followup");
    assert.equal(body.segments[1].text, "followup phrase");
    assert.equal(Buffer.from(body.segments[1].audioBase64, "base64").toString("utf8"), "followup-audio");
    assert.equal(body.audioByteLength, 25);
    assert.equal(body.sampleRate, 24000);

    await waitFor(async () => {
      const debug = await fetchJSON(`http://127.0.0.1:${server.port}/debug/events`);
      return debug.events.some((event) => event.type === "http_turn_v2_complete"
        && event.audioByteLength === 25
        && event.transcript === "chunks:1"
        && event.firstText === "first phrase"
        && event.followupText === "followup phrase");
    });
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session accepts audio chunks and exposes event and audio cursors", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async runSegmented({ audioChunks }) {
        const collected = [];
        for await (const chunk of audioChunks) {
          collected.push(Buffer.from(chunk).toString("utf8"));
        }
        return {
          transcript: collected.join("+"),
          first: {
            text: "first streamed phrase",
            audioChunks: [Buffer.from("first-session-audio")],
            audioByteLength: Buffer.byteLength("first-session-audio")
          },
          followup: {
            text: "followup streamed phrase",
            audioChunks: [Buffer.from("followup-session-audio")],
            audioByteLength: Buffer.byteLength("followup-session-audio")
          },
          timing: { voice_pipeline_total_ms: 64 },
          providerMeta: { transport: "http-session" }
        };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {
      sampleRate: 16000
    });
    assert.equal(created.ok, true);
    assert.equal(created.state, "listening");
    assert.match(created.sessionID, /^drs_/);

    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    const uploadedA = await postBytes(`${base}/audio?turn_id=turn-1&seq=0`, Buffer.from("chunk-a"));
    const uploadedB = await postBytes(`${base}/audio?turn_id=turn-1&seq=1`, Buffer.from("chunk-b"));
    assert.deepEqual([uploadedA.bytes, uploadedB.bytes], [7, 7]);

    const stopped = await postJSON(`${base}/input-stop`, { turnID: "turn-1" });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.turnID, "turn-1");
    assert.match(stopped.generationID, /^gen_/);

    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "transcript_final")
        && events.events.some((event) => event.type === "assistant_text_delta")
        && events.events.some((event) => event.type === "audio_done")
        && events.events.some((event) => event.type === "timing");
    });

    const events = await fetchJSON(`${base}/events?cursor=0`);
    assert(events.nextCursor > 0);
    assert(events.events.some((event) => event.type === "session_ready"));
    assert(events.events.some((event) => event.type === "transcript_final" && event.text === "chunk-achunk-b"));
    assert(events.events.some((event) => event.type === "assistant_text_delta" && event.delta === "first streamed phrase"));
    assert(events.events.some((event) => event.type === "assistant_text_delta" && event.delta === "followup streamed phrase"));
    assert(events.events.some((event) => event.type === "timing" && event.timing.voice_pipeline_total_ms === 64));

    const audio = await fetchJSON(`${base}/audio?cursor=0`);
    assert.equal(audio.ok, true);
    assert.equal(audio.chunks.length, 2);
    assert.deepEqual(audio.chunks.map((chunk) => Buffer.from(chunk.audioBase64, "base64").toString("utf8")), [
      "first-session-audio",
      "followup-session-audio"
    ]);

    await waitFor(async () => {
      const debug = await fetchJSON(`http://127.0.0.1:${server.port}/debug/events`);
      return debug.events.some((event) => event.type === "http_session_created" && event.sessionID === created.sessionID)
        && debug.events.some((event) => event.type === "http_session_audio" && event.sessionID === created.sessionID && event.seq === 1)
        && debug.events.some((event) => event.type === "http_session_complete" && event.sessionID === created.sessionID);
    });
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session exposes first segment before followup finishes", async () => {
  let releaseFollowup;
  const followupGate = new Promise((resolve) => {
    releaseFollowup = resolve;
  });
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async *streamSegmented() {
        yield { type: "transcript_final", transcript: "progressive transcript" };
        yield {
          type: "segment",
          segment: "first",
          text: "first now",
          audioChunks: [Buffer.from("first-now-audio")]
        };
        await followupGate;
        yield {
          type: "segment",
          segment: "followup",
          text: "followup later",
          audioChunks: [Buffer.from("followup-later-audio")]
        };
        yield {
          type: "timing",
          timing: { voice_pipeline_total_ms: 123 },
          providerMeta: { transport: "stream-segmented" }
        };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    await postBytes(`${base}/audio?turn_id=turn-progressive&seq=0`, Buffer.from("voice"));
    await postJSON(`${base}/input-stop`, { turnID: "turn-progressive" });

    await waitFor(async () => {
      const audio = await fetchJSON(`${base}/audio?cursor=0`);
      return audio.chunks.some((chunk) => chunk.segment === "first");
    });

    const earlyEvents = await fetchJSON(`${base}/events?cursor=0`);
    const earlyAudio = await fetchJSON(`${base}/audio?cursor=0`);
    assert(earlyEvents.events.some((event) => event.type === "transcript_final" && event.text === "progressive transcript"));
    assert(earlyEvents.events.some((event) => event.type === "assistant_text_delta" && event.segment === "first" && event.delta === "first now"));
    assert(earlyEvents.events.every((event) => event.type !== "timing"));
    assert.deepEqual(earlyAudio.chunks.map((chunk) => Buffer.from(chunk.audioBase64, "base64").toString("utf8")), [
      "first-now-audio"
    ]);

    releaseFollowup();
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "timing");
    });
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session streams cascade phrase and audio events", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async *streamCascadeTurn() {
        yield { type: "transcript_partial", transcript: "今天我很累" };
        yield { type: "transcript_final", transcript: "今天我很累。" };
        yield {
          type: "assistant_text_delta",
          turnID: "turn-cascade",
          generationID: "gen-cascade",
          delta: "我听见你真的很累。"
        };
        yield {
          type: "assistant_phrase",
          turnID: "turn-cascade",
          generationID: "gen-cascade",
          phraseIndex: 0,
          text: "我听见你真的很累。",
          reason: "punctuation"
        };
        yield {
          type: "audio_chunk",
          turnID: "turn-cascade",
          generationID: "gen-cascade",
          phraseIndex: 0,
          audioIndex: 0,
          audioChunk: Buffer.from("cascade-audio"),
          sampleRate: 24000
        };
        yield {
          type: "timing",
          timing: { transcript_final_ms: 100, llm_first_token_ms: 20, voice_pipeline_total_ms: 200 },
          providerMeta: { transport: "cascade" }
        };
        yield {
          type: "turn_done",
          transcript: "今天我很累。",
          assistantText: "我听见你真的很累。"
        };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {
      pipelineMode: "cascade"
    });
    assert.equal(created.pipelineMode, "cascade");
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    await postBytes(`${base}/audio?turn_id=turn-cascade&seq=0`, Buffer.from("voice"));
    await postJSON(`${base}/input-stop`, { turnID: "turn-cascade", generationID: "gen-cascade" });

    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "assistant_phrase")
        && events.events.some((event) => event.type === "timing");
    });

    const events = await fetchJSON(`${base}/events?cursor=0`);
    assert(events.events.some((event) => event.type === "transcript_partial" && event.text === "今天我很累"));
    assert(events.events.some((event) => event.type === "transcript_final" && event.text === "今天我很累。"));
    assert(events.events.some((event) => event.type === "assistant_text_delta" && event.delta === "我听见你真的很累。"));
    assert(events.events.some((event) => event.type === "assistant_phrase"
      && event.text === "我听见你真的很累。"
      && event.phraseIndex === 0));
    assert(events.events.some((event) => event.type === "timing"
      && event.providerMeta.transport === "cascade"
      && event.timing.voice_pipeline_total_ms === 200));

    const audio = await fetchJSON(`${base}/audio?cursor=0&generation_id=gen-cascade`);
    assert.equal(audio.chunks.length, 1);
    assert.equal(audio.chunks[0].segment, "reply");
    assert.equal(Buffer.from(audio.chunks[0].audioBase64, "base64").toString("utf8"), "cascade-audio");
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session starts provider audio consumption before input stop", async () => {
  let firstChunkSeenAt = 0;
  let inputStopPostedAt = 0;
  let firstChunkSeenBeforeStop = false;
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async *streamSegmented({ audioChunks }) {
        for await (const chunk of audioChunks) {
          if (!firstChunkSeenAt) {
            firstChunkSeenAt = Date.now();
            firstChunkSeenBeforeStop = inputStopPostedAt === 0;
          }
          assert(chunk.byteLength > 0);
        }
        yield { type: "transcript_final", transcript: "live transcript" };
        yield { type: "segment", segment: "first", text: "ok", audioChunks: [Buffer.from("audio")] };
        yield { type: "timing", timing: {}, providerMeta: {} };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    await postBytes(`${base}/audio?turn_id=turn-live&seq=0`, Buffer.alloc(3_200, 1));
    await waitFor(() => firstChunkSeenAt > 0);
    inputStopPostedAt = Date.now();
    await postJSON(`${base}/input-stop`, { turnID: "turn-live" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "timing");
    });

    assert(firstChunkSeenAt > 0);
    assert(firstChunkSeenBeforeStop);
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session rechunks large upload bodies before provider ASR", async () => {
  const seenChunkSizes = [];
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async *streamSegmented({ audioChunks }) {
        for await (const chunk of audioChunks) {
          seenChunkSizes.push(chunk.byteLength);
        }
        yield { type: "transcript_final", transcript: `chunks:${seenChunkSizes.length}` };
        yield {
          type: "segment",
          segment: "first",
          text: "ok",
          audioChunks: [Buffer.from("audio")]
        };
        yield { type: "timing", timing: {}, providerMeta: {} };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    await postBytes(`${base}/audio?turn_id=turn-large&seq=0`, Buffer.alloc(8_000, 1));
    await postBytes(`${base}/audio?turn_id=turn-large&seq=1`, Buffer.alloc(1_200, 2));
    await postJSON(`${base}/input-stop`, { turnID: "turn-large" });

    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "timing");
    });

    assert.deepEqual(seenChunkSizes, [3_200, 3_200, 2_800]);
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session accepts deflated audio upload bodies", async () => {
  const seenChunkSizes = [];
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async *streamSegmented({ audioChunks }) {
        for await (const chunk of audioChunks) {
          seenChunkSizes.push(chunk.byteLength);
        }
        yield { type: "transcript_final", transcript: "ok" };
        yield { type: "segment", segment: "first", text: "ok", audioChunks: [Buffer.from("audio")] };
        yield { type: "timing", timing: {}, providerMeta: {} };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    const pcm = Buffer.alloc(6_400, 1);
    const response = await fetch(`${base}/audio?turn_id=turn-deflate&seq=0`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Encoding": "deflate"
      },
      body: deflateSync(pcm)
    });
    assert.equal(response.ok, true);
    const uploaded = await response.json();
    assert.equal(uploaded.bytes, pcm.byteLength);
    assert(uploaded.encodedBytes < uploaded.bytes);

    await postJSON(`${base}/input-stop`, { turnID: "turn-deflate" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "timing");
    });
    assert.deepEqual(seenChunkSizes, [3_200, 3_200]);
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session accepts turn metadata from Watch upload headers", async () => {
  const seenTurns = [];
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async *streamSegmented({ audioChunks }) {
        const collected = [];
        for await (const chunk of audioChunks) {
          collected.push(Buffer.from(chunk).toString("utf8"));
        }
        seenTurns.push(collected.join(""));
        yield { type: "transcript_final", transcript: collected.join("") };
        yield { type: "segment", segment: "first", text: "ok", audioChunks: [Buffer.from("audio")] };
        yield { type: "timing", timing: {}, providerMeta: {} };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    const response = await fetch(`${base}/audio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Deep-Response-Turn": "turn-header",
        "X-Deep-Response-Seq": "7"
      },
      body: Buffer.from("header-audio")
    });
    assert.equal(response.ok, true);
    const uploaded = await response.json();
    assert.equal(uploaded.turnID, "turn-header");
    assert.equal(uploaded.seq, 7);

    await postJSON(`${base}/input-stop`, { turnID: "turn-header" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "timing");
    });
    assert.deepEqual(seenTurns, ["header-audio"]);
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session abort drops stale generation audio", async () => {
  let releasePipeline;
  const pipelineStarted = new Promise((resolve) => {
    releasePipeline = resolve;
  });
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async runSegmented() {
        await pipelineStarted;
        return {
          transcript: "stale transcript",
          first: {
            text: "stale phrase",
            audioChunks: [Buffer.from("stale-audio")],
            audioByteLength: Buffer.byteLength("stale-audio")
          },
          followup: { text: "", audioChunks: [], audioByteLength: 0 },
          timing: { voice_pipeline_total_ms: 99 },
          providerMeta: {}
        };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    await postBytes(`${base}/audio?turn_id=turn-stale&seq=0`, Buffer.from("chunk"));
    const stopped = await postJSON(`${base}/input-stop`, { turnID: "turn-stale" });
    const aborted = await postJSON(`${base}/abort`, {
      turnID: "turn-stale",
      generationID: stopped.generationID,
      reason: "barge_in"
    });
    assert.equal(aborted.ok, true);
    assert.equal(aborted.staleAudioDropped, true);

    releasePipeline();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const audio = await fetchJSON(`${base}/audio?cursor=0`);
    assert.equal(audio.chunks.length, 0);
    const events = await fetchJSON(`${base}/events?cursor=0`);
    assert(events.events.some((event) => event.type === "abort" && event.generationID === stopped.generationID));
    assert(events.events.every((event) => event.type !== "assistant_text_delta"));
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session supports multiple turns and explicit end", async () => {
  const seenTurns = [];
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async runSegmented({ audioChunks }) {
        const collected = [];
        for await (const chunk of audioChunks) {
          collected.push(Buffer.from(chunk).toString("utf8"));
        }
        seenTurns.push(collected.join(""));
        return {
          transcript: collected.join(""),
          first: {
            text: `reply ${seenTurns.length}`,
            audioChunks: [Buffer.from(`audio-${seenTurns.length}`)],
            audioByteLength: Buffer.byteLength(`audio-${seenTurns.length}`)
          },
          followup: { text: "", audioChunks: [], audioByteLength: 0 },
          timing: { voice_pipeline_total_ms: seenTurns.length },
          providerMeta: {}
        };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;

    await postBytes(`${base}/audio?turn_id=turn-1&seq=0`, Buffer.from("one"));
    await postJSON(`${base}/input-stop`, { turnID: "turn-1" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "assistant_text_delta" && event.delta === "reply 1");
    });

    await postBytes(`${base}/audio?turn_id=turn-2&seq=0`, Buffer.from("two"));
    await postJSON(`${base}/input-stop`, { turnID: "turn-2" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "assistant_text_delta" && event.delta === "reply 2");
    });

    const ended = await postJSON(`${base}/end`, { reason: "user_goodbye" });
    assert.equal(ended.ok, true);
    assert.equal(ended.state, "ended");

    const events = await fetchJSON(`${base}/events?cursor=0`);
    assert.deepEqual(seenTurns, ["one", "two"]);
    assert(events.events.some((event) => event.type === "session_end" && event.reason === "user_goodbye"));
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session passes prior turns as LLM context", async () => {
  const seenContexts = [];
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async *streamSegmented({ audioChunks, context }) {
        const collected = [];
        for await (const chunk of audioChunks) {
          collected.push(Buffer.from(chunk).toString("utf8"));
        }
        seenContexts.push(context);
        const turnIndex = seenContexts.length;
        yield { type: "transcript_final", transcript: `you-${turnIndex}:${collected.join("")}` };
        yield {
          type: "segment",
          segment: "first",
          text: `god-${turnIndex}`,
          audioChunks: [Buffer.from(`audio-${turnIndex}`)]
        };
        yield { type: "timing", timing: {}, providerMeta: {} };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;

    await postBytes(`${base}/audio?turn_id=turn-memory-1&seq=0`, Buffer.from("one"));
    await postJSON(`${base}/input-stop`, { turnID: "turn-memory-1" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "assistant_text_delta" && event.delta === "god-1");
    });

    await postBytes(`${base}/audio?turn_id=turn-memory-2&seq=0`, Buffer.from("two"));
    await postJSON(`${base}/input-stop`, { turnID: "turn-memory-2" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "assistant_text_delta" && event.delta === "god-2");
    });

    assert.deepEqual(seenContexts[0], []);
    assert.deepEqual(seenContexts[1], [
      { role: "user", content: "you-1:one" },
      { role: "assistant", content: "god-1" }
    ]);
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

async function postJSON(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  assert.equal(response.ok, true);
  return response.json();
}

async function postBytes(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body
  });
  assert.equal(response.ok, true);
  return response.json();
}
