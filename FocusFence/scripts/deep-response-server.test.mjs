import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

import { startDeepResponseServer } from "./deep-response-server.mjs";
import { VoicePipeline } from "./deep-response/pipeline/voice-pipeline.mjs";

test("DeepResponse server exposes recent debug events for lab diagnosis", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "echo",
    log: false
  });

  try {
    const health = await fetchJSON(`http://127.0.0.1:${server.port}/health`);
    assert.equal(health.ok, true);
    const probe = await fetch(`http://127.0.0.1:${server.port}/debug/http-probe`, {
      method: "POST",
      headers: {
        "x-deep-response-client": "debug-test",
        "content-type": "application/octet-stream"
      },
      body: Buffer.from("probe")
    });
    assert.equal(probe.status, 200);

    await waitFor(async () => {
      const debug = await fetchJSON(`http://127.0.0.1:${server.port}/debug/events`);
      return debug.events.some((event) => event.type === "health")
        && debug.events.some((event) => event.type === "http_probe" && event.deepResponseClient === "debug-test");
    });
  } finally {
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
      ARK_FALLBACK_MODEL: "",
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
    assert.equal(config.arkFallbackModel, "");
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
        && events.events.some((event) => event.type === "timing")
        && events.events.some((event) => event.type === "turn_done");
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
    assert(events.events.some((event) => event.type === "turn_done"
      && event.generationID === "gen-cascade"
      && event.transcript === "今天我很累。"
      && event.assistantText === "我听见你真的很累。"));

    const audio = await fetchJSON(`${base}/audio?cursor=0&generation_id=gen-cascade`);
    assert.equal(audio.chunks.length, 1);
    assert.equal(audio.chunks[0].segment, "reply");
    assert.equal(Buffer.from(audio.chunks[0].audioBase64, "base64").toString("utf8"), "cascade-audio");
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session cascade exposes only spoken text when reply is truncated", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      streamCascadeTurn({ turnID, generationID }) {
        const pipeline = new VoicePipeline({
          asr: {
            async *transcribeStream() {
              yield { type: "transcript_final", transcript: "我今天很累。" };
            }
          },
          llm: {
            async *streamTokens() {
              yield { type: "delta", delta: "我听见你今天很累。" };
              yield { type: "delta", delta: "我们先安静一下。" };
              yield { type: "delta", delta: "接下来我还想继续讲很多很多内容。" };
              yield { type: "done", timing: {} };
            }
          },
          tts: {
            async *synthesizeStream({ text }) {
              yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
              yield { type: "done", timing: {} };
            }
          }
        });
        return pipeline.streamCascadeTurn({
          audioChunks: [Buffer.from("voice")],
          turnID,
          generationID,
          maxSpokenReplyChars: 18
        });
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {
      pipelineMode: "cascade"
    });
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    await postBytes(`${base}/audio?turn_id=turn-short-session&seq=0`, Buffer.from("voice"));
    await postJSON(`${base}/input-stop`, {
      turnID: "turn-short-session",
      generationID: "gen-short-session"
    });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "timing");
    });

    const events = await fetchJSON(`${base}/events?cursor=0`);
    const deltas = events.events
      .filter((event) => event.type === "assistant_text_delta")
      .map((event) => event.delta);
    assert.deepEqual(deltas, ["我听见你今天很累。", "我们先安静一下。"]);
    assert(!events.events.some((event) => /很多很多内容/u.test(event.text || event.delta || "")));
    const timing = events.events.find((event) => event.type === "timing");
    assert.equal(timing.timing.reply_truncated_for_length, 1);

    const audio = await fetchJSON(`${base}/audio?cursor=0&generation_id=gen-short-session`);
    assert.equal(audio.chunks.length, 2);
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session events endpoint long-polls until new events arrive", async () => {
  let releasePhrase;
  const phraseGate = new Promise((resolve) => {
    releasePhrase = resolve;
  });
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async *streamCascadeTurn() {
        await phraseGate;
        yield {
          type: "assistant_phrase",
          turnID: "turn-long-poll",
          generationID: "gen-long-poll",
          phraseIndex: 0,
          text: "我听见你。",
          reason: "punctuation"
        };
        yield { type: "timing", timing: { voice_pipeline_total_ms: 1 } };
        yield { type: "turn_done", transcript: "", assistantText: "我听见你。" };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {
      pipelineMode: "cascade"
    });
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    const initial = await fetchJSON(`${base}/events?cursor=0`);
    await postJSON(`${base}/input-stop`, { turnID: "turn-long-poll", generationID: "gen-long-poll" });
    const beforePhrase = await fetchJSON(`${base}/events?cursor=${initial.nextCursor}`);
    assert(!beforePhrase.events.some((event) => event.type === "assistant_phrase"));

    const startedAt = Date.now();
    const pendingEvents = fetchJSON(`${base}/events?cursor=${beforePhrase.nextCursor}&wait_ms=500`);
    await sleep(50);
    releasePhrase();
    const batch = await pendingEvents;

    assert(Date.now() - startedAt >= 40);
    assert(batch.events.some((event) => event.type === "assistant_phrase" && event.text === "我听见你。"));
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session audio endpoint long-polls until new audio arrives", async () => {
  let releaseAudio;
  const audioGate = new Promise((resolve) => {
    releaseAudio = resolve;
  });
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async *streamCascadeTurn() {
        await audioGate;
        yield {
          type: "audio_chunk",
          turnID: "turn-audio-long-poll",
          generationID: "gen-audio-long-poll",
          phraseIndex: 0,
          audioIndex: 0,
          audioChunk: Buffer.from("long-poll-audio"),
          sampleRate: 24000
        };
        yield { type: "timing", timing: { voice_pipeline_total_ms: 1 } };
        yield { type: "turn_done", transcript: "", assistantText: "" };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {
      pipelineMode: "cascade"
    });
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    await postJSON(`${base}/input-stop`, { turnID: "turn-audio-long-poll", generationID: "gen-audio-long-poll" });

    const startedAt = Date.now();
    const pendingAudio = fetchJSON(`${base}/audio?cursor=0&generation_id=gen-audio-long-poll&wait_ms=500`);
    await sleep(50);
    releaseAudio();
    const batch = await pendingAudio;

    assert(Date.now() - startedAt >= 40);
    assert.equal(batch.chunks.length, 1);
    assert.equal(Buffer.from(batch.chunks[0].audioBase64, "base64").toString("utf8"), "long-poll-audio");
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

