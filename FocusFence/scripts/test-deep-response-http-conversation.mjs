#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { chunkPCM16 } from "./test-deep-response-http-session.mjs";

export function parseHTTPConversationArgs(argv) {
  const args = {
    endpoint: "http://127.0.0.1:8797",
    pcmPath: "",
    turns: 2,
    chunkMs: 1000,
    uploadSleepMs: null,
    pollMs: 50,
    timeoutMs: 90_000,
    pipelineMode: "",
    endReason: "probe_complete",
    expectSessionEnd: false,
    expectLateAudio409: false,
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
    } else if (arg === "--turns") {
      args.turns = Number(argv[index + 1] || args.turns);
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
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[index + 1] || args.timeoutMs);
      index += 1;
    } else if (arg === "--pipeline-mode") {
      args.pipelineMode = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--end-reason") {
      args.endReason = argv[index + 1] || args.endReason;
      index += 1;
    } else if (arg === "--expect-session-end") {
      args.expectSessionEnd = true;
    } else if (arg === "--expect-late-audio-409") {
      args.expectLateAudio409 = true;
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

export async function runHTTPConversationProbe(args) {
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
  const basePath = `/deep-response/sessions/${encodeURIComponent(sessionID)}`;
  let eventCursor = 0;
  let audioCursor = 0;
  const turns = [];

  for (let turnIndex = 0; turnIndex < args.turns; turnIndex += 1) {
    const turnStartedAt = performance.now();
    const turnID = `turn_${Date.now()}_${turnIndex + 1}`;
    let encodedUploadBytes = 0;
    let decodedUploadBytes = 0;
    let firstAudioAt = null;
    const uploadStartedAt = performance.now();
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      const uploaded = await postBytes(
        buildURL(args.endpoint, `${basePath}/audio?turn_id=${turnID}&seq=${chunkIndex}`),
        chunks[chunkIndex]
      );
      encodedUploadBytes += uploaded.encodedBytes || chunks[chunkIndex].byteLength;
      decodedUploadBytes += uploaded.bytes || chunks[chunkIndex].byteLength;
      if (uploadSleepMs > 0) {
        await sleep(uploadSleepMs);
      }
    }
    const uploadEndedAt = performance.now();
    const stopped = await postJSON(buildURL(args.endpoint, `${basePath}/input-stop`), { turnID });
    const generationID = stopped.generationID;
    const events = [];
    const audioChunks = [];

    await waitFor(async () => {
      const eventBatch = await fetchJSON(buildURL(args.endpoint, `${basePath}/events?cursor=${eventCursor}`));
      eventCursor = eventBatch.nextCursor;
      const eventReceivedAtMs = Math.round(performance.now() - turnStartedAt);
      const turnEvents = eventBatch.events.filter((event) => event.turnID === turnID || event.type === "session_ready");
      events.push(...turnEvents.map((event) => ({ ...event, receivedAtMs: eventReceivedAtMs })));
      if (args.verbose && turnEvents.length > 0) {
        for (const event of turnEvents) {
          console.log("event", JSON.stringify(event));
        }
      }

      const audioBatch = await fetchJSON(buildURL(args.endpoint, `${basePath}/audio?cursor=${audioCursor}`));
      audioCursor = audioBatch.nextCursor;
      const turnAudio = audioBatch.chunks.filter((chunk) => chunk.generationID === generationID);
      if (firstAudioAt == null && turnAudio.length > 0) {
        firstAudioAt = performance.now();
      }
      const audioReceivedAtMs = Math.round(performance.now() - turnStartedAt);
      audioChunks.push(...turnAudio.map((chunk) => ({ ...chunk, receivedAtMs: audioReceivedAtMs })));
      return events.some((event) => event.type === "timing" && event.generationID === generationID)
        && events.some((event) => event.type === "audio_done" && event.generationID === generationID);
    }, { timeoutMs: args.timeoutMs, intervalMs: args.pollMs });

    turns.push(summarizeTurn({
      turnID,
      generationID,
      turnStartedAt,
      uploadStartedAt,
      uploadEndedAt,
      endedAt: performance.now(),
      firstAudioAt,
      uploadChunks: chunks.length,
      encodedUploadBytes,
      decodedUploadBytes,
      events,
      audioChunks
    }));
  }

  const ended = await postJSON(buildURL(args.endpoint, `${basePath}/end`), { reason: args.endReason });
  let sessionEnd = null;
  if (args.expectSessionEnd) {
    await waitFor(async () => {
      const eventBatch = await fetchJSON(buildURL(args.endpoint, `${basePath}/events?cursor=${eventCursor}`));
      eventCursor = eventBatch.nextCursor;
      sessionEnd = eventBatch.events.find((event) => event.type === "session_end") || null;
      return sessionEnd?.reason === args.endReason;
    }, { timeoutMs: args.timeoutMs, intervalMs: args.pollMs });
  }

  let lateAudioRejected = null;
  if (args.expectLateAudio409) {
    const late = await fetch(buildURL(args.endpoint, `${basePath}/audio?turn_id=late-after-end&seq=0`), {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: Buffer.from("late-audio")
    });
    let lateBody = null;
    try {
      lateBody = await late.json();
    } catch {
      lateBody = null;
    }
    lateAudioRejected = {
      status: late.status,
      error: lateBody?.error || ""
    };
    if (late.status !== 409 || lateBody?.error !== "session_ended") {
      throw new Error(`Expected late audio 409 session_ended, got ${late.status} ${JSON.stringify(lateBody)}`);
    }
  }

  return {
    ok: true,
    endpoint: args.endpoint,
    sessionID,
    ended,
    sessionEnd,
    lateAudioRejected,
    elapsedMs: Math.round(performance.now() - startedAt),
    turns
  };
}

