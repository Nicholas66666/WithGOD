#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function parseHTTPSessionArgs(argv) {
  const args = {
    endpoint: "http://127.0.0.1:8797",
    pcmPath: "",
    chunkMs: 100,
    pollMs: 250,
    timeoutMs: 90_000,
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
    } else if (arg === "--poll-ms") {
      args.pollMs = Number(argv[index + 1] || args.pollMs);
      index += 1;
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[index + 1] || args.timeoutMs);
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

export async function runHTTPSessionProbe(args) {
  if (!existsSync(args.pcmPath)) {
    throw new Error(`PCM fixture not found: ${args.pcmPath}`);
  }

  const startedAt = performance.now();
  const pcm = readFileSync(args.pcmPath);
  const chunks = [...chunkPCM16(pcm, { sampleRate: 16_000, chunkMs: args.chunkMs })];
  const created = await postJSON(buildURL(args.endpoint, "/deep-response/sessions"), {
    sampleRate: 16_000
  });
  const sessionID = created.sessionID;
  const turnID = `turn_${Date.now()}`;
  const basePath = `/deep-response/sessions/${encodeURIComponent(sessionID)}`;

  for (let index = 0; index < chunks.length; index += 1) {
    await postBytes(buildURL(args.endpoint, `${basePath}/audio?turn_id=${turnID}&seq=${index}`), chunks[index]);
    await sleep(args.chunkMs);
  }
  await postJSON(buildURL(args.endpoint, `${basePath}/input-stop`), { turnID });

  let eventCursor = 0;
  let audioCursor = 0;
  const events = [];
  const audioChunks = [];

  await waitFor(async () => {
    const eventBatch = await fetchJSON(buildURL(args.endpoint, `${basePath}/events?cursor=${eventCursor}`));
    eventCursor = eventBatch.nextCursor;
    events.push(...eventBatch.events);
    if (args.verbose && eventBatch.events.length > 0) {
      for (const event of eventBatch.events) {
        console.log("event", JSON.stringify(event));
      }
    }

    const audioBatch = await fetchJSON(buildURL(args.endpoint, `${basePath}/audio?cursor=${audioCursor}`));
    audioCursor = audioBatch.nextCursor;
    audioChunks.push(...audioBatch.chunks);
    return events.some((event) => event.type === "timing")
      && events.some((event) => event.type === "audio_done");
  }, { timeoutMs: args.timeoutMs, intervalMs: args.pollMs });

  const summary = summarizeHTTPSessionResult({
    startedAt,
    endedAt: performance.now(),
    sessionID,
    events,
    audioChunks
  });

  if (args.outputAudioPath) {
    writeFileSync(args.outputAudioPath, Buffer.concat(audioChunks.map((chunk) => Buffer.from(chunk.audioBase64, "base64"))));
  }

  return summary;
}

export function summarizeHTTPSessionResult({ startedAt, endedAt, sessionID, events, audioChunks }) {
  const transcript = events.find((event) => event.type === "transcript_final")?.text || "";
  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta || "")
    .join(" ");
  const timing = events.find((event) => event.type === "timing")?.timing || null;
  const audioByteLength = audioChunks.reduce((sum, chunk) => sum + Number(chunk.audioByteLength || 0), 0);
  return {
    ok: Boolean(transcript || text || audioByteLength > 0),
    elapsedMs: Math.round(endedAt - startedAt),
    sessionID,
    transcript,
    text,
    audioByteLength,
    audioChunks: audioChunks.length,
    timing
  };
}

export function* chunkPCM16(pcm, { sampleRate = 16_000, chunkMs = 100 } = {}) {
  const bytesPerChunk = Math.max(2, Math.round(sampleRate * chunkMs / 1_000) * 2);
  for (let offset = 0; offset < pcm.byteLength; offset += bytesPerChunk) {
    yield pcm.subarray(offset, Math.min(offset + bytesPerChunk, pcm.byteLength));
  }
}

function buildURL(endpoint, path) {
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  return `${base}${path}`;
}

async function postJSON(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function postBytes(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function waitFor(predicate, { timeoutMs = 2_000, intervalMs = 25 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error("waitFor timeout");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage: node scripts/test-deep-response-http-session.mjs --pcm path/to/speech.pcm [options]

Options:
  --endpoint <url>      DeepResponse HTTP server endpoint. Default: http://127.0.0.1:8797
  --pcm <path>          Required. Raw 16kHz mono int16 PCM speech fixture.
  --chunk-ms <ms>       Upload chunk duration. Default: 100
  --poll-ms <ms>        Poll interval for events/audio. Default: 250
  --timeout-ms <ms>     Probe timeout. Default: 90000
  --out-audio <path>    Optional output path for returned PCM bytes.
  --verbose             Print event batches.
`);
}

export function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  const args = parseHTTPSessionArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
  } else {
    runHTTPSessionProbe(args).then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    }).catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
  }
}
