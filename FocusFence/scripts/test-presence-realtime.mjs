#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import { pathToFileURL } from "node:url";
import tls from "node:tls";

const DEFAULT_SAMPLE_RATE = 24_000;
const DEFAULT_CHUNK_DURATION_MS = 200;

export function parseEnvFile(content) {
  const env = {};

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key) {
      env[key] = value;
    }
  }

  return env;
}

export function buildRealtimeURL(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    throw new Error(`Unsupported endpoint protocol: ${url.protocol}`);
  }
  url.searchParams.set("realtime", "1");
  return url;
}

export function generateTonePCM16({
  durationMs = 3_000,
  sampleRate = DEFAULT_SAMPLE_RATE,
  frequencyHz = 440,
  amplitude = 0.22
} = {}) {
  const sampleCount = Math.max(1, Math.round(sampleRate * durationMs / 1_000));
  const buffer = Buffer.alloc(sampleCount * 2);

  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = Math.min(1, index / 480, (sampleCount - index) / 480);
    const sample = Math.sin(2 * Math.PI * frequencyHz * index / sampleRate);
    const value = Math.max(-1, Math.min(1, sample * amplitude * envelope));
    buffer.writeInt16LE(Math.round(value * 0x7fff), index * 2);
  }

  return buffer;
}

export function* chunkPCM(
  pcm,
  { sampleRate = DEFAULT_SAMPLE_RATE, chunkDurationMs = DEFAULT_CHUNK_DURATION_MS } = {}
) {
  const bytesPerChunk = Math.max(2, Math.round(sampleRate * chunkDurationMs / 1_000) * 2);
  for (let offset = 0; offset < pcm.byteLength; offset += bytesPerChunk) {
    yield pcm.subarray(offset, Math.min(offset + bytesPerChunk, pcm.byteLength));
  }
}

function loadLocalEnv() {
  const envPath = new URL("../.env.local", import.meta.url);
  if (!existsSync(envPath)) {
    return {};
  }
  return parseEnvFile(readFileSync(envPath, "utf8"));
}

function parseArgs(argv) {
  const args = {
    chunkDurationMs: DEFAULT_CHUNK_DURATION_MS,
    durationMs: 3_000,
    pcmPath: "",
    verbose: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--pcm") {
      args.pcmPath = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--chunk-ms") {
      args.chunkDurationMs = Number(argv[index + 1] || DEFAULT_CHUNK_DURATION_MS);
      index += 1;
    } else if (arg === "--duration-ms") {
      args.durationMs = Number(argv[index + 1] || 3_000);
      index += 1;
    } else if (arg === "--verbose") {
      args.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const fileEnv = loadLocalEnv();
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  const endpoint = process.env.PRESENCE_PROCESS_ENDPOINT || "";
  const token = process.env.PRESENCE_CLIENT_TOKEN || "";
  if (!endpoint || !token) {
    throw new Error("Missing PRESENCE_PROCESS_ENDPOINT or PRESENCE_CLIENT_TOKEN in .env.local");
  }

  const realtimeURL = buildRealtimeURL(endpoint);
  const pcm = args.pcmPath ? readFileSync(args.pcmPath) : generateTonePCM16({ durationMs: args.durationMs });
  const chunks = [...chunkPCM(pcm, { chunkDurationMs: args.chunkDurationMs })];

  console.log(`Realtime URL: ${redactURL(realtimeURL)}`);
  console.log(`PCM bytes: ${pcm.byteLength}; chunks: ${chunks.length}; chunk interval: ${args.chunkDurationMs}ms`);
  if (!args.pcmPath) {
    console.log("Audio source: generated 24kHz mono int16 tone. Use --pcm path/to/audio.pcm for a real speech fixture.");
  }

  const startedAt = nowMs();
  const timing = {
    ws_connect_ms: null,
    session_ready_ms: null,
    first_chunk_sent_ms: null,
    chunks_sent: 0,
    stop_sent_ms: null,
    first_transcript_delta_ms: null,
    transcript_completed_ms: null,
    response_create_sent_ms: null,
    first_output_text_delta_ms: null,
    watch_response_ms: null,
    total_ms: null
  };
  let transcript = "";
  let watchResponse = null;
  let lastMessage = null;

  const client = await RawWebSocketClient.connect(realtimeURL, {
    "X-Presence-Client-Token": token,
    "X-Presence-Source": "codex-realtime-smoke-test",
    "X-Presence-Local-Record-ID": randomUUID()
  });
  timing.ws_connect_ms = elapsed(startedAt);
  console.log(`WebSocket connected in ${timing.ws_connect_ms}ms`);

  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for watch_response"));
    }, 60_000);
    const finish = (fn, value) => {
      clearTimeout(timeout);
      fn(value);
    };
    client.onText = (text) => {
      try {
        const message = JSON.parse(text);
        lastMessage = message;
        if (args.verbose) {
          console.log("received:", JSON.stringify(message));
        }
        updateTimingFromMessage(message, timing, startedAt);

        if (message.type === "transcript_delta" && typeof message.delta === "string") {
          transcript += message.delta;
        }
        if (message.type === "transcript_completed" && typeof message.transcript === "string") {
          transcript = message.transcript;
        }
        if (message.type === "watch_response") {
          timing.watch_response_ms ??= elapsed(startedAt);
          timing.total_ms = elapsed(startedAt);
          transcript = message.transcript || transcript;
          watchResponse = message.watchResponse || null;
          finish(resolve);
        }
        if (message.type === "error") {
          const details = message.message || message.code || "realtime_error";
          finish(reject, new Error(`Server realtime error: ${details}`));
        }
      } catch (error) {
        finish(reject, error);
      }
    };
    client.onClose = ({ code, reason }) => {
      if (!watchResponse) {
        finish(reject, new Error(`WebSocket closed before watch_response: ${code} ${reason}`.trim()));
      }
    };
    client.onError = (error) => finish(reject, error);
  });

  for (const chunk of chunks) {
    client.sendBinary(chunk);
    timing.chunks_sent += 1;
    timing.first_chunk_sent_ms ??= elapsed(startedAt);
    await sleep(args.chunkDurationMs);
  }

  client.sendText(JSON.stringify({ type: "stop" }));
  timing.stop_sent_ms = elapsed(startedAt);
  console.log(`Stop sent at ${timing.stop_sent_ms}ms`);

  try {
    await done;
  } finally {
    client.close();
  }

  printResult({ timing, transcript, watchResponse, lastMessage });
}

