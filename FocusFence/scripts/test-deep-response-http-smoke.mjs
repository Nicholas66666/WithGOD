#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  parseHTTPAbortArgs,
  runHTTPAbortProbe
} from "./test-deep-response-http-abort.mjs";
import {
  parseHTTPConversationArgs,
  runHTTPConversationProbe
} from "./test-deep-response-http-conversation.mjs";

export function parseHTTPSmokeArgs(argv) {
  const args = {
    endpoint: "http://127.0.0.1:8797",
    pcmPath: "",
    turns: 2,
    chunkMs: 1000,
    uploadSleepMs: null,
    pollMs: 50,
    waitMs: 800,
    timeoutMs: 90_000,
    observeMs: 3_000,
    idleTimeoutMs: 150,
    idleObserveMs: 2_000,
    maxStopToFirstAudioMs: 3_000,
    retries: 2,
    pipelineMode: "",
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
    } else if (arg === "--wait-ms") {
      args.waitMs = Number(argv[index + 1] || args.waitMs);
      index += 1;
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = Number(argv[index + 1] || args.timeoutMs);
      index += 1;
    } else if (arg === "--observe-ms") {
      args.observeMs = Number(argv[index + 1] || args.observeMs);
      index += 1;
    } else if (arg === "--idle-timeout-ms") {
      args.idleTimeoutMs = Number(argv[index + 1] || args.idleTimeoutMs);
      index += 1;
    } else if (arg === "--idle-observe-ms") {
      args.idleObserveMs = Number(argv[index + 1] || args.idleObserveMs);
      index += 1;
    } else if (arg === "--max-stop-to-first-audio-ms") {
      args.maxStopToFirstAudioMs = Number(argv[index + 1] || args.maxStopToFirstAudioMs);
      index += 1;
    } else if (arg === "--retries") {
      args.retries = Number(argv[index + 1] || args.retries);
      index += 1;
    } else if (arg === "--pipeline-mode") {
      args.pipelineMode = argv[index + 1] || "";
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

export async function runHTTPSmokeProbe(args) {
  const health = await withRetries(() => fetchHealth(args.endpoint), {
    attempts: args.retries + 1,
    label: "health"
  });
  const conversationArgs = parseHTTPConversationArgs([
    "--endpoint", args.endpoint,
    "--pcm", args.pcmPath,
    "--turns", String(args.turns),
    "--chunk-ms", String(args.chunkMs),
    "--upload-sleep-ms", String(args.uploadSleepMs ?? args.chunkMs),
    "--poll-ms", String(args.pollMs),
    "--wait-ms", String(args.waitMs),
    "--timeout-ms", String(args.timeoutMs),
    ...(args.pipelineMode ? ["--pipeline-mode", args.pipelineMode] : []),
    ...(args.verbose ? ["--verbose"] : [])
  ]);
  const conversation = await withRetries(() => runHTTPConversationProbe(conversationArgs), {
    attempts: args.retries + 1,
    label: "conversation"
  });
  const abortArgs = parseHTTPAbortArgs([
    "--endpoint", args.endpoint,
    "--pcm", args.pcmPath,
    "--chunk-ms", String(args.chunkMs),
    "--upload-sleep-ms", String(args.uploadSleepMs ?? args.chunkMs),
    "--poll-ms", String(args.pollMs),
    "--observe-ms", String(args.observeMs),
    ...(args.pipelineMode ? ["--pipeline-mode", args.pipelineMode] : []),
    ...(args.verbose ? ["--verbose"] : [])
  ]);
  const abort = await withRetries(() => runHTTPAbortProbe(abortArgs), {
    attempts: args.retries + 1,
    label: "abort"
  });
  const idle = await withRetries(() => runHTTPIdleProbe({
    endpoint: args.endpoint,
    idleTimeoutMs: args.idleTimeoutMs,
    idleObserveMs: args.idleObserveMs,
    pollMs: args.pollMs
  }), {
    attempts: args.retries + 1,
    label: "idle"
  });

  const turnFailures = conversation.turns.filter((turn) => {
    return !turn.transcript
      || !turn.text
      || turn.audioChunks <= 0
      || turn.audioByteLength <= 0
      || turn.stopToFirstAudioMs == null
      || turn.stopToFirstAudioMs > args.maxStopToFirstAudioMs;
  });

  return {
    ok: health.ok && conversation.ok && abort.ok && idle.ok && turnFailures.length === 0,
    endpoint: args.endpoint,
    thresholds: {
      maxStopToFirstAudioMs: args.maxStopToFirstAudioMs,
      pipelineMode: args.pipelineMode,
      waitMs: args.waitMs,
      idleTimeoutMs: args.idleTimeoutMs
    },
    health,
    conversation: {
      ok: conversation.ok,
      sessionID: conversation.sessionID,
      elapsedMs: conversation.elapsedMs,
      turns: conversation.turns.map((turn) => ({
        turnID: turn.turnID,
        generationID: turn.generationID,
        stopToFirstAudioMs: turn.stopToFirstAudioMs,
        transcript: turn.transcript,
        text: turn.text,
        audioChunks: turn.audioChunks,
        audioByteLength: turn.audioByteLength,
        timing: turn.timing
      }))
    },
    abort: {
      ok: abort.ok,
      sessionID: abort.sessionID,
      turnID: abort.turnID,
      generationID: abort.generationID,
      staleAudioChunks: abort.staleAudioChunks,
      staleAudioBytes: abort.staleAudioBytes,
      eventTypes: abort.eventTypes
    },
    idle,
    failures: turnFailures.map((turn) => ({
      turnID: turn.turnID,
      stopToFirstAudioMs: turn.stopToFirstAudioMs,
      hasTranscript: Boolean(turn.transcript),
      hasText: Boolean(turn.text),
      audioChunks: turn.audioChunks,
      audioByteLength: turn.audioByteLength
    }))
  };
}

export async function runHTTPIdleProbe({ endpoint, idleTimeoutMs = 150, idleObserveMs = 2_000, pollMs = 50 }) {
  const created = await postJSON(buildURL(endpoint, "/deep-response/sessions"), {
    sampleRate: 16_000,
    idleTimeoutMs
  });
  const basePath = `/deep-response/sessions/${encodeURIComponent(created.sessionID)}`;
  let eventCursor = 0;
  const events = [];
  const startedAt = performance.now();
  while (performance.now() - startedAt < idleObserveMs) {
    const eventBatch = await fetchJSON(buildURL(endpoint, `${basePath}/events?cursor=${eventCursor}`));
    eventCursor = eventBatch.nextCursor;
    events.push(...eventBatch.events);
    if (events.some((event) => event.type === "session_end" && event.reason === "idle_timeout")) {
      break;
    }
    await sleep(pollMs);
  }

  const rejected = await fetch(buildURL(endpoint, `${basePath}/audio?turn_id=turn-after-idle&seq=0`), {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: Buffer.from("late")
  });
  let rejectedBody = null;
  try {
    rejectedBody = await rejected.json();
  } catch {
    rejectedBody = await rejected.text();
  }

  const sawIdleEnd = events.some((event) => event.type === "session_end" && event.reason === "idle_timeout");
  return {
    ok: sawIdleEnd && rejected.status === 409 && rejectedBody?.error === "session_ended",
    sessionID: created.sessionID,
    elapsedMs: Math.round(performance.now() - startedAt),
    idleTimeoutMs,
    rejectedStatus: rejected.status,
    rejectedBody,
    eventTypes: events.map((event) => event.type),
    endReason: events.find((event) => event.type === "session_end")?.reason || ""
  };
}

async function fetchHealth(endpoint) {
  const response = await fetch(buildURL(endpoint, "/health"));
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }
  return {
    ok: response.status === 200,
    status: response.status,
    body
  };
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

async function fetchJSON(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function withRetries(operation, { attempts, label }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(500 * attempt);
      }
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`${label} failed after ${attempts} attempts: ${message}`);
}

function buildURL(endpoint, path) {
  const base = endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
  return `${base}${path}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp() {
  console.log(`Usage: node scripts/test-deep-response-http-smoke.mjs --pcm path/to/speech.pcm [options]

Options:
  --endpoint <url>                 DeepResponse HTTP server endpoint. Default: http://127.0.0.1:8797
  --pcm <path>                     Required. Raw 16kHz mono int16 PCM speech fixture.
  --turns <n>                      Consecutive turns in one session. Default: 2
  --chunk-ms <ms>                  Upload chunk duration. Default: 1000
  --upload-sleep-ms <ms>           Sleep after each upload. Default: chunk-ms.
  --poll-ms <ms>                   Poll interval for events/audio. Default: 50
  --timeout-ms <ms>                Conversation timeout. Default: 90000
  --observe-ms <ms>                Abort stale-audio observation window. Default: 3000
  --idle-timeout-ms <ms>           Idle timeout used by the self-test session. Default: 150
  --idle-observe-ms <ms>           How long to wait for idle timeout. Default: 2000
  --max-stop-to-first-audio-ms <ms>
                                   Fail if any turn exceeds this stop-to-first-audio budget. Default: 3000
  --retries <n>                    Retry each top-level probe after transient network failures. Default: 2
  --pipeline-mode <m>              Optional HTTP session pipeline mode, e.g. cascade.
  --verbose                        Print event details from child probes.
`);
}

function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  try {
    const args = parseHTTPSmokeArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
    } else {
      const summary = await runHTTPSmokeProbe(args);
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
