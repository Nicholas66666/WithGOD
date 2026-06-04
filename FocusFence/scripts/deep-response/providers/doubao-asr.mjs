import crypto from "node:crypto";
import zlib from "node:zlib";

import { numberFromEnv } from "../lib/env.mjs";
import { RawWebSocketClient } from "../lib/raw-websocket-client.mjs";

export class DoubaoASRProvider {
  constructor({ env, clock = performance.now.bind(performance), timeoutMs = 45_000 }) {
    this.env = env;
    this.clock = clock;
    this.timeoutMs = timeoutMs;
  }

  async transcribe(audioChunks, { signal } = {}) {
    let final = {
      transcript: "",
      timing: {},
      connectID: ""
    };
    for await (const event of this.transcribeStream(audioChunks, { signal })) {
      if (event.type === "transcript_final") {
        final = {
          transcript: event.transcript || "",
          timing: event.timing || {},
          connectID: event.connectID || ""
        };
      }
    }
    return final;
  }

  async *transcribeStream(audioChunks, { signal } = {}) {
    const startedAt = this.clock();
    const timing = {};
    const connectID = crypto.randomUUID();
    const client = await RawWebSocketClient.connect(this.env.DOUBAO_ASR_WS_URL, {
      "X-Api-App-Key": this.env.DOUBAO_SPEECH_APP_ID,
      "X-Api-Access-Key": this.env.DOUBAO_SPEECH_ACCESS_TOKEN,
      "X-Api-Resource-Id": this.env.DOUBAO_ASR_RESOURCE_ID,
      "X-Api-Connect-Id": connectID
    });
    timing.asr_ws_connect_ms = elapsed(this.clock, startedAt);

    let transcript = "";
    let firstDelta = false;
    let endSent = false;
    const queue = new AsyncEventQueue();
    const timeout = setTimeout(() => queue.throw(new Error("doubao_asr_timeout")), this.timeoutMs);
    const finish = () => {
      clearTimeout(timeout);
      queue.push({
        type: "transcript_final",
        transcript,
        timing: { ...timing },
        connectID
      });
      queue.end();
    };
    const fail = (error) => {
      clearTimeout(timeout);
      queue.throw(error);
    };

    try {
      client.onBinary = (payload) => {
        const parsed = parseVolcResponse(payload);
        if (parsed.error) {
          fail(new Error(parsed.error));
          return;
        }
        const text = extractTranscriptText(parsed.data);
        if (text && text !== transcript) {
          transcript = text;
          if (!firstDelta) {
            firstDelta = true;
            timing.first_transcript_delta_ms = elapsed(this.clock, startedAt);
          }
          queue.push({
            type: "transcript_delta",
            transcript,
            timing: { ...timing },
            connectID
          });
        }
        if (endSent && (parsed.isFinal || parsed.data?.result || parsed.data?.payload_msg?.result)) {
          timing.transcript_final_ms = elapsed(this.clock, startedAt);
          finish();
        }
      };
      client.onText = (text) => {
        try {
          const data = JSON.parse(text);
          const next = extractTranscriptText(data);
          if (next && next !== transcript) {
            transcript = next;
            if (!firstDelta) {
              firstDelta = true;
              timing.first_transcript_delta_ms = elapsed(this.clock, startedAt);
            }
            queue.push({
              type: "transcript_delta",
              transcript,
              timing: { ...timing },
              connectID
            });
          }
          if (endSent && (data.result || data.payload_msg?.result)) {
            timing.transcript_final_ms = elapsed(this.clock, startedAt);
            finish();
          }
        } catch {
          // Binary protocol is the expected path.
        }
      };
      client.onClose = ({ code, reason }) => {
        if (!timing.transcript_final_ms) {
          fail(new Error(`doubao_asr_closed ${code} ${reason}`.trim()));
        }
      };
      client.onError = (error) => fail(error);

      client.sendBinary(buildDoubaoASRInitRequest({
        appID: this.env.DOUBAO_SPEECH_APP_ID,
        accessToken: this.env.DOUBAO_SPEECH_ACCESS_TOKEN,
        reqID: crypto.randomUUID(),
        modelName: this.env.DOUBAO_ASR_MODEL_NAME,
        endWindowSizeMs: numberFromEnv(this.env, "DOUBAO_ASR_END_WINDOW_SIZE_MS", 800),
        sampleRate: numberFromEnv(this.env, "DOUBAO_ASR_SAMPLE_RATE", 16000)
      }));
      timing.asr_init_ms = elapsed(this.clock, startedAt);

      (async () => {
        try {
          for await (const chunk of toAsyncIterable(audioChunks)) {
            if (signal?.aborted) {
              throw new Error("deep_response_aborted");
            }
            client.sendBinary(buildDoubaoASRAudioRequest(chunk));
          }
          endSent = true;
          client.sendBinary(buildDoubaoASREndRequest());
        } catch (error) {
          fail(error);
        }
      })();

      yield* queue;
    } finally {
      clearTimeout(timeout);
      client.close();
    }
  }
}