test("DeepResponse HTTP session audio pull hides already-buffered audio after abort", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async *streamCascadeTurn() {
        yield {
          type: "audio_chunk",
          turnID: "turn-buffered-stale",
          generationID: "gen-buffered-stale",
          phraseIndex: 0,
          audioIndex: 0,
          audioChunk: Buffer.from("buffered-stale-audio"),
          sampleRate: 24000
        };
        yield { type: "timing", timing: {} };
        yield { type: "turn_done", transcript: "abort me", assistantText: "stale" };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {
      pipelineMode: "cascade"
    });
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    await postJSON(`${base}/input-stop`, {
      turnID: "turn-buffered-stale",
      generationID: "gen-buffered-stale"
    });
    await waitFor(async () => {
      const audio = await fetchJSON(`${base}/audio?cursor=0&generation_id=gen-buffered-stale`);
      return audio.chunks.length === 1;
    });

    const aborted = await postJSON(`${base}/abort`, {
      turnID: "turn-buffered-stale",
      generationID: "gen-buffered-stale",
      reason: "barge_in"
    });
    assert.equal(aborted.ok, true);

    const audioAfterAbort = await fetchJSON(`${base}/audio?cursor=0&generation_id=gen-buffered-stale`);
    assert.equal(audioAfterAbort.chunks.length, 0);
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

test("DeepResponse HTTP session ends automatically after goodbye intent", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    createPipeline: () => ({
      async *streamSegmented() {
        yield { type: "transcript_final", transcript: "好了，拜拜" };
        yield {
          type: "segment",
          segment: "first",
          text: "愿你平安，我们下次再聊。",
          audioChunks: [Buffer.from("goodbye-audio")]
        };
        yield { type: "timing", timing: {}, providerMeta: {} };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    await postBytes(`${base}/audio?turn_id=turn-goodbye&seq=0`, Buffer.from("bye"));
    await postJSON(`${base}/input-stop`, { turnID: "turn-goodbye" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "session_end" && event.reason === "user_goodbye_intent");
    });

    const rejected = await fetch(`${base}/audio?turn_id=turn-after-goodbye&seq=0`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.from("late")
    });
    assert.equal(rejected.status, 409);
    const body = await rejected.json();
    assert.equal(body.error, "session_ended");
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session emits idle timeout end without user-operated Watch input", async () => {
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {
      idleTimeoutMs: 20
    });
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "session_end" && event.reason === "idle_timeout");
    }, { timeoutMs: 1_000, intervalMs: 25 });

    const rejected = await fetch(`${base}/audio?turn_id=turn-after-idle&seq=0`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.from("late")
    });
    assert.equal(rejected.status, 409);
    const body = await rejected.json();
    assert.equal(body.error, "session_ended");
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session can speak a gentle idle goodbye before ending", async () => {
  const ttsTexts = [];
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    createPipeline: () => ({
      tts: {
        async *synthesizeStream({ text }) {
          ttsTexts.push(text);
          yield { type: "audio_chunk", audioChunk: Buffer.from(`${text}:audio`), sampleRate: 24000 };
          yield { type: "done", timing: { tts_first_audio_ms: 12 } };
        }
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {
      idleTimeoutMs: 20,
      idleGoodbye: true
    });
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "session_end" && event.reason === "idle_timeout");
    }, { timeoutMs: 1_000, intervalMs: 25 });

    const events = await fetchJSON(`${base}/events?cursor=0`);
    const assistantIndex = events.events.findIndex((event) => event.type === "assistant_text_delta" && /拜拜/u.test(event.delta || ""));
    const endIndex = events.events.findIndex((event) => event.type === "session_end" && event.reason === "idle_timeout");
    assert(assistantIndex >= 0);
    assert(endIndex > assistantIndex);
    assert(events.events.some((event) => event.type === "audio_done" && event.reason === "idle_goodbye_complete"));
    assert.deepEqual(ttsTexts, ["我先安静到这里，愿你平安。拜拜。"]);

    const audio = await fetchJSON(`${base}/audio?cursor=0`);
    assert.equal(audio.chunks.length, 1);
    assert.match(Buffer.from(audio.chunks[0].audioBase64, "base64").toString("utf8"), /拜拜/);

    const rejected = await fetch(`${base}/audio?turn_id=turn-after-idle-goodbye&seq=0`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.from("late")
    });
    assert.equal(rejected.status, 409);
    const body = await rejected.json();
    assert.equal(body.error, "session_ended");
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