function updateTimingFromMessage(message, timing, startedAt) {
  if (message.type === "session_ready") {
    timing.session_ready_ms ??= elapsed(startedAt);
  } else if (message.type === "transcript_delta") {
    timing.first_transcript_delta_ms ??= elapsed(startedAt);
  } else if (message.type === "transcript_completed") {
    timing.transcript_completed_ms ??= elapsed(startedAt);
  } else if (message.type === "response_create_sent") {
    timing.response_create_sent_ms ??= elapsed(startedAt);
  } else if (message.type === "output_text_delta") {
    timing.first_output_text_delta_ms ??= elapsed(startedAt);
  }

  if (message.timing && typeof message.timing === "object") {
    for (const [key, value] of Object.entries(message.timing)) {
      if (key in timing && typeof value === "number") {
        timing[key] ??= value;
      }
    }
  }
}

function printResult({ timing, transcript, watchResponse, lastMessage }) {
  console.log("\nTiming:");
  console.log(JSON.stringify(timing, null, 2));
  console.log("\nTranscript:");
  console.log(transcript || "(empty)");
  console.log("\nWatch response:");
  console.log(JSON.stringify(watchResponse, null, 2));
  if (!watchResponse && lastMessage) {
    console.log("\nLast message:");
    console.log(JSON.stringify(lastMessage, null, 2));
  }
}

function printHelp() {
  console.log(`Usage: node scripts/test-presence-realtime.mjs [options]

Options:
  --pcm <path>         Read raw 24kHz mono int16 PCM audio from a file.
  --chunk-ms <ms>      Send chunk interval in milliseconds. Default: ${DEFAULT_CHUNK_DURATION_MS}
  --duration-ms <ms>   Generated tone duration when --pcm is omitted. Default: 3000
  --verbose           Print every JSON message received from the server.
`);
}

function redactURL(url) {
  const copy = new URL(url.toString());
  return copy.toString();
}

function nowMs() {
  return performance.now();
}

