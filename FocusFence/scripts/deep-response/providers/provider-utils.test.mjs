import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import { buildDoubaoASREndRequest, buildDoubaoASRInitRequest } from "./doubao-asr.mjs";
import { ArkLLMProvider, extractArkStreamDelta, findSpeakableFirstPhrase, splitFirstPhrase } from "./ark-llm.mjs";
import {
  DoubaoTTSProvider,
  buildDoubaoTTSEventRequest,
  parseDoubaoTTSResponse,
  TTS_EVENTS
} from "./doubao-tts.mjs";

test("buildDoubaoASRInitRequest emits gzip volc binary init request", () => {
  const request = buildDoubaoASRInitRequest({
    appID: "app",
    accessToken: "token",
    reqID: "req-1",
    connectID: "conn-1",
    modelName: "bigmodel",
    endWindowSizeMs: 800,
    sampleRate: 16000
  });

  assert.equal(request[0], 0x11);
  assert.equal(request[1] >> 4, 0x01);
  const payloadLength = request.readUInt32BE(4);
  const payload = zlib.gunzipSync(request.subarray(8, 8 + payloadLength));
  const json = JSON.parse(payload.toString("utf8"));

  assert.equal(json.app.appid, "app");
  assert.equal(json.request.reqid, "req-1");
  assert.equal(json.request.model_name, "bigmodel");
  assert.equal(json.audio.rate, 16000);
});

test("buildDoubaoASREndRequest sends gzip-compressed empty audio payload", () => {
  const request = buildDoubaoASREndRequest();

  assert.equal(request[1] & 0x0f, 0x02);
  const payloadLength = request.readUInt32BE(4);
  assert.deepEqual(zlib.gunzipSync(request.subarray(8, 8 + payloadLength)), Buffer.alloc(0));
});

test("extractArkStreamDelta reads OpenAI-compatible streaming deltas", () => {
  const line = `data: ${JSON.stringify({ choices: [{ delta: { content: "我听见" } }] })}`;

  assert.equal(extractArkStreamDelta(line), "我听见");
  assert.equal(extractArkStreamDelta("data: [DONE]"), null);
});

test("splitFirstPhrase returns the first short spoken phrase", () => {
  assert.equal(splitFirstPhrase("Mike，我听见你真的很累。我们先停一下。"), "Mike，我听见你真的很累。");
  assert.equal(splitFirstPhrase("我们先不要急着解释这一切"), "我们先不要急着解释这一切");
});

test("findSpeakableFirstPhrase waits until a partial stream is long enough to play", () => {
  assert.equal(findSpeakableFirstPhrase("我"), "");
  assert.equal(findSpeakableFirstPhrase("我听见你真的很累"), "我听见你真的很累");
  assert.equal(findSpeakableFirstPhrase("我听见你。后面继续"), "我听见你。");
});

test("ArkLLMProvider stops reading stream once first phrase is speakable", async (t) => {
  const originalFetch = globalThis.fetch;
  let chunksRead = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => ({
    ok: true,
    body: (async function* stream() {
      const chunks = [
        "data: {\"choices\":[{\"delta\":{\"content\":\"我懂\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"这种沉甸甸的\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"。后面不该等完\"}}]}\n\n"
      ];
      for (const chunk of chunks) {
        chunksRead += 1;
        yield Buffer.from(chunk);
      }
    })()
  });

  const provider = new ArkLLMProvider({
    env: {
      ARK_BASE_URL: "https://ark.example",
      ARK_API_KEY: "key",
      ARK_MODEL: "model"
    },
    clock: fakeClock([0, 10, 20])
  });

  const result = await provider.generate({ transcript: "我很累" });

  assert.equal(result.firstPhrase, "我懂这种沉甸甸的。");
  assert.equal(result.text, "我懂这种沉甸甸的。");
  assert.equal(chunksRead, 3);
});

test("ArkLLMProvider reads full stream when streamFull is true", async (t) => {
  const originalFetch = globalThis.fetch;
  let chunksRead = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => ({
    ok: true,
    body: (async function* stream() {
      const chunks = [
        "data: {\"choices\":[{\"delta\":{\"content\":\"第一句。\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"第二句。\"}}]}\n\n",
        "data: [DONE]\n\n"
      ];
      for (const chunk of chunks) {
        chunksRead += 1;
        yield Buffer.from(chunk);
      }
    })()
  });

  const provider = new ArkLLMProvider({
    env: {
      ARK_BASE_URL: "https://ark.example",
      ARK_API_KEY: "key",
      ARK_MODEL: "model"
    },
    clock: fakeClock([0, 10, 20])
  });

  const result = await provider.generate({ transcript: "继续", streamFull: true });

  assert.equal(result.firstPhrase, "第一句。");
  assert.equal(result.text, "第一句。第二句。");
  assert.equal(chunksRead, 3);
});

