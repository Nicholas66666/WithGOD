import test from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

import { buildDoubaoASREndRequest, buildDoubaoASRInitRequest } from "./doubao-asr.mjs";
import { extractArkStreamDelta, findSpeakableFirstPhrase, splitFirstPhrase } from "./ark-llm.mjs";
import {
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

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}
