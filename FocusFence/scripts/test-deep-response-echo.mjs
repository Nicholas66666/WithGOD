#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";

import { RawWebSocketClient } from "./deep-response/lib/raw-websocket-client.mjs";
import { generateTonePCM16, chunkPCM } from "./test-presence-realtime.mjs";
import {
  DEEP_RESPONSE_EVENTS,
  buildDeepResponseURL,
  encodeDeepResponseMessage
} from "./deep-response/protocol/deep-response-protocol.mjs";

export function parseEchoArgs(argv) {
  const args = {
    endpoint: "http://127.0.0.1:8797",
    durationMs: 1_000,
    chunkMs: 100,
    verbose: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--endpoint") {
      args.endpoint = argv[index + 1] || args.endpoint;
      index += 1;
    } else if (arg === "--duration-ms") {
      args.durationMs = Number(argv[index + 1] || args.durationMs);
      index += 1;
    } else if (arg === "--chunk-ms") {
      args.chunkMs = Number(argv[index + 1] || args.chunkMs);
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
  const args = parseEchoArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const url = buildDeepResponseURL(args.endpoint);
  const pcm = generateTonePCM16({ durationMs: args.durationMs, sampleRate: 16_000 });
  const chunks = [...chunkPCM(pcm, { sampleRate: 16_000, chunkDurationMs: args.chunkMs })];
  const received = { messages: [], audioBytes: 0, audioChunks: 0 };
  const startedAt = performance.now();

  const client = await RawWebSocketClient.connect(url, {
    "X-Deep-Response-Client": "node-echo-test",
    "X-Deep-Response-Session-ID": randomUUID()
  });
  client.onText = (text) => {
    const message = JSON.parse(text);
    received.messages.push(message);
    if (args.verbose) {
      console.log("received", JSON.stringify(message));
    }
  };
  client.onBinary = (chunk) => {
    received.audioChunks += 1;
    received.audioBytes += chunk.byteLength;
  };

  try {
    client.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.SessionStart, {
      sessionID: randomUUID(),
      sampleRate: 16_000,
      audioFormat: "pcm_s16le"
    }));
    await waitFor(() => received.messages.some((message) => message.type === DEEP_RESPONSE_EVENTS.SessionReady));

    for (const chunk of chunks.slice(0, Math.max(1, Math.floor(chunks.length / 2)))) {
      client.sendBinary(chunk);
      await sleep(args.chunkMs);
    }
    client.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.BargeIn));

    for (const chunk of chunks.slice(Math.max(1, Math.floor(chunks.length / 2)))) {
      client.sendBinary(chunk);
      await sleep(args.chunkMs);
    }
    client.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.InputStop));
    await waitFor(() => received.messages.some((message) => message.type === DEEP_RESPONSE_EVENTS.Timing), { timeoutMs: 5_000 });
  } finally {
    client.close();
  }

  const timing = received.messages.find((message) => message.type === DEEP_RESPONSE_EVENTS.Timing)?.timing || {};
  console.log(JSON.stringify({
    ok: received.audioChunks > 0 && received.audioBytes > 0,
    elapsedMs: Math.round(performance.now() - startedAt),
    audioChunksSent: chunks.length,
    audioChunksReceived: received.audioChunks,
    audioBytesReceived: received.audioBytes,
    timing
  }, null, 2));
}

function printHelp() {
  console.log(`Usage: node scripts/test-deep-response-echo.mjs [options]

Options:
  --endpoint <url>      DeepResponse HTTP/WS server endpoint. Default: http://127.0.0.1:8797
  --duration-ms <ms>    Generated 16kHz PCM tone duration. Default: 1000
  --chunk-ms <ms>       PCM chunk interval. Default: 100
  --verbose             Print server JSON messages.
`);
}

async function waitFor(predicate, { timeoutMs = 2_000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await sleep(20);
  }
  throw new Error("waitFor timeout");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
