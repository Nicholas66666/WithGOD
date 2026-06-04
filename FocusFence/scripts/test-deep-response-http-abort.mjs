#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { chunkPCM16 } from "./test-deep-response-http-session.mjs";

export function parseHTTPAbortArgs(argv) {
  const args = {
    endpoint: "http://127.0.0.1:8797",
    pcmPath: "",
    chunkMs: 1000,
    uploadSleepMs: null,
    pollMs: 50,
    observeMs: 3_000,
    pipelineMode: "",
    expectNextTurn: false,
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
    } else if (arg === "--upload-sleep-ms") {
      args.uploadSleepMs = Number(argv[index + 1] || 0);
      index += 1;
    } else if (arg === "--poll-ms") {
      args.pollMs = Number(argv[index + 1] || args.pollMs);
      index += 1;
    } else if (arg === "--observe-ms") {
      args.observeMs = Number(argv[index + 1] || args.observeMs);
      index += 1;
    } else if (arg === "--pipeline-mode") {
      args.pipelineMode = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--expect-next-turn") {
      args.expectNextTurn = true;
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

export async function runHTTPAbortProbe(args) {
  if (!existsSync(args.pcmPath)) {
    throw new Error(`PCM fixture not found: ${args.pcmPath}`);
  }

  const startedAt = performance.now();
  const pcm = readFileSync(args.pcmPath);
  const chunks = [...chunkPCM16(pcm, { sampleRate: 16_000, chunkMs: args.chunkMs })];
  const uploadSleepMs = args.uploadSleepMs ?? args.chunkMs;
  const created = await postJSON(buildURL(args.endpoint, "/deep-response/sessions"), {
    sampleRate: 16_000,
    ...(args.pipelineMode ? { pipelineMode: args.pipelineMode } : {})
  });
  const sessionID = created.sessionID;
  const turnID = `turn_abort_${Date.now()}`;
  const basePath = `/deep-response/sessions/${encodeURIComponent(sessionID)}`;

  const uploadStartedAt = performance.now();
  for (let index = 0; index < chunks.length; index += 1) {
    await postBytes(buildURL(args.endpoint, `${basePath}/audio?turn_id=${turnID}&seq=${index}`), chunks[index]);
    if (uploadSleepMs > 0) {
      await sleep(uploadSleepMs);
    }
  }
  const uploadEndedAt = performance.now();
  const stopped = await postJSON(buildURL(args.endpoint, `${basePath}/input-stop`), { turnID });
  const generationID = stopped.generationID;
  const aborted = await postJSON(buildURL(args.endpoint, `${basePath}/abort`), {
    turnID,
    generationID,
    reason: "probe_barge_in"
  });

  let eventCursor = 0;
  let audioCursor = 0;
  const events = [];
  const audioChunks = [];
  const observeStartedAt = performance.now();
  while (performance.now() - observeStartedAt < args.observeMs) {
    const eventBatch = await fetchJSON(buildURL(args.endpoint, `${basePath}/events?cursor=${eventCursor}`));
    eventCursor = eventBatch.nextCursor;
    const turnEvents = eventBatch.events.filter((event) => event.turnID === turnID);
    events.push(...turnEvents);
    if (args.verbose && turnEvents.length > 0) {
      for (const event of turnEvents) {
        console.log("event", JSON.stringify(event));
      }
    }

    const audioBatch = await fetchJSON(buildURL(args.endpoint, `${basePath}/audio?cursor=${audioCursor}`));
    audioCursor = audioBatch.nextCursor;
    audioChunks.push(...audioBatch.chunks.filter((chunk) => chunk.generationID === generationID));
    await sleep(args.pollMs);
  }

  let nextTurn = null;
  if (args.expectNextTurn) {
    nextTurn = await runNextTurnAfterAbort({
      endpoint: args.endpoint,
      basePath,
      chunks,
      uploadSleepMs,
      pollMs: args.pollMs,
      verbose: args.verbose,
      eventCursor,
      audioCursor
    });
    eventCursor = nextTurn.eventCursor;
    audioCursor = nextTurn.audioCursor;
  }

  await postJSON(buildURL(args.endpoint, `${basePath}/end`), { reason: "abort_probe_complete" });

  return {
    ok: aborted.ok === true && audioChunks.length === 0 && (!args.expectNextTurn || nextTurn?.ok === true),
    endpoint: args.endpoint,
    sessionID,
    turnID,
    generationID,
    nextTurn,
    elapsedMs: Math.round(performance.now() - startedAt),
    uploadMs: Math.round(uploadEndedAt - uploadStartedAt),
    observeMs: args.observeMs,
    aborted,
    eventTypes: events.map((event) => event.type),
    staleAudioChunks: audioChunks.length,
    staleAudioBytes: audioChunks.reduce((sum, chunk) => sum + Number(chunk.audioByteLength || 0), 0)
  };
}

async function runNextTurnAfterAbort({
  endpoint,
  basePath,
  chunks,
  uploadSleepMs,
  pollMs,
  verbose,
  eventCursor,
  audioCursor
}) {
  const turnID = `turn_after_abort_${Date.now()}`;
  for (let index = 0; index < chunks.length; index += 1) {
    await postBytes(buildURL(endpoint, `${basePath}/audio?turn_id=${turnID}&seq=${index}`), chunks[index]);
    if (uploadSleepMs > 0) {
      await sleep(uploadSleepMs);
    }
  }
  const stopped = await postJSON(buildURL(endpoint, `${basePath}/input-stop`), { turnID });
  const generationID = stopped.generationID;
  const events = [];
  const audioChunks = [];
  const startedAt = performance.now();
  while (performance.now() - startedAt < 30_000) {
    const eventBatch = await fetchJSON(buildURL(endpoint, `${basePath}/events?cursor=${eventCursor}`));
    eventCursor = eventBatch.nextCursor;
    const turnEvents = eventBatch.events.filter((event) => event.turnID === turnID);
    events.push(...turnEvents);
    if (verbose && turnEvents.length > 0) {
      for (const event of turnEvents) {
        console.log("next_event", JSON.stringify(event));
      }
    }

    const audioBatch = await fetchJSON(buildURL(endpoint, `${basePath}/audio?cursor=${audioCursor}`));
    audioCursor = audioBatch.nextCursor;
    audioChunks.push(...audioBatch.chunks.filter((chunk) => chunk.generationID === generationID));
    if (events.some((event) => event.type === "timing" && event.generationID === generationID)
      && events.some((event) => event.type === "audio_done" && event.generationID === generationID)) {
      break;
    }
    await sleep(pollMs);
  }

  const transcript = events.find((event) => event.type === "transcript_final")?.text || "";
  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta || "")
    .join("");
  const ok = Boolean(transcript) && Boolean(text) && audioChunks.length > 0;
  if (!ok) {
    throw new Error(`Expected next turn after abort, got transcript=${JSON.stringify(transcript)} text=${JSON.stringify(text)} audioChunks=${audioChunks.length}`);
  }
  return {
    ok,
    turnID,
    generationID,
    transcript,
    text,
    audioChunks: audioChunks.length,
    audioBytes: audioChunks.reduce((sum, chunk) => sum + Number(chunk.audioByteLength || 0), 0),
    eventTypes: events.map((event) => event.type),
    eventCursor,
    audioCursor
  };
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage: node scripts/test-deep-response-http-abort.mjs --pcm path/to/speech.pcm [options]

Options:
  --endpoint <url>      DeepResponse HTTP server endpoint. Default: http://127.0.0.1:8797
  --pcm <path>          Required. Raw 16kHz mono int16 PCM speech fixture.
  --chunk-ms <ms>       Upload chunk duration. Default: 1000
  --upload-sleep-ms <ms>
                        Sleep after each upload. Default: chunk-ms.
  --poll-ms <ms>        Poll interval for events/audio. Default: 50
  --observe-ms <ms>     How long to watch for stale audio after abort. Default: 3000
  --pipeline-mode <m>   Optional HTTP session pipeline mode, e.g. cascade.
  --expect-next-turn    After abort, require a new turn in the same session to complete.
  --verbose             Print turn event batches.
`);
}

export function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  try {
    const args = parseHTTPAbortArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      const summary = await runHTTPAbortProbe(args);
      console.log(JSON.stringify(summary, null, 2));
      if (!summary.ok) {
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