test("DeepResponse HTTP session self-tests eight turns with rolling context and goodbye end", async () => {
  const seenContexts = [];
  const seenTurns = [];
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
        const turnAudio = collected.join("");
        seenTurns.push(turnAudio);
        seenContexts.push(context);
        const turnIndex = seenTurns.length;
        const transcript = turnIndex === 8 ? "好了，拜拜" : `you-${turnIndex}:${turnAudio}`;
        yield { type: "transcript_final", transcript };
        yield {
          type: "segment",
          segment: "first",
          text: turnIndex === 8 ? "愿你平安，我们下次再聊。" : `god-${turnIndex}`,
          audioChunks: [Buffer.from(`audio-${turnIndex}`)]
        };
        yield { type: "timing", timing: { voice_pipeline_total_ms: turnIndex }, providerMeta: {} };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;

    for (let turnIndex = 1; turnIndex <= 8; turnIndex += 1) {
      const turnID = `turn-eight-${turnIndex}`;
      await postBytes(`${base}/audio?turn_id=${turnID}&seq=0`, Buffer.from(`audio-in-${turnIndex}`));
      await postJSON(`${base}/input-stop`, { turnID });
      await waitFor(async () => {
        const events = await fetchJSON(`${base}/events?cursor=0`);
        return events.events.some((event) => event.type === "timing" && event.turnID === turnID);
      });
    }

    assert.equal(seenTurns.length, 8);
    assert.equal(seenContexts[0].length, 0);
    assert.equal(seenContexts[7].length, 12);
    assert.equal(seenContexts[7][0].content, "you-2:audio-in-2");
    assert.equal(seenContexts[7][11].content, "god-7");

    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "session_end" && event.reason === "user_goodbye_intent");
    });

    const rejected = await fetch(`${base}/audio?turn_id=turn-after-eight-goodbye&seq=0`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.from("late")
    });
    assert.equal(rejected.status, 409);
    const body = await rejected.json();
    assert.equal(body.error, "session_ended");
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session writes async memory candidate after session end", async () => {
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
        const text = collected.join("");
        yield { type: "transcript_final", transcript: `用户说${text}` };
        yield {
          type: "segment",
          segment: "first",
          text: `回应${text}`,
          audioChunks: [Buffer.from(`audio-${text}`)]
        };
        yield { type: "timing", timing: {}, providerMeta: {} };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;

    await postBytes(`${base}/audio?turn_id=turn-memory-candidate-1&seq=0`, Buffer.from("今天很累"));
    await postJSON(`${base}/input-stop`, { turnID: "turn-memory-candidate-1" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "timing" && event.turnID === "turn-memory-candidate-1");
    });

    await postBytes(`${base}/audio?turn_id=turn-memory-candidate-2&seq=0`, Buffer.from("想被安慰"));
    await postJSON(`${base}/input-stop`, { turnID: "turn-memory-candidate-2" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "timing" && event.turnID === "turn-memory-candidate-2");
    });

    await postJSON(`${base}/end`, { reason: "client_end" });
    const afterEnd = await fetchJSON(`${base}/events?cursor=0`);
    const sessionEndIndex = afterEnd.events.findIndex((event) => event.type === "session_end");
    assert(sessionEndIndex >= 0);

    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "memory_candidate");
    });
    const finalEvents = await fetchJSON(`${base}/events?cursor=0`);
    const memoryIndex = finalEvents.events.findIndex((event) => event.type === "memory_candidate");
    const memory = finalEvents.events[memoryIndex];
    assert(memoryIndex > sessionEndIndex);
    assert.equal(memory.sessionID, created.sessionID);
    assert.equal(memory.reason, "client_end");
    assert.equal(memory.turnCount, 2);
    assert.match(memory.summary, /用户说今天很累/);
    assert.match(memory.summary, /回应想被安慰/);
    assert.equal(memory.persisted, false);
  } finally {
    await server.close();
  }
});

