import crypto from "node:crypto";

import { numberFromEnv } from "../lib/env.mjs";
import { RawWebSocketClient } from "../lib/raw-websocket-client.mjs";

const FULL_CLIENT_REQUEST = 0x01;
const FULL_SERVER_RESPONSE = 0x09;
const AUDIO_ONLY_RESPONSE = 0x0b;
const ERROR_INFORMATION = 0x0f;
const MSG_FLAG_WITH_EVENT = 0x04;
const JSON_SERIALIZATION = 0x01;
const NO_COMPRESSION = 0x00;

export const TTS_EVENTS = {
  StartSession: 100,
  FinishSession: 102,
  SessionStarted: 150,
  SessionFinished: 152,
  SessionFailed: 153,
  TaskRequest: 200,
  TTSSentenceStart: 350,
  TTSSentenceEnd: 351,
  TTSResponse: 352
};

export class DoubaoTTSProvider {
  constructor({ env, clock = performance.now.bind(performance), timeoutMs = 45_000 }) {
    this.env = env;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
  }

  async synthesize({ text, signal } = {}) {
    try {
      return await this.synthesizeWebSocket({ text, signal });
    } catch (error) {
      if (this.env.DEEP_RESPONSE_TTS_HTTP_FALLBACK !== "1") {
        throw error;
      }
      return await this.synthesizeHTTP({ text, signal });
    }
  }

  async synthesizeWebSocket({ text, signal } = {}) {
    const audioChunks = [];
    let done = { timing: {}, connectID: "" };
    for await (const event of this.synthesizeWebSocketStream({ text, signal })) {
      if (event.type === "audio_chunk") {
        audioChunks.push(event.audioChunk);
      } else if (event.type === "done") {
        done = event;
      }
    }
    return {
      audioChunks,
      timing: done.timing || {},
      connectID: done.connectID || "",
      mode: done.mode
    };
  }

  async *synthesizeStream({ text, signal } = {}) {
    try {
      yield* this.synthesizeWebSocketStream({ text, signal });
    } catch (error) {
      if (this.env.DEEP_RESPONSE_TTS_HTTP_FALLBACK !== "1") {
        throw error;
      }
      const fallback = await this.synthesizeHTTP({ text, signal });
      for (const chunk of fallback.audioChunks || []) {
        yield {
          type: "audio_chunk",
          audioChunk: Buffer.from(chunk),
          sampleRate: numberFromEnv(this.env, "DOUBAO_TTS_SAMPLE_RATE", 24000)
        };
      }
      yield {
        type: "done",
        timing: fallback.timing || {},
        connectID: fallback.connectID || "",
        mode: fallback.mode || "http_fallback",
        sampleRate: numberFromEnv(this.env, "DOUBAO_TTS_SAMPLE_RATE", 24000)
      };
    }
  }

