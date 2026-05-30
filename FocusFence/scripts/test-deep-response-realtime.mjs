#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { RawWebSocketClient } from "./deep-response/lib/raw-websocket-client.mjs";
import {
  DEEP_RESPONSE_EVENTS,
  buildDeepResponseURL,
  encodeDeepResponseMessage
} from "./deep-response/protocol/deep-response-protocol.mjs";
import { chunkPCM16 } from "./deep-response-benchmark.mjs";

export function parseRealtimeArgs(argv) {
  const args = {
    endpoint: "http://127.0.0.1:8797",
    pcmPath: "",
    chunkMs: 100,
    outputAudioPath: "",
    verbose: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--endpoint") {
      args.endpoint = argv[index + 1] || args.endpoint;
      index += 1;
    } else if (arg === "--pcm") {
      args.pcmPath = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--chunk-ms") {
      args.chunkMs = Number(argv[index + 1] || args.chunkMs);
      index += 1;
    } else if (arg === "--out-audio") {
      args.outputAudioPath = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--verbose") {
      args.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.help && !args.pcmPath) {
    throw new Error("Missing required --pcm path/to/16k-mono-int16-speech.pcm");
  }
  return args;
}

async function main() {
  const args = parseRealtimeArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!existsSync(args.pcmPath)) {
    throw new Error(`PCM fixture not found: ${args.pcmPath}`);
  }

  const pcm = readFileSync(args.pcmPath);
  const chunks = [...chunkPCM16(pcm, { sampleRate: 16_000, chunkMs: args.chunkMs })];
  const received = {
    messages: [],
    audioChunks: [],
    transcript: "",
    firstPhrase: "",
    timing: null
  };
  const startedAt = performance.now();
  const client = await RawWebSocketClient.connect(buildDeepResponseURL(args.endpoint), {
    "X-Deep-Response-Client": "node-provider-test",
    "X-Deep-Response-Session-ID": randomUUID()
  });

  client.onText = (text) => {
    const message = JSON.parse(text);
    received.messages.push(message);
    if (args.verbose) {
      console.log("received", JSON.stringify(message));
    }
    if (message.type === DEEP_RESPONSE_EVENTS.TranscriptFinal) {
      received.transcript = message.transcript || "";
    } else if (message.type === DEEP_RESPONSE_EVENTS.AssistantTextDelta) {
      received.firstPhrase += message.delta || "";
    } else if (message.type === DEEP_RESPONSE_EVENTS.Timing) {
      received.timing = message.timing || null;
    } else if (message.type === DEEP_RESPONSE_EVENTS.Error) {
      throw new Error(`${message.code}: ${message.message}`);
    }
  };
  client.onBinary = (chunk) => {
    received.audioChunks.push(Buffer.from(chunk));
  };

  try {
    client.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.SessionStart, {
      sessionID: randomUUID(),
      sampleRate: 16_000,
      audioFormat: "pcm_s16le"
    }));
    await waitFor(() => received.messages.some((message) => message.type === DEEP_RESPONSE_EVENTS.SessionReady));
    for (const chunk of chunks) {
      client.sendBinary(chunk);
      await sleep(args.chunkMs);
    }
    client.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.InputStop));
    await waitFor(() => Boolean(received.timing), { timeoutMs: 90_000 });
  } finally {
    client.close();
  }

  const audio = Buffer.concat(received.audioChunks);
  if (args.outputAudioPath) {
    writeFileSync(args.outputAudioPath, audio);
  }

  console.log(JSON.stringify({
    ok: Boolean(received.transcript && received.firstPhrase && audio.byteLength > 0),
    elapsedMs: Math.round(performance.now() - startedAt),
    transcript: received.transcript,
    firstPhrase: received.firstPhrase,
    audioByteLength: audio.byteLength,
    audioChunks: received.audioChunks.length,
    timing: received.timing
  }, null, 2));
}

function printHelp() {
  console.log(`Usage: node scripts/test-deep-response-realtime.mjs --pcm path/to/speech.pcm [options]

Options:
  --endpoint <url>      DeepResponse HTTP/WS server endpoint. Default: http://127.0.0.1:8797
  --pcm <path>          Required. Raw 16kHz mono int16 PCM speech fixture.
  --chunk-ms <ms>       Send interval. Default: 100
  --out-audio <path>    Optional output path for returned audio bytes.
  --verbose             Print server JSON messages.
`);
}

async function waitFor(predicate, { timeoutMs = 2_000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }
    await sleep(25);
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