test("DeepResponse HTTP session can persist memory candidate to JSONL", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deep-response-memory-"));
  const memoryPath = join(tempDir, "memory.jsonl");
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    env: {
      DEEP_RESPONSE_MEMORY_JSONL_PATH: memoryPath
    },
    createPipeline: () => ({
      async *streamSegmented({ audioChunks }) {
        const collected = [];
        for await (const chunk of audioChunks) {
          collected.push(Buffer.from(chunk).toString("utf8"));
        }
        const text = collected.join("");
        yield { type: "transcript_final", transcript: `用户说${text}` };
        yield {
          type: "segment",
          segment: "first",
          text: `回应${text}`,
          audioChunks: [Buffer.from(`audio-${text}`)]
        };
        yield { type: "timing", timing: {}, providerMeta: {} };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;

    await postBytes(`${base}/audio?turn_id=turn-memory-jsonl&seq=0`, Buffer.from("需要被记住"));
    await postJSON(`${base}/input-stop`, { turnID: "turn-memory-jsonl" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "timing" && event.turnID === "turn-memory-jsonl");
    });

    await postJSON(`${base}/end`, { reason: "memory_persist_probe" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "memory_candidate" && event.persisted === true);
    });

    const events = await fetchJSON(`${base}/events?cursor=0`);
    const memory = events.events.find((event) => event.type === "memory_candidate");
    assert.equal(memory.persisted, true);
    assert.equal(memory.store, "jsonl");
    assert.equal(memory.path, memoryPath);
    assert.match(memory.summary, /需要被记住/);

    const lines = readFileSync(memoryPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const persisted = JSON.parse(lines[0]);
    assert.equal(persisted.sessionID, created.sessionID);
    assert.equal(persisted.reason, "memory_persist_probe");
    assert.equal(persisted.persisted, true);
    assert.match(persisted.summary, /需要被记住/);
  } finally {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("DeepResponse HTTP session recalls recent persisted JSONL memory into new sessions", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deep-response-memory-recall-"));
  const memoryPath = join(tempDir, "memory.jsonl");
  writeFileSync(memoryPath, [
    JSON.stringify({
      sessionID: "old-session",
      reason: "client_end",
      summary: "User: 我以前说过我怕晚上一个人。\nAI: 我会记得你夜里容易害怕。",
      turnCount: 1,
      persisted: true,
      createdAt: "2026-06-04T00:00:00.000Z"
    }),
    JSON.stringify({
      sessionID: "recent-session",
      reason: "client_end",
      summary: "User: 我最近说过工作压力很大。\nAI: 我会记得你需要被温柔提醒慢下来。",
      turnCount: 1,
      persisted: true,
      createdAt: "2026-06-04T01:00:00.000Z"
    })
  ].join("\n") + "\n", "utf8");

  const seenContexts = [];
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    env: {
      DEEP_RESPONSE_MEMORY_JSONL_PATH: memoryPath,
      DEEP_RESPONSE_MEMORY_RECALL_LIMIT: "1"
    },
    createPipeline: () => ({
      async *streamSegmented({ audioChunks, context }) {
        for await (const _chunk of audioChunks) {
          // Drain upload stream before replying.
        }
        seenContexts.push(context);
        yield { type: "transcript_final", transcript: "今天还是有压力" };
        yield {
          type: "segment",
          segment: "first",
          text: "我记得你最近压力很大。",
          audioChunks: [Buffer.from("memory-recall-audio")]
        };
        yield { type: "timing", timing: {}, providerMeta: {} };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    assert.equal(created.memoryRecallCount, 1);
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;

    await postBytes(`${base}/audio?turn_id=turn-memory-recall&seq=0`, Buffer.from("pressure"));
    await postJSON(`${base}/input-stop`, { turnID: "turn-memory-recall" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "timing" && event.turnID === "turn-memory-recall");
    });

    assert.equal(seenContexts.length, 1);
    assert.equal(seenContexts[0].length, 1);
    assert.equal(seenContexts[0][0].role, "system");
    assert.match(seenContexts[0][0].content, /可参考的过往记忆/);
    assert.match(seenContexts[0][0].content, /工作压力很大/);
    assert.doesNotMatch(seenContexts[0][0].content, /怕晚上一个人/);

    await postJSON(`${base}/end`, { reason: "memory_recall_probe" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "memory_candidate");
    });
    const events = await fetchJSON(`${base}/events?cursor=0`);
    const memory = events.events.find((event) => event.type === "memory_candidate");
    assert.doesNotMatch(memory.summary, /可参考的过往记忆/);
  } finally {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("DeepResponse HTTP session deduplicates repeated persisted memory recall summaries", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "deep-response-memory-dedupe-"));
  const memoryPath = join(tempDir, "memory.jsonl");
  const repeatedSummary = "User: 我最近一直说工作压力很大。\nAI: 我会记得你需要慢一点。";
  writeFileSync(memoryPath, [
    JSON.stringify({
      sessionID: "session-1",
      summary: "User: 我以前提过夜里会害怕。\nAI: 我会记得夜里要温柔一点。",
      persisted: true,
      createdAt: "2026-06-04T00:00:00.000Z"
    }),
    JSON.stringify({
      sessionID: "session-2",
      summary: repeatedSummary,
      persisted: true,
      createdAt: "2026-06-04T01:00:00.000Z"
    }),
    JSON.stringify({
      sessionID: "session-3",
      summary: repeatedSummary,
      persisted: true,
      createdAt: "2026-06-04T02:00:00.000Z"
    })
  ].join("\n") + "\n", "utf8");

  const seenContexts = [];
  const server = await startDeepResponseServer({
    port: 0,
    host: "127.0.0.1",
    mode: "provider",
    log: false,
    audioReplayIntervalMs: 0,
    env: {
      DEEP_RESPONSE_MEMORY_JSONL_PATH: memoryPath,
      DEEP_RESPONSE_MEMORY_RECALL_LIMIT: "3"
    },
    createPipeline: () => ({
      async *streamSegmented({ audioChunks, context }) {
        for await (const _chunk of audioChunks) {
          // Drain upload stream before replying.
        }
        seenContexts.push(context);
        yield { type: "transcript_final", transcript: "今天压力又来了" };
        yield {
          type: "segment",
          segment: "first",
          text: "我记得这份压力。",
          audioChunks: [Buffer.from("memory-dedupe-audio")]
        };
        yield { type: "timing", timing: {}, providerMeta: {} };
      }
    })
  });

  try {
    const created = await postJSON(`http://127.0.0.1:${server.port}/deep-response/sessions`, {});
    assert.equal(created.memoryRecallCount, 2);
    const base = `http://127.0.0.1:${server.port}/deep-response/sessions/${created.sessionID}`;

    await postBytes(`${base}/audio?turn_id=turn-memory-dedupe&seq=0`, Buffer.from("pressure"));
    await postJSON(`${base}/input-stop`, { turnID: "turn-memory-dedupe" });
    await waitFor(async () => {
      const events = await fetchJSON(`${base}/events?cursor=0`);
      return events.events.some((event) => event.type === "timing" && event.turnID === "turn-memory-dedupe");
    });

    const contextText = seenContexts[0][0].content;
    assert.equal((contextText.match(/工作压力很大/g) || []).length, 1);
    assert.equal((contextText.match(/夜里会害怕/g) || []).length, 1);
  } finally {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