export function buildDoubaoASRInitRequest({
  appID,
  accessToken,
  reqID = crypto.randomUUID(),
  modelName = "bigmodel",
  endWindowSizeMs = 800,
  sampleRate = 16000
}) {
  const payload = gzipJSON({
    app: {
      appid: appID,
      cluster: "volcengine_input_common",
      token: accessToken
    },
    user: { uid: "focusfence-deep-response" },
    request: {
      reqid: reqID,
      workflow: "audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate",
      show_utterances: true,
      result_type: "single",
      sequence: 1,
      model_name: modelName,
      end_window_size: Number(endWindowSizeMs)
    },
    audio: {
      format: "pcm",
      codec: "raw",
      rate: Number(sampleRate),
      bits: 16,
      channel: 1,
      sample_rate: Number(sampleRate)
    }
  });
  return buildVolcRequest(0x01, payload);
}

export function buildDoubaoASRAudioRequest(chunk) {
  const payload = zlib.gzipSync(Buffer.from(chunk));
  return buildVolcRequest(0x02, payload);
}

export function buildDoubaoASREndRequest() {
  return buildVolcRequest(0x02, zlib.gzipSync(Buffer.alloc(0)), 0x02);
}

function buildVolcRequest(messageType, payload, flags = 0) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.byteLength, 0);
  return Buffer.concat([volcHeader(messageType, flags), length, payload]);
}

function volcHeader(messageType, flags = 0, serialMethod = 1, compressionType = 1) {
  return Buffer.from([
    0x11,
    (messageType << 4) | flags,
    (serialMethod << 4) | compressionType,
    0x00
  ]);
}

function gzipJSON(data) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(data), "utf8"));
}

export function parseVolcResponse(payload) {
  if (payload.byteLength < 4) {
    return { error: `short_volc_response ${payload.byteLength}` };
  }
  const messageType = payload[1] >> 4;
  if (messageType === 0x0f) {
    const code = payload.byteLength >= 8 ? payload.readUInt32BE(4) : 0;
    const message = payload.byteLength >= 12 ? payload.subarray(12).toString("utf8") : "";
    return { error: `volc_server_error ${code}${message ? ` ${message}` : ""}` };
  }

  for (const offset of [4, 8, 12]) {
    if (payload.byteLength <= offset) {
      continue;
    }
    for (const candidate of decodeCandidates(payload.subarray(offset))) {
      try {
        return { data: JSON.parse(candidate), isFinal: /"result"\s*:/.test(candidate) };
      } catch {
        // Continue through known Volc response layouts.
      }
    }
  }
  return { data: null };
}

function decodeCandidates(payload) {
  const out = [payload.toString("utf8")];
  try {
    out.push(zlib.gunzipSync(payload).toString("utf8"));
  } catch {
    // Not gzip-compressed.
  }
  return out;
}

export function extractTranscriptText(data) {
  if (!data) {
    return "";
  }
  const candidates = [
    data.result?.text,
    data.payload_msg?.result?.text,
    data.payload_msg?.result?.[0]?.text,
    data.utterances?.at?.(-1)?.text,
    data.result?.utterances?.at?.(-1)?.text,
    data.payload_msg?.utterances?.at?.(-1)?.text
  ];
  return candidates.find((value) => typeof value === "string" && value.trim())?.trim() || "";
}

class AsyncEventQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
    this.error = null;
  }

  push(item) {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  end() {
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift().resolve({ value: undefined, done: true });
    }
  }

  throw(error) {
    this.error = error;
    this.closed = true;
    while (this.waiters.length > 0) {
      this.waiters.shift().reject(error);
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
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ resolve, reject });
    });
  }
}

async function* toAsyncIterable(chunks) {
  if (chunks?.[Symbol.asyncIterator]) {
    yield* chunks;
    return;
  }
  for (const chunk of chunks || []) {
    yield chunk;
  }
}

function elapsed(clock, startedAt) {
  return Math.round(clock() - startedAt);
}