export function summarizeTurn({
  turnID,
  generationID,
  turnStartedAt,
  uploadStartedAt,
  uploadEndedAt,
  endedAt,
  firstAudioAt,
  uploadChunks,
  encodedUploadBytes,
  decodedUploadBytes,
  events,
  audioChunks
}) {
  const transcript = events.find((event) => event.type === "transcript_final")?.text || "";
  const text = events
    .filter((event) => event.type === "assistant_text_delta")
    .map((event) => event.delta || "")
    .join("");
  const timing = events.find((event) => event.type === "timing")?.timing || null;
  const firstPhraseEvent = events.find((event) => event.type === "assistant_phrase");
  const firstAudioChunk = audioChunks[0] || null;
  const stopAtMs = Math.round(uploadEndedAt - turnStartedAt);
  const firstPhraseAtMs = Number.isFinite(firstPhraseEvent?.receivedAtMs) ? firstPhraseEvent.receivedAtMs : null;
  const firstAudioAtMs = Number.isFinite(firstAudioChunk?.receivedAtMs)
    ? firstAudioChunk.receivedAtMs
    : (firstAudioAt != null ? Math.round(firstAudioAt - turnStartedAt) : null);
  const timingWithHTTP = {
    ...(timing || {}),
    ...(firstPhraseAtMs != null ? { http_stop_to_first_phrase_ms: firstPhraseAtMs - stopAtMs } : {}),
    ...(firstAudioAtMs != null ? { http_stop_to_first_audio_ms: firstAudioAtMs - stopAtMs } : {}),
    ...(firstPhraseAtMs != null && firstAudioAtMs != null
      ? { http_first_audio_after_first_phrase_ms: firstAudioAtMs - firstPhraseAtMs }
      : {})
  };
  return {
    turnID,
    generationID,
    elapsedMs: Math.round(endedAt - turnStartedAt),
    uploadMs: Math.round(uploadEndedAt - uploadStartedAt),
    firstAudioMs: firstAudioAt != null ? Math.round(firstAudioAt - turnStartedAt) : null,
    stopToFirstAudioMs: firstAudioAt != null ? Math.round(firstAudioAt - uploadEndedAt) : null,
    uploadChunks,
    encodedUploadBytes,
    decodedUploadBytes,
    transcript,
    text,
    audioByteLength: audioChunks.reduce((sum, chunk) => sum + Number(chunk.audioByteLength || 0), 0),
    audioChunks: audioChunks.length,
    timing: timingWithHTTP
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
  console.log(`Usage: node scripts/test-deep-response-http-conversation.mjs --pcm path/to/speech.pcm [options]

Options:
  --endpoint <url>      DeepResponse HTTP server endpoint. Default: http://127.0.0.1:8797
  --pcm <path>          Required. Raw 16kHz mono int16 PCM speech fixture.
  --turns <n>           Number of consecutive turns in one session. Default: 2
  --chunk-ms <ms>       Upload chunk duration. Default: 1000
  --upload-sleep-ms <ms>
                        Sleep after each upload. Default: chunk-ms. Use 0 for network drain timing.
  --poll-ms <ms>        Poll interval for events/audio. Default: 50
  --timeout-ms <ms>     Probe timeout. Default: 90000
  --pipeline-mode <m>   Optional HTTP session pipeline mode, e.g. cascade.
  --end-reason <reason> Reason sent to /end after all turns. Default: probe_complete
  --expect-session-end  Require a matching session_end event after /end.
  --expect-late-audio-409
                        Verify audio upload after session end returns 409 session_ended.
  --verbose             Print turn event batches.
`);
}

export function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  try {
    const args = parseHTTPConversationArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      const summary = await runHTTPConversationProbe(args);
      console.log(JSON.stringify(summary, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
