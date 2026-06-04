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
    idleGoodbye: false,
    maxStopToFirstAudioMs: 3_000,
    retries: 2,
    pipelineMode: "",
    expectAbortNextTurn: false,
    expectMemoryRecalled: false,
    expectMemoryPersisted: false,
    expectIdleMemoryPersisted: false,
    expectLLMStartedFromPartial: false,
    expectArkModel: "",
    expectArkFallbackModel: null,
    forbidIdenticalConsecutiveReplies: false,
    forbiddenTextPatterns: [],
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
    } else if (arg === "--idle-goodbye") {
      args.idleGoodbye = true;
    } else if (arg === "--max-stop-to-first-audio-ms") {
      args.maxStopToFirstAudioMs = Number(argv[index + 1] || args.maxStopToFirstAudioMs);
      index += 1;
    } else if (arg === "--retries") {
      args.retries = Number(argv[index + 1] || args.retries);
      index += 1;
    } else if (arg === "--pipeline-mode") {
      args.pipelineMode = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--expect-abort-next-turn") {
      args.expectAbortNextTurn = true;
    } else if (arg === "--expect-memory-recalled") {
      args.expectMemoryRecalled = true;
    } else if (arg === "--expect-memory-persisted") {
      args.expectMemoryPersisted = true;
    } else if (arg === "--expect-idle-memory-persisted") {
      args.expectIdleMemoryPersisted = true;
    } else if (arg === "--expect-llm-started-from-partial") {
      args.expectLLMStartedFromPartial = true;
    } else if (arg === "--expect-ark-model") {
      args.expectArkModel = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--expect-ark-fallback-model") {
      args.expectArkFallbackModel = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--forbid-identical-consecutive-replies") {
      args.forbidIdenticalConsecutiveReplies = true;
    } else if (arg === "--forbid-text-pattern") {
      args.forbiddenTextPatterns.push(argv[index + 1] || "");
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
  const debugConfig = await withRetries(() => fetchDebugConfig(args.endpoint), {
    attempts: args.retries + 1,
    label: "debug_config"
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
    ...(args.expectMemoryRecalled ? ["--expect-memory-recalled"] : []),
    ...(args.expectMemoryPersisted ? ["--expect-memory-persisted"] : []),
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
    ...(args.expectAbortNextTurn ? ["--expect-next-turn"] : []),
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
    pollMs: args.pollMs,
    idleGoodbye: args.idleGoodbye,
    expectMemoryPersisted: args.expectIdleMemoryPersisted
  }), {
    attempts: args.retries + 1,
    label: "idle"
  });

  const turnFailures = conversation.turns.filter((turn) => {
    return !turn.transcript
      || !turn.text
      || turn.audioChunks <= 0
      || turn.audioByteLength <= 0
      || turn.turnDone !== true
      || turn.stopToFirstAudioMs == null
      || turn.stopToFirstAudioMs > args.maxStopToFirstAudioMs;
  });
  const textFailures = collectForbiddenTextFailures(conversation.turns, args.forbiddenTextPatterns);
  const repeatedReplyFailures = args.forbidIdenticalConsecutiveReplies
    ? collectRepeatedReplyFailures(conversation.turns)
    : [];
  const partialStartFailures = args.expectLLMStartedFromPartial
    ? collectPartialStartFailures(conversation.turns)
    : [];
  const configFailures = collectDebugConfigFailures(debugConfig.body, args);

  return {
    ok: health.ok && debugConfig.ok && conversation.ok && abort.ok && idle.ok && turnFailures.length === 0 && textFailures.length === 0 && repeatedReplyFailures.length === 0 && partialStartFailures.length === 0 && configFailures.length === 0,
    endpoint: args.endpoint,
    thresholds: {
      maxStopToFirstAudioMs: args.maxStopToFirstAudioMs,
      pipelineMode: args.pipelineMode,
      waitMs: args.waitMs,
      idleTimeoutMs: args.idleTimeoutMs,
      idleGoodbye: args.idleGoodbye
    },
    health,
    debugConfig,
    conversation: {
      ok: conversation.ok,
      sessionID: conversation.sessionID,
      elapsedMs: conversation.elapsedMs,
      memoryRecalled: conversation.memoryRecalled ? {
        count: conversation.memoryRecalled.count,
        store: conversation.memoryRecalled.store
      } : null,
      memoryCandidate: conversation.memoryCandidate ? {
        persisted: conversation.memoryCandidate.persisted,
        store: conversation.memoryCandidate.store,
        turnCount: conversation.memoryCandidate.turnCount,
        endReason: conversation.memoryCandidate.endReason
      } : null,
      turns: conversation.turns.map((turn) => ({
        turnID: turn.turnID,
        generationID: turn.generationID,
        stopToFirstAudioMs: turn.stopToFirstAudioMs,
        transcript: turn.transcript,
        text: turn.text,
        audioDone: turn.audioDone,
        turnDone: turn.turnDone,
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
      eventTypes: abort.eventTypes,
      nextTurn: abort.nextTurn ? {
        ok: abort.nextTurn.ok,
        turnID: abort.nextTurn.turnID,
        generationID: abort.nextTurn.generationID,
        transcript: abort.nextTurn.transcript,
        text: abort.nextTurn.text,
        audioDone: abort.nextTurn.audioDone,
        turnDone: abort.nextTurn.turnDone,
        audioChunks: abort.nextTurn.audioChunks,
        audioBytes: abort.nextTurn.audioBytes
      } : null
    },
    idle,
    failures: [
      ...turnFailures.map((turn) => ({
        turnID: turn.turnID,
        stopToFirstAudioMs: turn.stopToFirstAudioMs,
        hasTranscript: Boolean(turn.transcript),
        hasText: Boolean(turn.text),
        audioDone: turn.audioDone,
        turnDone: turn.turnDone,
        audioChunks: turn.audioChunks,
        audioByteLength: turn.audioByteLength
      })),
      ...configFailures,
      ...partialStartFailures,
      ...repeatedReplyFailures,
      ...textFailures
    ]
  };
}

export function collectDebugConfigFailures(config = {}, args = {}) {
  const failures = [];
  if (args.expectArkModel && config.arkModel !== args.expectArkModel) {
    failures.push({
      configField: "arkModel",
      expected: args.expectArkModel,
      actual: config.arkModel ?? ""
    });
  }
  if (args.expectArkFallbackModel !== null && args.expectArkFallbackModel !== undefined && config.arkFallbackModel !== args.expectArkFallbackModel) {
    failures.push({
      configField: "arkFallbackModel",
      expected: args.expectArkFallbackModel,
      actual: config.arkFallbackModel ?? ""
    });
  }
  return failures;
}

export function collectForbiddenTextFailures(turns, forbiddenTextPatterns = []) {
  const patterns = forbiddenTextPatterns
    .filter(Boolean)
    .map((pattern) => ({ pattern, regex: new RegExp(pattern, "u") }));
  const failures = [];
  for (const turn of turns) {
    const text = String(turn.text || "");
    for (const { pattern, regex } of patterns) {
      if (regex.test(text)) {
        failures.push({
          turnID: turn.turnID,
          forbiddenPattern: pattern,
          text
        });
      }
    }
  }
  return failures;
}

export function collectPartialStartFailures(turns = []) {
  const failures = [];
  for (const turn of turns) {
    if (turn?.timing?.llm_started_from_partial !== 1) {
      failures.push({
        turnID: turn.turnID,
        expected: "llm_started_from_partial",
        actual: turn?.timing?.llm_started_from_partial == null ? "" : String(turn.timing.llm_started_from_partial)
      });
    }
  }
  return failures;
}

export function collectRepeatedReplyFailures(turns = []) {
  const failures = [];
  let previous = null;
  for (const turn of turns) {
    const text = String(turn.text || "").trim();
    const normalizedText = normalizeReplyText(text);
    if (previous && normalizedText && normalizedText === previous.normalizedText) {
      failures.push({
        turnID: turn.turnID,
        previousTurnID: previous.turnID,
        repeatedText: text
      });
    }
    if (normalizedText) {
      previous = {
        turnID: turn.turnID,
        normalizedText
      };
    }
  }
  return failures;
}

function normalizeReplyText(text) {
  return String(text || "")
    .replace(/\s+/gu, "")
    .replace(/[“”"'']/gu, "")
    .trim();
}

function hasClosureMemoryText(text) {
  return /我先安静到这里|愿你平安|拜拜|再见|结束对话|bye|goodbye/iu.test(String(text || ""));
}

export async function runHTTPIdleProbe({
  endpoint,
  idleTimeoutMs = 150,
  idleObserveMs = 2_000,
  pollMs = 50,
  idleGoodbye = false,
  expectMemoryPersisted = false
}) {
  const created = await postJSON(buildURL(endpoint, "/deep-response/sessions"), {
    sampleRate: 16_000,
    idleTimeoutMs,
    idleGoodbye
  });
  const basePath = `/deep-response/sessions/${encodeURIComponent(created.sessionID)}`;
  let eventCursor = 0;
  let audioCursor = 0;
  const events = [];
  const audioChunks = [];
  let memoryCandidate = null;
  const startedAt = performance.now();
  while (performance.now() - startedAt < idleObserveMs) {
    const eventBatch = await fetchJSON(buildURL(endpoint, `${basePath}/events?cursor=${eventCursor}`));
    eventCursor = eventBatch.nextCursor;
    events.push(...eventBatch.events);
    memoryCandidate = events.find((event) => event.type === "memory_candidate") || memoryCandidate;
    const audioBatch = await fetchJSON(buildURL(endpoint, `${basePath}/audio?cursor=${audioCursor}`));
    audioCursor = audioBatch.nextCursor;
    audioChunks.push(...audioBatch.chunks);
    if (
      events.some((event) => event.type === "session_end" && event.reason === "idle_timeout")
      && (!expectMemoryPersisted || memoryCandidate?.persisted === true)
    ) {
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
  const idleGoodbyeText = events
    .filter((event) => event.type === "assistant_text_delta" && event.segment === "idle_goodbye")
    .map((event) => event.delta || "")
    .join("");
  const sawIdleGoodbyeDone = events.some((event) => event.type === "audio_done" && event.reason === "idle_goodbye_complete");
  const idleGoodbyeOK = !idleGoodbye || (idleGoodbyeText.length > 0 && sawIdleGoodbyeDone && audioChunks.length > 0);
  const memoryClosureClean = !memoryCandidate || !hasClosureMemoryText(memoryCandidate.summary);
  const memoryOK = !expectMemoryPersisted || (memoryCandidate?.persisted === true && memoryClosureClean);
  return {
    ok: sawIdleEnd && rejected.status === 409 && rejectedBody?.error === "session_ended" && idleGoodbyeOK && memoryOK,
    sessionID: created.sessionID,
    elapsedMs: Math.round(performance.now() - startedAt),
    idleTimeoutMs,
    rejectedStatus: rejected.status,
    rejectedBody,
    eventTypes: events.map((event) => event.type),
    endReason: events.find((event) => event.type === "session_end")?.reason || "",
    idleGoodbye: {
      enabled: idleGoodbye,
      text: idleGoodbyeText,
      audioChunks: audioChunks.length,
      audioBytes: audioChunks.reduce((sum, chunk) => sum + Number(chunk.audioByteLength || 0), 0),
      done: sawIdleGoodbyeDone
    },
    memoryCandidate: memoryCandidate ? {
      persisted: memoryCandidate.persisted,
      store: memoryCandidate.store,
      reason: memoryCandidate.reason,
      turnCount: memoryCandidate.turnCount,
      summary: memoryCandidate.summary || "",
      closureClean: memoryClosureClean
    } : null,
    expectations: {
      memoryPersisted: expectMemoryPersisted,
      memoryClosureClean: idleGoodbye && expectMemoryPersisted
    }
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

async function fetchDebugConfig(endpoint) {
  const response = await fetch(buildURL(endpoint, "/debug/config"));
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }
  return {
    ok: response.status === 200 && body?.ok === true,
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
  --idle-goodbye                   Require idle timeout to emit a gentle goodbye text/audio before session_end.
  --max-stop-to-first-audio-ms <ms>
                                   Fail if any turn exceeds this stop-to-first-audio budget. Default: 3000
  --retries <n>                    Retry each top-level probe after transient network failures. Default: 2
  --pipeline-mode <m>              Optional HTTP session pipeline mode, e.g. cascade.
  --expect-abort-next-turn         Require abort probe to complete another turn in the same session.
  --expect-memory-recalled         Require conversation probe to recall persisted memory into context.
  --expect-memory-persisted        Require conversation probe to persist a memory candidate after /end.
  --expect-idle-memory-persisted   Require idle timeout probe to persist a memory candidate.
  --expect-llm-started-from-partial
                                   Require every conversation turn to start LLM from usable ASR partial.
  --expect-ark-model <model>       Require /debug/config arkModel to match.
  --expect-ark-fallback-model <model>
                                   Require /debug/config arkFallbackModel to match. Use "" for no fallback.
  --forbid-identical-consecutive-replies
                                   Fail if adjacent assistant replies in the same session are identical.
  --forbid-text-pattern <regex>    Fail if any assistant reply matches this regex. Repeatable.
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