function elapsed(startedAt) {
  return Math.round(nowMs() - startedAt);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

class RawWebSocketClient {
  static async connect(url, headers) {
    const client = new RawWebSocketClient(url, headers);
    await client.connect();
    return client;
  }

  constructor(url, headers) {
    this.url = url;
    this.headers = headers;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.handshakeBuffer = Buffer.alloc(0);
    this.isOpen = false;
    this.fragmentOpcode = null;
    this.fragments = [];
    this.onText = () => {};
    this.onClose = () => {};
    this.onError = () => {};
  }

  async connect() {
    const isSecure = this.url.protocol === "wss:";
    const port = Number(this.url.port || (isSecure ? 443 : 80));
    const host = this.url.hostname;
    const key = randomBytes(16).toString("base64");

    this.socket = isSecure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });

    this.socket.on("error", (error) => this.onError(error));
    this.socket.on("data", this.handleData);
    this.socket.on("close", () => this.onClose({ code: 1006, reason: "socket_closed" }));

    await new Promise((resolve, reject) => {
      const onReady = () => {
        this.socket.off("error", onError);
        resolve();
      };
      const onError = (error) => {
        this.socket.off(isSecure ? "secureConnect" : "connect", onReady);
        reject(error);
      };
      this.socket.once(isSecure ? "secureConnect" : "connect", onReady);
      this.socket.once("error", onError);
    });

    const path = `${this.url.pathname || "/"}${this.url.search || ""}`;
    const requestHeaders = {
      Host: this.url.host,
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Key": key,
      "Sec-WebSocket-Version": "13",
      ...this.headers
    };
    const request = [
      `GET ${path} HTTP/1.1`,
      ...Object.entries(requestHeaders).map(([header, value]) => `${header}: ${value}`),
      "",
      ""
    ].join("\r\n");

    this.socket.write(request);

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("WebSocket handshake timed out")), 15_000);
      const onHandshake = (data) => {
        this.handshakeBuffer = Buffer.concat([this.handshakeBuffer, data]);
        const separator = this.handshakeBuffer.indexOf("\r\n\r\n");
        if (separator === -1) {
          return;
        }

        this.socket.off("data", onHandshake);
        clearTimeout(timeout);
        const headerText = this.handshakeBuffer.subarray(0, separator).toString("utf8");
        const rest = this.handshakeBuffer.subarray(separator + 4);
        const statusLine = headerText.split("\r\n")[0] || "";
        if (!statusLine.includes(" 101 ")) {
          reject(new Error(`WebSocket upgrade failed: ${statusLine}`));
          return;
        }

        const accept = headerText.match(/^Sec-WebSocket-Accept:\s*(.+)$/im)?.[1]?.trim();
        const expected = createHash("sha1")
          .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64");
        if (accept !== expected) {
          reject(new Error("WebSocket upgrade failed: invalid accept key"));
          return;
        }

        this.isOpen = true;
        this.socket.on("data", this.handleData);
        if (rest.byteLength > 0) {
          this.handleFrameBytes(rest);
        }
        resolve();
      };

      this.socket.off("data", this.handleData);
      this.socket.on("data", onHandshake);
    });
  }

  handleData = (data) => {
    if (!this.isOpen) {
      return;
    }
    this.handleFrameBytes(data);
  };

  handleFrameBytes(data) {
    this.buffer = Buffer.concat([this.buffer, data]);

    while (this.buffer.byteLength >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = Boolean(first & 0x80);
      const opcode = first & 0x0f;
      const masked = Boolean(second & 0x80);
      let payloadLength = second & 0x7f;
      let offset = 2;

      if (payloadLength === 126) {
        if (this.buffer.byteLength < offset + 2) {
          return;
        }
        payloadLength = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (payloadLength === 127) {
        if (this.buffer.byteLength < offset + 8) {
          return;
        }
        const bigLength = this.buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          this.onError(new Error("WebSocket frame too large"));
          return;
        }
        payloadLength = Number(bigLength);
        offset += 8;
      }

      const maskOffset = offset;
      if (masked) {
        offset += 4;
      }

      if (this.buffer.byteLength < offset + payloadLength) {
        return;
      }

      let payload = this.buffer.subarray(offset, offset + payloadLength);
      if (masked) {
        const mask = this.buffer.subarray(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
      }
      this.buffer = this.buffer.subarray(offset + payloadLength);

      if (opcode === 0x0) {
        this.fragments.push(payload);
        if (fin) {
          this.emitFragmentedMessage();
        }
      } else if (opcode === 0x1 || opcode === 0x2) {
        if (fin) {
          if (opcode === 0x1) {
            this.onText(payload.toString("utf8"));
          }
        } else {
          this.fragmentOpcode = opcode;
          this.fragments = [payload];
        }
      } else if (opcode === 0x8) {
        const code = payload.byteLength >= 2 ? payload.readUInt16BE(0) : 1005;
        const reason = payload.byteLength > 2 ? payload.subarray(2).toString("utf8") : "";
        this.onClose({ code, reason });
      } else if (opcode === 0x9) {
        this.sendFrame(0xA, payload);
      }
    }
  }

  emitFragmentedMessage() {
    const payload = Buffer.concat(this.fragments);
    const opcode = this.fragmentOpcode;
    this.fragmentOpcode = null;
    this.fragments = [];
    if (opcode === 0x1) {
      this.onText(payload.toString("utf8"));
    }
  }

  sendText(text) {
    this.sendFrame(0x1, Buffer.from(text, "utf8"));
  }

  sendBinary(data) {
    this.sendFrame(0x2, Buffer.from(data));
  }

  close() {
    if (this.socket && !this.socket.destroyed) {
      this.sendFrame(0x8, Buffer.alloc(0));
      this.socket.end();
    }
  }

  sendFrame(opcode, payload) {
    const length = payload.byteLength;
    let headerLength = 2;
    if (length >= 126 && length <= 0xffff) {
      headerLength += 2;
    } else if (length > 0xffff) {
      headerLength += 8;
    }
    const mask = randomBytes(4);
    const frame = Buffer.alloc(headerLength + 4 + length);
    frame[0] = 0x80 | opcode;

    let offset = 2;
    if (length < 126) {
      frame[1] = 0x80 | length;
    } else if (length <= 0xffff) {
      frame[1] = 0x80 | 126;
      frame.writeUInt16BE(length, offset);
      offset += 2;
    } else {
      frame[1] = 0x80 | 127;
      frame.writeBigUInt64BE(BigInt(length), offset);
      offset += 8;
    }

    mask.copy(frame, offset);
    offset += 4;
    for (let index = 0; index < length; index += 1) {
      frame[offset + index] = payload[index] ^ mask[index % 4];
    }
    this.socket.write(frame);
  }
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