test("ArkLLMProvider streamTokens yields deltas and final timing", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      body: (async function* stream() {
        yield Buffer.from("data: {\"choices\":[{\"delta\":{\"content\":\"我听见\"}}]}\n\n");
        yield Buffer.from("data: {\"choices\":[{\"delta\":{\"content\":\"你真的很累。\"}}]}\n\n");
        yield Buffer.from("data: [DONE]\n\n");
      })()
    };
  };

  const provider = new ArkLLMProvider({
    env: {
      ARK_BASE_URL: "https://ark.example",
      ARK_API_KEY: "key",
      ARK_MODEL: "model"
    },
    clock: fakeClock([0, 10, 20, 30])
  });

  const events = [];
  for await (const event of provider.streamTokens({
    transcript: "我很累",
    maxTokens: 24,
    temperature: 0.2
  })) {
    events.push(event);
  }

  assert.equal(requestBody.stream, true);
  assert.equal(requestBody.max_tokens, 24);
  assert.equal(requestBody.temperature, 0.2);
  assert.deepEqual(events, [
    { type: "delta", delta: "我听见", elapsedMs: 20 },
    { type: "delta", delta: "你真的很累。", elapsedMs: 30 },
    {
      type: "done",
      text: "我听见你真的很累。",
      timing: {
        llm_request_start_ms: 0,
        llm_first_token_ms: 10,
        llm_total_ms: 30
      },
      streamChunkCount: 2
    }
  ]);
});

test("ArkLLMProvider sends requested max tokens", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      body: (async function* stream() {
        yield Buffer.from("data: {\"choices\":[{\"delta\":{\"content\":\"收到。\"}}]}\n\n");
      })()
    };
  };

  const provider = new ArkLLMProvider({
    env: {
      ARK_BASE_URL: "https://ark.example",
      ARK_API_KEY: "key",
      ARK_MODEL: "model"
    }
  });

  await provider.generate({ transcript: "继续", maxTokens: 48 });

  assert.equal(requestBody.max_tokens, 48);
});

test("ArkLLMProvider sends custom messages and generation options", async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody = null;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      body: (async function* stream() {
        yield Buffer.from("data: {\"choices\":[{\"delta\":{\"content\":\"我听见你今天真的很累。\"}}]}\n\n");
      })()
    };
  };

  const provider = new ArkLLMProvider({
    env: {
      ARK_BASE_URL: "https://ark.example",
      ARK_API_KEY: "key",
      ARK_MODEL: "default-model"
    }
  });
  const messages = [
    { role: "system", content: "custom system" },
    { role: "user", content: "custom user" }
  ];

  const result = await provider.generate({
    transcript: "ignored when messages are provided",
    messages,
    model: "custom-model",
    temperature: 0.1,
    maxTokens: 32,
    firstPhraseExtractor: (text) => (text.includes("。") ? text : "")
  });

  assert.deepEqual(requestBody.messages, messages);
  assert.equal(requestBody.model, "custom-model");
  assert.equal(requestBody.temperature, 0.1);
  assert.equal(requestBody.max_tokens, 32);
  assert.equal(result.firstPhrase, "我听见你今天真的很累。");
});

test("buildDoubaoTTSEventRequest emits binary event frame with session id and JSON payload", () => {
  const frame = buildDoubaoTTSEventRequest({
    event: TTS_EVENTS.StartSession,
    sessionID: "session-1",
    payload: { namespace: "BidirectionalTTS" }
  });

  assert.equal(frame[0], 0x11);
  assert.equal(frame[1], 0x14);
  assert.equal(frame[2], 0x10);
  assert.equal(frame.readInt32BE(4), TTS_EVENTS.StartSession);
  assert.equal(frame.readInt32BE(8), "session-1".length);
  assert.equal(frame.subarray(12, 21).toString("utf8"), "session-1");
  const payloadLength = frame.readInt32BE(21);
  const payload = JSON.parse(frame.subarray(25, 25 + payloadLength).toString("utf8"));
  assert.equal(payload.namespace, "BidirectionalTTS");
});

test("parseDoubaoTTSResponse extracts audio payload event", () => {
  const sessionID = Buffer.from("session-1");
  const audio = Buffer.from([1, 2, 3]);
  const frame = Buffer.concat([
    Buffer.from([0x11, 0xb4, 0x00, 0x00]),
    int32(TTS_EVENTS.TTSResponse),
    int32(sessionID.byteLength),
    sessionID,
    int32(audio.byteLength),
    audio
  ]);

  const parsed = parseDoubaoTTSResponse(frame);

  assert.equal(parsed.event, TTS_EVENTS.TTSResponse);
  assert.equal(parsed.messageType, 0x0b);
  assert.equal(parsed.sessionID, "session-1");
  assert.deepEqual(parsed.payload, audio);
});

test("DoubaoTTSProvider falls back to HTTP when websocket stream fails", async () => {
  const provider = new DoubaoTTSProvider({
    env: {
      DEEP_RESPONSE_TTS_HTTP_FALLBACK: "1",
      DOUBAO_TTS_SAMPLE_RATE: "24000"
    }
  });
  provider.synthesizeWebSocketStream = async function* () {
    throw new Error("doubao_tts_error 45000081: Timeout waiting next packet");
  };
  provider.synthesizeHTTP = async ({ text }) => ({
    audioChunks: [Buffer.from(`fallback:${text}`)],
    timing: { tts_first_audio_ms: 12 },
    connectID: "http-fallback",
    mode: "http_fallback"
  });

  const events = [];
  for await (const event of provider.synthesizeStream({ text: "主与你同在。" })) {
    events.push(event);
  }

  assert.equal(events[0].type, "audio_chunk");
  assert.equal(events[0].audioChunk.toString("utf8"), "fallback:主与你同在。");
  assert.equal(events[0].sampleRate, 24000);
  assert.equal(events[1].type, "done");
  assert.equal(events[1].mode, "http_fallback");
});

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

function fakeClock(values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}