  async *synthesizeWebSocketStream({ text, signal } = {}) {
    const startedAt = this.clock();
    const timing = {};
    const connectID = crypto.randomUUID();
    const sessionID = crypto.randomUUID().replaceAll("-", "");
    const client = await RawWebSocketClient.connect(this.env.DOUBAO_TTS_WS_URL, {
      "X-Api-App-Key": this.env.DOUBAO_SPEECH_APP_ID,
      "X-Api-Access-Key": this.env.DOUBAO_SPEECH_ACCESS_TOKEN,
      "X-Api-Resource-Id": this.env.DOUBAO_TTS_RESOURCE_ID,
      "X-Api-Connect-Id": connectID
    });
    timing.tts_connect_ms = elapsed(this.clock, startedAt);

    let audioChunkCount = 0;
    let finished = false;
    const queue = new AsyncEventQueue();
    const timeout = setTimeout(() => queue.throw(new Error("doubao_tts_timeout")), this.timeoutMs);
    const finish = () => {
      if (finished) {
        return;
      }
      finished = true;
      clearTimeout(timeout);
      queue.push({
        type: "done",
        timing,
        connectID,
        mode: "websocket",
        sampleRate: numberFromEnv(this.env, "DOUBAO_TTS_SAMPLE_RATE", 24000)
      });
      queue.end();
    };
    const fail = (error) => {
      clearTimeout(timeout);
      queue.throw(error);
    };

    try {
      client.onBinary = (payload) => {
        const parsed = parseDoubaoTTSResponse(payload);
        if (parsed.error) {
          fail(new Error(parsed.error));
          return;
        }
        if (parsed.event === TTS_EVENTS.TTSResponse && parsed.messageType === AUDIO_ONLY_RESPONSE && parsed.payload.byteLength > 0) {
          audioChunkCount += 1;
          timing.tts_first_audio_ms ??= elapsed(this.clock, startedAt);
          queue.push({
            type: "audio_chunk",
            audioChunk: Buffer.from(parsed.payload),
            sampleRate: numberFromEnv(this.env, "DOUBAO_TTS_SAMPLE_RATE", 24000)
          });
        } else if (parsed.event === TTS_EVENTS.SessionFinished) {
          finish();
        } else if (parsed.event === TTS_EVENTS.SessionFailed) {
          fail(new Error(`doubao_tts_session_failed ${parsed.payload.toString("utf8")}`));
        }
      };
      client.onText = (message) => fail(new Error(`doubao_tts_unexpected_text ${message}`));
      client.onClose = () => {
        if (audioChunkCount > 0) {
          finish();
        } else {
          fail(new Error("doubao_tts_closed_without_audio"));
        }
      };
      client.onError = (error) => fail(error);

      client.sendBinary(buildDoubaoTTSEventRequest({
        event: TTS_EVENTS.StartSession,
        sessionID,
        payload: buildDoubaoTTSPayload({
          env: this.env,
          event: TTS_EVENTS.StartSession,
          speaker: this.env.DOUBAO_TTS_SPEAKER_ID
        })
      }));
      client.sendBinary(buildDoubaoTTSEventRequest({
        event: TTS_EVENTS.TaskRequest,
        sessionID,
        payload: buildDoubaoTTSPayload({
          env: this.env,
          event: TTS_EVENTS.TaskRequest,
          text,
          speaker: this.env.DOUBAO_TTS_SPEAKER_ID
        })
      }));
      client.sendBinary(buildDoubaoTTSEventRequest({
        event: TTS_EVENTS.FinishSession,
        sessionID,
        payload: {}
      }));
      if (signal?.aborted) {
        throw new Error("deep_response_aborted");
      }

      yield* queue;
    } finally {
      clearTimeout(timeout);
      client.close();
    }
  }

  async synthesizeHTTP({ text, signal } = {}) {
    const startedAt = this.clock();
    const response = await fetch(this.env.DOUBAO_TTS_HTTP_URL, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer;${this.env.DOUBAO_SPEECH_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        app: {
          appid: this.env.DOUBAO_SPEECH_APP_ID,
          token: this.env.DOUBAO_SPEECH_ACCESS_TOKEN,
          cluster: "volcano_tts"
        },
        user: { uid: "focusfence-deep-response" },
        audio: {
          voice_type: this.env.DOUBAO_TTS_SPEAKER_ID,
          encoding: this.env.DOUBAO_TTS_AUDIO_FORMAT === "pcm" ? "wav" : "mp3",
          speed_ratio: 1.0,
          volume_ratio: 1.0,
          pitch_ratio: 1.0
        },
        request: {
          reqid: crypto.randomUUID(),
          text,
          operation: "query"
        }
      })
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`doubao_tts_http_failed ${response.status}: ${raw}`);
    }
    const data = JSON.parse(raw);
    if (data.code !== 3000 || !data.data) {
      throw new Error(`doubao_tts_http_bad_response ${data.code}: ${data.message || ""}`);
    }
    const audio = Buffer.from(data.data, "base64");
    return {
      audioChunks: [audio],
      timing: {
        tts_connect_ms: 0,
        tts_first_audio_ms: elapsed(this.clock, startedAt)
      },
      mode: "http_fallback"
    };
  }
}

export function buildDoubaoTTSRequest({ env, text, reqID = crypto.randomUUID() }) {
  return {
    namespace: "BidirectionalTTS",
    event: "submit",
    reqid: reqID,
    user: { uid: "focusfence-deep-response" },
    req_params: buildDoubaoTTSPayload({
      env,
      event: TTS_EVENTS.TaskRequest,
      text,
      speaker: env.DOUBAO_TTS_SPEAKER_ID
    }).req_params
  };
}

export function buildDoubaoTTSEventRequest({ event, sessionID, payload }) {
  const header = Buffer.from([
    0x11,
    (FULL_CLIENT_REQUEST << 4) | MSG_FLAG_WITH_EVENT,
    (JSON_SERIALIZATION << 4) | NO_COMPRESSION,
    0x00
  ]);
  const session = Buffer.from(sessionID || "", "utf8");
  const body = Buffer.from(JSON.stringify(payload || {}), "utf8");
  return Buffer.concat([header, int32(event), int32(session.byteLength), session, int32(body.byteLength), body]);
}

export function buildDoubaoTTSPayload({ env, event, text = "", speaker = "" }) {
  return {
    user: { uid: "focusfence-deep-response" },
    event,
    namespace: "BidirectionalTTS",
    req_params: {
      text,
      speaker,
      audio_params: {
        format: env.DOUBAO_TTS_AUDIO_FORMAT,
        sample_rate: numberFromEnv(env, "DOUBAO_TTS_SAMPLE_RATE", 24000),
        speech_rate: numberFromEnv(env, "DOUBAO_TTS_SPEECH_RATE", 0),
        loudness_rate: numberFromEnv(env, "DOUBAO_TTS_LOUDNESS_RATE", 0)
      },
      additions: JSON.stringify({
        post_process: { pitch: 0 }
      })
    }
  };
}

export function parseDoubaoTTSResponse(frame) {
  if (frame.byteLength < 4) {
    return { error: `doubao_tts_short_frame ${frame.byteLength}` };
  }
  const messageType = frame[1] >> 4;
  const flags = frame[1] & 0x0f;
  let offset = 4;
  const parsed = { messageType, flags, event: 0, sessionID: "", payload: Buffer.alloc(0) };

  if (messageType === ERROR_INFORMATION) {
    const code = frame.readInt32BE(offset);
    offset += 4;
    const payload = readSizedBuffer(frame, offset);
    return { ...parsed, event: ERROR_INFORMATION, error: `doubao_tts_error ${code}: ${payload.value.toString("utf8")}` };
  }

  if (messageType !== FULL_SERVER_RESPONSE && messageType !== AUDIO_ONLY_RESPONSE) {
    return parsed;
  }
  if (flags !== MSG_FLAG_WITH_EVENT) {
    return parsed;
  }

  parsed.event = frame.readInt32BE(offset);
  offset += 4;
  if (parsed.event === 0) {
    return parsed;
  }
  const session = readSizedBuffer(frame, offset);
  parsed.sessionID = session.value.toString("utf8");
  offset = session.offset;
  if (offset + 4 <= frame.byteLength) {
    const payload = readSizedBuffer(frame, offset);
    parsed.payload = payload.value;
  }
  return parsed;
}

function readSizedBuffer(buffer, offset) {
  const length = buffer.readInt32BE(offset);
  const start = offset + 4;
  const end = start + length;
  return { value: buffer.subarray(start, end), offset: end };
}

function int32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeInt32BE(value, 0);
  return buffer;
}

function elapsed(clock, startedAt) {
  return Math.round(clock() - startedAt);
}

class AsyncEventQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.done = false;
    this.error = null;
  }

  push(item) {
    if (this.done || this.error) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: item, done: false });
      return;
    }
    this.items.push(item);
  }

  end() {
    if (this.done) {
      return;
    }
    this.done = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter.resolve({ value: undefined, done: true });
    }
  }

  throw(error) {
    if (this.error) {
      return;
    }
    this.error = error;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error);
    }
  }

  [Symbol.asyncIterator]() {
    return this;
  }

  next() {
    if (this.items.length > 0) {
      return Promise.resolve({ value: this.items.shift(), done: false });
    }
    if (this.error) {
      return Promise.reject(this.error);
    }
    if (this.done) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}
