#!/usr/bin/env node

import { createServer } from "node:http";
import crypto from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

import { loadDeepResponseEnv, requireDeepResponseCredentials } from "./deep-response/lib/env.mjs";
import { DoubaoASRProvider } from "./deep-response/providers/doubao-asr.mjs";
import { ArkLLMProvider } from "./deep-response/providers/ark-llm.mjs";
import { DoubaoTTSProvider } from "./deep-response/providers/doubao-tts.mjs";
import { VoicePipeline } from "./deep-response/pipeline/voice-pipeline.mjs";

export async function startDeepResponseServer({
  port = Number(process.env.PORT || process.env.DEEP_RESPONSE_PORT || 8797),
  host = "0.0.0.0",
  mode = process.env.DEEP_RESPONSE_MODE || "echo",
  log = true,
  env = loadDeepResponseEnv(),
  createPipeline = null,
  audioReplayIntervalMs = Number(process.env.DEEP_RESPONSE_AUDIO_REPLAY_INTERVAL_MS ?? env.DEEP_RESPONSE_AUDIO_REPLAY_INTERVAL_MS ?? 0)
} = {}) {
  const events = [];
  const httpSessions = new Map();
  const recordEvent = (type, details = {}) => {
    const event = {
      at: new Date().toISOString(),
      type,
      ...details
    };
    events.push(event);
    if (events.length > 200) {
      events.shift();
    }
    return event;
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      recordEvent("health", {
        remoteAddress: request.socket.remoteAddress || "unknown",
        userAgent: request.headers["user-agent"] || ""
      });
      if (log) {
        console.log(`DeepResponse health from ${request.socket.remoteAddress || "unknown"}`);
      }
      sendJSON(response, 200, {
        ok: true,
        service: "deep-response",
        mode,
        providerConfigured: Boolean(env.ARK_API_KEY && env.DOUBAO_SPEECH_APP_ID && env.DOUBAO_SPEECH_ACCESS_TOKEN)
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/debug/events") {
      sendJSON(response, 200, {
        ok: true,
        events: events.slice(-100)
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/debug/config") {
      sendJSON(response, 200, {
        ok: true,
        mode,
        audioReplayIntervalMs,
        firstPhraseMode: env.DEEP_RESPONSE_FIRST_PHRASE_MODE || "llm",
        arkModel: env.ARK_MODEL || "",
        arkFallbackModel: env.ARK_FALLBACK_MODEL || "",
        asrModelName: env.DOUBAO_ASR_MODEL_NAME || "",
        asrEndWindowSizeMs: env.DOUBAO_ASR_END_WINDOW_SIZE_MS || "",
        ttsSpeakerID: env.DOUBAO_TTS_SPEAKER_ID || ""
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/debug/http-probe") {
      readRequestBody(request).then((body) => {
        recordEvent("http_probe", {
          bytes: body.length,
          remoteAddress: request.socket.remoteAddress || "unknown",
          userAgent: request.headers["user-agent"] || "",
          deepResponseClient: request.headers["x-deep-response-client"] || ""
        });
        sendJSON(response, 200, {
          ok: true,
          bytes: body.length
        });
      }).catch((error) => {
        sendJSON(response, 500, {
          error: error instanceof Error ? error.message : String(error)
        });
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/debug/http-echo") {
      readRequestBody(request).then((body) => {
        recordEvent("http_echo", {
          bytes: body.length,
          remoteAddress: request.socket.remoteAddress || "unknown",
          userAgent: request.headers["user-agent"] || "",
          deepResponseClient: request.headers["x-deep-response-client"] || ""
        });
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": body.length
        });
        response.end(body);
      }).catch((error) => {
        sendJSON(response, 500, {
          error: error instanceof Error ? error.message : String(error)
        });
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/deep-response/http-turn") {
      handleHTTPTurn(request, response, {
        mode,
        env,
        createPipeline,
        audioReplayIntervalMs,
        recordEvent
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/deep-response/http-turn-v2") {
      handleSegmentedHTTPTurn(request, response, {
        mode,
        env,
        createPipeline,
        audioReplayIntervalMs,
        recordEvent
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/deep-response/sessions") {
      handleHTTPSessionCreate(request, response, {
        sessions: httpSessions,
        env,
        recordEvent
      });
      return;
    }
    const sessionRoute = matchHTTPSessionRoute(url.pathname);
    if (sessionRoute) {
      handleHTTPSessionRoute(request, response, {
        url,
        route: sessionRoute,
        sessions: httpSessions,
        mode,
        env,
        createPipeline,
        audioReplayIntervalMs,
        recordEvent
      });
      return;
    }
    sendJSON(response, 404, { error: "not_found" });
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  if (log) {
    console.log(`DeepResponse server listening on http://${host}:${actualPort} mode=${mode}`);
  }
  return {
    port: actualPort,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function handleHTTPSessionCreate(request, response, { sessions, env = {}, recordEvent = () => {} }) {
  try {
    const body = await readJSONBody(request);
    const sessionID = body.sessionID || `drs_${crypto.randomUUID().replaceAll("-", "")}`;
    const pipelineMode = body.pipelineMode === "cascade" ? "cascade" : "";
    const idleTimeoutMs = Number(body.idleTimeoutMs || envNumber(process.env.DEEP_RESPONSE_SESSION_IDLE_TIMEOUT_MS, 0));
    const idleGoodbye = Boolean(body.idleGoodbye || truthyEnv(process.env.DEEP_RESPONSE_SESSION_IDLE_GOODBYE));
    const recalledMemory = await loadHTTPSessionMemoryContext(env);
    const session = {
      sessionID,
      state: "listening",
      pipelineMode,
      sampleRate: Number(body.sampleRate || 16000),
      idleTimeoutMs: Number.isFinite(idleTimeoutMs) && idleTimeoutMs > 0 ? idleTimeoutMs : 0,
      idleGoodbye,
      idleGoodbyeStarted: false,
      env,
      lastActivityAt: Date.now(),
      audioByTurn: new Map(),
      events: [],
      audio: [],
      history: recalledMemory.context,
      memoryCandidates: [],
      memoryCandidateScheduled: false,
      turnStreams: new Map(),
      nextEventSeq: 0,
      nextAudioSeq: 0,
      canceledGenerations: new Set(),
      activeGenerations: new Set()
    };
    sessions.set(sessionID, session);
    pushSessionEvent(session, {
      type: "session_ready",
      sessionID,
      state: session.state,
      sampleRate: session.sampleRate
    });
    if (recalledMemory.count > 0) {
      pushSessionEvent(session, {
        type: "memory_recalled",
        sessionID,
        count: recalledMemory.count,
        store: "jsonl"
      });
    }
    recordEvent("http_session_created", {
      sessionID,
      sampleRate: session.sampleRate,
      pipelineMode,
      memoryRecallCount: recalledMemory.count,
      remoteAddress: request.socket.remoteAddress || "unknown",
      userAgent: request.headers["user-agent"] || ""
    });
    sendJSON(response, 200, {
      ok: true,
      sessionID,
      state: session.state,
      sampleRate: session.sampleRate,
      idleTimeoutMs: session.idleTimeoutMs,
      idleGoodbye: session.idleGoodbye,
      pipelineMode,
      memoryRecallCount: recalledMemory.count
    });
  } catch (error) {
    sendJSON(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function loadHTTPSessionMemoryContext(env = {}) {
  const jsonlPath = env?.DEEP_RESPONSE_MEMORY_JSONL_PATH || process.env.DEEP_RESPONSE_MEMORY_JSONL_PATH || "";
  if (!jsonlPath) {
    return { count: 0, context: [] };
  }
  const recallLimit = clampNumber(
    Number(env?.DEEP_RESPONSE_MEMORY_RECALL_LIMIT || process.env.DEEP_RESPONSE_MEMORY_RECALL_LIMIT || 3),
    0,
    8
  );
  if (recallLimit <= 0) {
    return { count: 0, context: [] };
  }
  let text = "";
  try {
    text = await readFile(jsonlPath, "utf8");
  } catch {
    return { count: 0, context: [] };
  }
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((row) => row && typeof row.summary === "string" && row.summary.trim());
  const summaries = [];
  const seenSummaries = new Set();
  for (const row of rows.slice().reverse()) {
    const summary = sanitizeHTTPSessionMemorySummary(row.summary).slice(0, 600);
    if (!summary) {
      continue;
    }
    if (seenSummaries.has(summary)) {
      continue;
    }
    seenSummaries.add(summary);
    summaries.unshift(summary);
    if (summaries.length >= recallLimit) {
      break;
    }
  }
  if (summaries.length === 0) {
    return { count: 0, context: [] };
  }
  return {
    count: summaries.length,
    context: [{
      role: "system",
      content: `可参考的过往记忆（只在有帮助时用于理解用户，不要机械复述）：\n${summaries.map((summary) => `- ${summary}`).join("\n\n")}`.slice(0, 1800)
    }]
  };
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

function handleHTTPSessionRoute(request, response, options) {
  const { route, sessions } = options;
  const session = sessions.get(route.sessionID);
  if (!session) {
    sendJSON(response, 404, { ok: false, error: "session_not_found" });
    return;
  }

  if (request.method === "POST" && route.action === "audio") {
    handleHTTPSessionAudio(request, response, { ...options, session });
    return;
  }
  if (request.method === "POST" && route.action === "input-stop") {
    handleHTTPSessionInputStop(request, response, { ...options, session });
    return;
  }
  if (request.method === "POST" && route.action === "abort") {
    handleHTTPSessionAbort(request, response, { ...options, session });
    return;
  }
  if (request.method === "POST" && route.action === "end") {
    handleHTTPSessionEnd(request, response, { ...options, session });
    return;
  }
  if (request.method === "GET" && route.action === "events") {
    void handleHTTPSessionEvents(response, { ...options, session });
    return;
  }
  if (request.method === "GET" && route.action === "audio") {
    void handleHTTPSessionAudioPull(response, { ...options, session });
    return;
  }

  sendJSON(response, 404, { ok: false, error: "session_route_not_found" });
}

async function handleHTTPSessionAudio(request, response, options) {
  const {
    url,
    session,
    mode,
    env,
    createPipeline,
    audioReplayIntervalMs,
    recordEvent = () => {}
  } = options;
  if (session.state === "ended") {
    sendJSON(response, 409, { ok: false, sessionID: session.sessionID, error: "session_ended" });
    return;
  }
  session.lastActivityAt = Date.now();
  const encodedBody = await readRequestBody(request);
  const encoding = String(request.headers["content-encoding"] || "").toLowerCase();
  const body = encoding === "deflate" ? inflateSync(encodedBody) : encodedBody;
  const turnID = url.searchParams.get("turn_id")
    || String(request.headers["x-deep-response-turn"] || "")
    || "turn-1";
  const seq = Number(url.searchParams.get("seq")
    || request.headers["x-deep-response-seq"]
    || 0);
  const chunks = session.audioByTurn.get(turnID) || [];
  chunks.push(body);
  session.audioByTurn.set(turnID, chunks);
  session.state = "user_speaking";
  const turnStream = ensureHTTPSessionTurnStream({
    session,
    turnID,
    mode,
    env,
    createPipeline,
    audioReplayIntervalMs,
    recordEvent
  });
  turnStream?.queue.push(body);
  recordEvent("http_session_audio", {
    sessionID: session.sessionID,
    turnID,
    seq,
    bytes: body.byteLength,
    encodedBytes: encodedBody.byteLength,
    encoding
  });
  sendJSON(response, 200, {
    ok: true,
    sessionID: session.sessionID,
    turnID,
    seq,
    bytes: body.byteLength,
    encodedBytes: encodedBody.byteLength
  });
}

async function handleHTTPSessionInputStop(request, response, options) {
  const { session, recordEvent = () => {} } = options;
  if (session.state === "ended") {
    sendJSON(response, 409, { ok: false, sessionID: session.sessionID, error: "session_ended" });
    return;
  }
  const body = await readJSONBody(request);
  const turnID = body.turnID || "turn-1";
  const generationID = body.generationID || `gen_${crypto.randomUUID().replaceAll("-", "")}`;
  session.state = "assistant_thinking";
  session.lastActivityAt = Date.now();
  session.activeGenerations.add(generationID);
  pushSessionEvent(session, {
    type: "input_stop",
    sessionID: session.sessionID,
    turnID,
    generationID
  });
  recordEvent("http_session_input_stop", {
    sessionID: session.sessionID,
    turnID,
    generationID
  });
  const turnStream = session.turnStreams.get(turnID);
  if (turnStream) {
    turnStream.generationID = generationID;
    turnStream.generationReady.resolve(generationID);
    turnStream.queue.end();
    sendJSON(response, 200, {
      ok: true,
      sessionID: session.sessionID,
      turnID,
      generationID
    });
    return;
  }
  runHTTPSessionPipeline({ ...options, turnID, generationID }).catch((error) => {
    pushSessionEvent(session, {
      type: "error",
      sessionID: session.sessionID,
      turnID,
      generationID,
      message: error instanceof Error ? error.message : String(error)
    });
    recordEvent("http_session_failed", {
      sessionID: session.sessionID,
      turnID,
      generationID,
      message: error instanceof Error ? error.message : String(error)
    });
  });
  sendJSON(response, 200, {
    ok: true,
    sessionID: session.sessionID,
    turnID,
    generationID
  });
}

async function handleHTTPSessionAbort(request, response, { session, recordEvent = () => {} }) {
  const body = await readJSONBody(request);
  const turnID = body.turnID || "";
  const generationID = body.generationID || "";
  if (generationID) {
    session.canceledGenerations.add(generationID);
    session.activeGenerations.delete(generationID);
  }
  session.state = "listening";
  session.lastActivityAt = Date.now();
  pushSessionEvent(session, {
    type: "abort",
    sessionID: session.sessionID,
    turnID,
    generationID,
    reason: body.reason || "client_abort"
  });
  recordEvent("http_session_abort", {
    sessionID: session.sessionID,
    turnID,
    generationID,
    reason: body.reason || "client_abort"
  });
  sendJSON(response, 200, {
    ok: true,
    sessionID: session.sessionID,
    turnID,
    generationID,
    staleAudioDropped: true
  });
}

async function handleHTTPSessionEnd(request, response, { session, recordEvent = () => {} }) {
  const body = await readJSONBody(request);
  endHTTPSession(session, { reason: body.reason || "client_end", recordEvent });
  sendJSON(response, 200, {
    ok: true,
    sessionID: session.sessionID,
    state: session.state
  });
}

function ensureHTTPSessionTurnStream({
  session,
  turnID,
  mode,
  env,
  createPipeline,
  audioReplayIntervalMs,
  recordEvent = () => {}
}) {
  if (mode === "echo") {
    return null;
  }
  const existing = session.turnStreams.get(turnID);
  if (existing) {
    return existing;
  }

  const pipeline = createPipeline ? createPipeline() : createDefaultPipeline(env);
  if (!selectHTTPSessionStream(pipeline, {
    env,
    context: [],
    audioChunks: [],
    turnID
  })) {
    return null;
  }

  const turnStream = {
    queue: new AsyncChunkQueue(),
    generationID: "",
    generationReady: deferred()
  };
  session.turnStreams.set(turnID, turnStream);
  const stream = selectHTTPSessionStream(pipeline, {
    session,
    env,
    context: session.history.slice(),
    audioChunks: replayChunks(rechunkPCM16Async(turnStream.queue, {
      sampleRate: session.sampleRate || 16_000,
      chunkMs: 100
    }), audioReplayIntervalMs),
    turnID,
    generationID: turnStream.generationReady.promise
  });

  runHTTPSessionStreamedPipeline({
    session,
    turnID,
    generationID: turnStream.generationReady.promise,
    stream,
    recordEvent
  }).catch((error) => {
    pushSessionEvent(session, {
      type: "error",
      sessionID: session.sessionID,
      turnID,
      generationID: turnStream.generationID,
      message: error instanceof Error ? error.message : String(error)
    });
    recordEvent("http_session_failed", {
      sessionID: session.sessionID,
      turnID,
      generationID: turnStream.generationID,
      message: error instanceof Error ? error.message : String(error)
    });
  }).finally(() => {
    session.turnStreams.delete(turnID);
  });
  return turnStream;
}

async function handleHTTPSessionEvents(response, { url, session, createPipeline, env, recordEvent = () => {} }) {
  const cursor = Number(url.searchParams.get("cursor") || 0);
  const waitMs = parseHTTPSessionWaitMs(url);
  const selected = await waitForHTTPSessionEvents(session, cursor, waitMs, { recordEvent, createPipeline, env });
  const nextCursor = selected.length > 0 ? selected.at(-1).seq + 1 : cursor;
  sendJSON(response, 200, {
    ok: true,
    sessionID: session.sessionID,
    cursor,
    nextCursor,
    events: selected
  });
}

async function handleHTTPSessionAudioPull(response, { url, session, createPipeline, env, recordEvent = () => {} }) {
  const cursor = Number(url.searchParams.get("cursor") || 0);
  const generationID = url.searchParams.get("generation_id") || "";
  const waitMs = parseHTTPSessionWaitMs(url);
  const selected = await waitForHTTPSessionAudio(session, cursor, generationID, waitMs, { recordEvent, createPipeline, env });
  const nextCursor = selected.length > 0 ? selected.at(-1).seq + 1 : cursor;
  sendJSON(response, 200, {
    ok: true,
    sessionID: session.sessionID,
    cursor,
    nextCursor,
    chunks: selected
  });
}

function parseHTTPSessionWaitMs(url) {
  const raw = Number(url.searchParams.get("wait_ms") || 0);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  return Math.min(Math.round(raw), 1_000);
}

async function waitForHTTPSessionEvents(session, cursor, waitMs, options = {}) {
  const startedAt = Date.now();
  while (true) {
    await maybeEndIdleHTTPSession(session, options);
    const selected = selectHTTPSessionEvents(session, cursor);
    if (selected.length > 0 || Date.now() - startedAt >= waitMs) {
      return selected;
    }
    await sleep(Math.min(20, waitMs - (Date.now() - startedAt)));
  }
}

async function waitForHTTPSessionAudio(session, cursor, generationID, waitMs, options = {}) {
  const startedAt = Date.now();
  while (true) {
    await maybeEndIdleHTTPSession(session, options);
    const selected = selectHTTPSessionAudio(session, cursor, generationID);
    if (selected.length > 0 || Date.now() - startedAt >= waitMs) {
      return selected;
    }
    await sleep(Math.min(20, waitMs - (Date.now() - startedAt)));
  }
}

function selectHTTPSessionEvents(session, cursor) {
  return session.events.filter((event) => event.seq >= cursor);
}

function selectHTTPSessionAudio(session, cursor, generationID) {
  return session.audio
    .filter((chunk) => chunk.seq >= cursor)
    .filter((chunk) => !generationID || chunk.generationID === generationID)
    .filter((chunk) => !session.canceledGenerations.has(chunk.generationID));
}

async function runHTTPSessionPipeline({
  session,
  turnID,
  generationID,
  mode,
  env,
  createPipeline,
  audioReplayIntervalMs,
  recordEvent = () => {}
}) {
  const inputChunks = session.audioByTurn.get(turnID) || [];
  const providerInputChunks = chunkPCM16(Buffer.concat(inputChunks.map((chunk) => Buffer.from(chunk))), {
    sampleRate: session.sampleRate || 16_000,
    chunkMs: 100
  });
  let result;
  if (mode === "echo") {
    const audio = Buffer.concat(inputChunks.map((chunk) => Buffer.from(chunk)));
    result = {
      transcript: "",
      first: {
        text: "echo",
        audioChunks: [audio],
        audioByteLength: audio.byteLength
      },
      followup: { text: "", audioChunks: [], audioByteLength: 0 },
      timing: {},
      providerMeta: { mode: "echo" }
    };
  } else {
    const pipeline = createPipeline ? createPipeline() : createDefaultPipeline(env);
    const stream = selectHTTPSessionStream(pipeline, {
      session,
      env,
      context: session.history.slice(),
      audioChunks: replayChunks(providerInputChunks, audioReplayIntervalMs),
      turnID,
      generationID
    });
    if (stream) {
      await runHTTPSessionStreamedPipeline({
        session,
        turnID,
        generationID,
        stream,
        recordEvent
      });
      return;
    }
    if (typeof pipeline.runSegmented === "function") {
      result = await pipeline.runSegmented({
        context: session.history.slice(),
        audioChunks: replayChunks(providerInputChunks, audioReplayIntervalMs)
      });
    } else {
      const fallback = await pipeline.run({
        context: session.history.slice(),
        audioChunks: replayChunks(providerInputChunks, audioReplayIntervalMs)
      });
      result = {
        transcript: fallback.transcript || "",
        first: {
          text: fallback.firstPhrase || fallback.responseText || "",
          audioChunks: fallback.audioChunks || [],
          audioByteLength: fallback.audioByteLength || 0
        },
        followup: { text: "", audioChunks: [], audioByteLength: 0 },
        timing: fallback.timing || {},
        providerMeta: fallback.providerMeta || {}
      };
    }
  }

  if (session.canceledGenerations.has(generationID)) {
    recordEvent("http_session_stale_dropped", {
      sessionID: session.sessionID,
      turnID,
      generationID
    });
    return;
  }

  session.state = "assistant_speaking";
  pushSessionEvent(session, {
    type: "transcript_final",
    sessionID: session.sessionID,
    turnID,
    generationID,
    text: result.transcript || ""
  });
  pushAssistantSegment(session, {
    turnID,
    generationID,
    segment: "first",
    text: result.first?.text || "",
    audioChunks: result.first?.audioChunks || []
  });
  pushAssistantSegment(session, {
    turnID,
    generationID,
    segment: "followup",
    text: result.followup?.text || "",
    audioChunks: result.followup?.audioChunks || []
  });
  pushSessionEvent(session, {
    type: "audio_done",
    sessionID: session.sessionID,
    turnID,
    generationID,
    reason: "provider_complete"
  });
  pushSessionEvent(session, {
    type: "timing",
    sessionID: session.sessionID,
    turnID,
    generationID,
    timing: result.timing || {},
    providerMeta: result.providerMeta || {}
  });
  pushSessionEvent(session, {
    type: "turn_done",
    sessionID: session.sessionID,
    turnID,
    generationID,
    transcript: result.transcript || "",
    assistantText: [result.first?.text || "", result.followup?.text || ""].filter(Boolean).join(" ")
  });
  appendSessionHistory(session, {
    transcript: result.transcript || "",
    assistantText: [result.first?.text || "", result.followup?.text || ""].filter(Boolean).join(" ")
  });
  session.activeGenerations.delete(generationID);
  session.state = "listening";
  session.lastActivityAt = Date.now();
  if (isGoodbyeTranscript(result.transcript)) {
    endHTTPSession(session, { reason: "user_goodbye_intent", turnID, generationID, recordEvent });
  }
  recordEvent("http_session_complete", {
    sessionID: session.sessionID,
    turnID,
    generationID,
    transcript: result.transcript || "",
    firstText: result.first?.text || "",
    followupText: result.followup?.text || "",
    audioChunks: session.audio.length,
    timing: result.timing || {}
  });
}

async function runHTTPSessionStreamedPipeline({
  session,
  turnID,
  generationID,
  stream,
  recordEvent = () => {}
}) {
  session.state = "assistant_speaking";
  let transcript = "";
  let firstText = "";
  let followupText = "";
  let timing = {};
  let providerMeta = {};
  let resolvedGenerationID = "";
  const getGenerationID = async () => {
    if (!resolvedGenerationID) {
      resolvedGenerationID = typeof generationID?.then === "function" ? await generationID : generationID;
    }
    return resolvedGenerationID;
  };

  for await (const event of stream) {
    const eventGenerationID = await getGenerationID();
    if (session.canceledGenerations.has(eventGenerationID)) {
      recordEvent("http_session_stale_dropped", {
        sessionID: session.sessionID,
        turnID,
        generationID: eventGenerationID
      });
      return;
    }

    if (event.type === "transcript_final") {
      transcript = event.transcript || event.text || "";
      pushSessionEvent(session, {
        type: "transcript_final",
        sessionID: session.sessionID,
        turnID,
        generationID: eventGenerationID,
        text: transcript
      });
    } else if (event.type === "transcript_partial") {
      pushSessionEvent(session, {
        type: "transcript_partial",
        sessionID: session.sessionID,
        turnID,
        generationID: eventGenerationID,
        text: event.transcript || event.text || ""
      });
    } else if (event.type === "assistant_text_delta") {
      firstText += event.delta || "";
      pushSessionEvent(session, {
        type: "assistant_text_delta",
        sessionID: session.sessionID,
        turnID,
        generationID: eventGenerationID,
        segment: event.segment || "reply",
        delta: event.delta || ""
      });
    } else if (event.type === "assistant_phrase") {
      pushSessionEvent(session, {
        type: "assistant_phrase",
        sessionID: session.sessionID,
        turnID,
        generationID: eventGenerationID,
        segment: event.segment || "reply",
        phraseIndex: event.phraseIndex,
        text: event.text || "",
        reason: event.reason || ""
      });
    } else if (event.type === "segment") {
      if (event.segment === "followup") {
        followupText = event.text || "";
      } else {
        firstText = event.text || "";
      }
      pushAssistantSegment(session, {
        turnID,
        generationID: eventGenerationID,
        segment: event.segment || "first",
        text: event.text || "",
        audioChunks: event.audioChunks || []
      });
    } else if (event.type === "segment_text") {
      if (event.segment === "followup") {
        followupText = event.text || "";
      } else {
        firstText = event.text || "";
      }
      pushAssistantSegment(session, {
        turnID,
        generationID: eventGenerationID,
        segment: event.segment || "first",
        text: event.text || "",
        audioChunks: []
      });
    } else if (event.type === "audio_chunk") {
      pushSessionAudio(session, {
        turnID,
        generationID: eventGenerationID,
        segment: event.segment || "reply",
        audio: Buffer.from(event.audioChunk || []),
        sampleRate: event.sampleRate
      });
    } else if (event.type === "timing") {
      timing = event.timing || {};
      providerMeta = event.providerMeta || {};
    } else if (event.type === "turn_done") {
      transcript = event.transcript || transcript;
      firstText = event.assistantText || firstText;
    }
  }

  const eventGenerationID = await getGenerationID();
  pushSessionEvent(session, {
    type: "audio_done",
    sessionID: session.sessionID,
    turnID,
    generationID: eventGenerationID,
    reason: "provider_complete"
  });
  pushSessionEvent(session, {
    type: "timing",
    sessionID: session.sessionID,
    turnID,
    generationID: eventGenerationID,
    timing,
    providerMeta
  });
  pushSessionEvent(session, {
    type: "turn_done",
    sessionID: session.sessionID,
    turnID,
    generationID: eventGenerationID,
    transcript,
    assistantText: [firstText, followupText].filter(Boolean).join(" ")
  });
  appendSessionHistory(session, {
    transcript,
    assistantText: [firstText, followupText].filter(Boolean).join(" ")
  });
  session.activeGenerations.delete(eventGenerationID);
  session.state = "listening";
  session.lastActivityAt = Date.now();
  if (isGoodbyeTranscript(transcript)) {
    endHTTPSession(session, { reason: "user_goodbye_intent", turnID, generationID: eventGenerationID, recordEvent });
  }
  recordEvent("http_session_complete", {
    sessionID: session.sessionID,
    turnID,
    generationID: eventGenerationID,
    transcript,
    firstText,
    followupText,
    audioChunks: session.audio.length,
    timing
  });
}

function selectHTTPSessionStream(pipeline, { session, env, context, audioChunks, turnID, generationID }) {
  const cascadeRequested = session?.pipelineMode === "cascade" || env?.DEEP_RESPONSE_SESSION_PIPELINE_MODE === "cascade";
  if (cascadeRequested && typeof pipeline.streamCascadeTurn === "function") {
    return pipeline.streamCascadeTurn({
      context,
      audioChunks,
      turnID,
      generationID,
      phraseMaxChars: Number(env.DEEP_RESPONSE_CASCADE_PHRASE_MAX_CHARS || 28),
      minSpokenReplyChars: Number(env.DEEP_RESPONSE_CASCADE_MIN_SPOKEN_CHARS || 8)
    });
  }
  if (typeof pipeline.streamSegmented === "function") {
    return pipeline.streamSegmented({
      context,
      audioChunks
    });
  }
  return null;
}

function appendSessionHistory(session, { transcript, assistantText }) {
  const userText = String(transcript || "").trim();
  const responseText = String(assistantText || "").trim();
  if (userText) {
    session.history.push({ role: "user", content: userText });
  }
  if (responseText) {
    session.history.push({ role: "assistant", content: responseText });
  }
  if (session.history.length > 20) {
    session.history = session.history.slice(-20);
  }
}

async function maybeEndIdleHTTPSession(session, {
  createPipeline,
  env = {},
  recordEvent = () => {}
} = {}) {
  if (session.state !== "listening" || !session.idleTimeoutMs || session.activeGenerations.size > 0) {
    return false;
  }
  if (Date.now() - Number(session.lastActivityAt || 0) < session.idleTimeoutMs) {
    return false;
  }
  if (session.idleGoodbye && !session.idleGoodbyeStarted) {
    session.idleGoodbyeStarted = true;
    await speakIdleGoodbye(session, { createPipeline, env, recordEvent });
    return true;
  }
  endHTTPSession(session, { reason: "idle_timeout", recordEvent });
  return true;
}

async function speakIdleGoodbye(session, {
  createPipeline,
  env = {},
  recordEvent = () => {}
} = {}) {
  const turnID = `turn_idle_${crypto.randomUUID().replaceAll("-", "")}`;
  const generationID = `gen_idle_${crypto.randomUUID().replaceAll("-", "")}`;
  const text = env.DEEP_RESPONSE_IDLE_GOODBYE_TEXT || "我先安静到这里，愿你平安。拜拜。";
  let timing = {};
  session.state = "assistant_speaking";
  session.activeGenerations.add(generationID);
  pushSessionEvent(session, {
    type: "assistant_text_delta",
    sessionID: session.sessionID,
    turnID,
    generationID,
    segment: "idle_goodbye",
    delta: text
  });
  pushSessionEvent(session, {
    type: "assistant_phrase",
    sessionID: session.sessionID,
    turnID,
    generationID,
    segment: "idle_goodbye",
    phraseIndex: 0,
    text,
    reason: "idle_timeout"
  });

  try {
    const pipeline = createPipeline ? createPipeline() : createDefaultPipeline(env);
    const tts = pipeline?.tts;
    if (tts && typeof tts.synthesizeStream === "function") {
      for await (const event of tts.synthesizeStream({ text })) {
        if (event.type === "audio_chunk") {
          pushSessionAudio(session, {
            turnID,
            generationID,
            segment: "idle_goodbye",
            audio: Buffer.from(event.audioChunk || []),
            sampleRate: event.sampleRate
          });
        } else if (event.type === "done") {
          timing = event.timing || timing;
        }
      }
    } else if (tts && typeof tts.synthesize === "function") {
      const result = await tts.synthesize({ text });
      timing = result.timing || {};
      for (const chunk of result.audioChunks || []) {
        pushSessionAudio(session, {
          turnID,
          generationID,
          segment: "idle_goodbye",
          audio: Buffer.from(chunk),
          sampleRate: result.sampleRate
        });
      }
    }
  } catch (error) {
    pushSessionEvent(session, {
      type: "error",
      sessionID: session.sessionID,
      turnID,
      generationID,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  pushSessionEvent(session, {
    type: "audio_done",
    sessionID: session.sessionID,
    turnID,
    generationID,
    reason: "idle_goodbye_complete"
  });
  pushSessionEvent(session, {
    type: "timing",
    sessionID: session.sessionID,
    turnID,
    generationID,
    timing: {
      ...timing,
      idle_goodbye: 1
    },
    providerMeta: { kind: "idle_goodbye" }
  });
  pushSessionEvent(session, {
    type: "turn_done",
    sessionID: session.sessionID,
    turnID,
    generationID,
    transcript: "",
    assistantText: text
  });
  appendSessionHistory(session, {
    transcript: "",
    assistantText: text
  });
  session.activeGenerations.delete(generationID);
  session.state = "listening";
  endHTTPSession(session, { reason: "idle_timeout", turnID, generationID, recordEvent });
  recordEvent("http_session_idle_goodbye", {
    sessionID: session.sessionID,
    turnID,
    generationID,
    audioChunks: session.audio.filter((chunk) => chunk.generationID === generationID).length
  });
}

function endHTTPSession(session, {
  reason,
  turnID = "",
  generationID = "",
  recordEvent = () => {}
} = {}) {
  if (session.state === "ended") {
    return false;
  }
  const endedReason = reason || "client_end";
  session.state = "ended";
  session.endedReason = endedReason;
  session.lastActivityAt = Date.now();
  session.activeGenerations.clear();
  pushSessionEvent(session, {
    type: "session_end",
    sessionID: session.sessionID,
    turnID,
    generationID,
    reason: endedReason
  });
  recordEvent("http_session_end", {
    sessionID: session.sessionID,
    turnID,
    generationID,
    reason: endedReason
  });
  scheduleHTTPSessionMemoryCandidate(session, {
    reason: endedReason,
    turnID,
    generationID,
    recordEvent
  });
  return true;
}

function scheduleHTTPSessionMemoryCandidate(session, {
  reason,
  turnID = "",
  generationID = "",
  recordEvent = () => {}
} = {}) {
  if (session.memoryCandidateScheduled || session.history.length === 0) {
    return false;
  }
  session.memoryCandidateScheduled = true;
  const history = session.history.slice();
  setTimeout(async () => {
    const candidate = buildHTTPSessionMemoryCandidate(session, {
      history,
      reason,
      turnID,
      generationID
    });
    const persisted = await persistHTTPSessionMemoryCandidate(session, candidate);
    const eventCandidate = {
      ...candidate,
      persisted: persisted.persisted,
      store: persisted.store,
      path: persisted.path,
      persistError: persisted.error
    };
    session.memoryCandidates.push(eventCandidate);
    pushSessionEvent(session, {
      type: "memory_candidate",
      sessionID: session.sessionID,
      turnID,
      generationID,
      reason,
      summary: eventCandidate.summary,
      turnCount: eventCandidate.turnCount,
      persisted: eventCandidate.persisted,
      store: eventCandidate.store,
      path: eventCandidate.path,
      persistError: eventCandidate.persistError
    });
    recordEvent("http_session_memory_candidate", {
      sessionID: session.sessionID,
      reason,
      turnCount: eventCandidate.turnCount,
      summaryLength: eventCandidate.summary.length,
      persisted: eventCandidate.persisted,
      store: eventCandidate.store || ""
    });
  }, 0);
  return true;
}

async function persistHTTPSessionMemoryCandidate(session, candidate) {
  const jsonlPath = session.env?.DEEP_RESPONSE_MEMORY_JSONL_PATH || process.env.DEEP_RESPONSE_MEMORY_JSONL_PATH || "";
  if (!jsonlPath) {
    return { persisted: false };
  }
  try {
    const persistedCandidate = {
      ...candidate,
      persisted: true,
      store: "jsonl",
      path: jsonlPath
    };
    await appendFile(jsonlPath, `${JSON.stringify(persistedCandidate)}\n`, "utf8");
    return {
      persisted: true,
      store: "jsonl",
      path: jsonlPath
    };
  } catch (error) {
    return {
      persisted: false,
      store: "jsonl",
      path: jsonlPath,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function buildHTTPSessionMemoryCandidate(session, {
  history,
  reason,
  turnID = "",
  generationID = ""
} = {}) {
  const entries = (history || [])
    .filter((entry) => entry?.role === "user" || entry?.role === "assistant")
    .slice(-12);
  const summary = entries
    .map((entry) => {
      const label = entry.role === "assistant" ? "AI" : "User";
      return `${label}: ${String(entry.content || "").trim()}`;
    })
    .filter((line) => !line.endsWith(":"))
    .join("\n")
    .split("\n")
    .filter((line) => !isLookupStyleComfortLine(line))
    .filter((line) => !isSessionClosureMemoryLine(line))
    .join("\n")
    .slice(0, 1200);
  return {
    sessionID: session.sessionID,
    reason: reason || "session_end",
    turnID,
    generationID,
    summary,
    turnCount: Math.ceil(entries.length / 2),
    persisted: false,
    createdAt: new Date().toISOString()
  };
}

function sanitizeHTTPSessionMemorySummary(summary) {
  return String(summary || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !isLookupStyleComfortLine(line))
    .filter((line) => !isSessionClosureMemoryLine(line))
    .join("\n")
    .trim();
}

function isLookupStyleComfortLine(line) {
  return /给你(找|读)一句|再给你(找|读)一句|再找一句|你还想听|你还是想听|你又想听|喊累|没说完|只说.*想听|是还想听|你(?:今天)?还是(?:觉得|有点)?累|你又累|你又(?:觉得|感到)(?:累|疲惫)/u.test(String(line || ""));
}

function isSessionClosureMemoryLine(line) {
  const content = String(line || "")
    .replace(/^(?:User|AI):\s*/u, "")
    .trim();
  if (!content) {
    return false;
  }
  if (/^我先安静到这里[，,。 ]*愿你平安[。.!！ ]*拜拜[。.!！ ]*$/u.test(content)) {
    return true;
  }
  return /^(好的[，,。 ]*)?(拜拜|再见|不聊了|先这样|结束(对话|会话)?|bye|goodbye)[。.!！ ]*$/iu.test(content);
}

function isGoodbyeTranscript(transcript) {
  const text = String(transcript || "").trim();
  if (!text) {
    return false;
  }
  return /(拜拜|再见|不聊了|先这样|结束(对话|会话)?|bye|goodbye)/i.test(text);
}

function pushAssistantSegment(session, { turnID, generationID, segment, text, audioChunks }) {
  if (text) {
    pushSessionEvent(session, {
      type: "assistant_text_delta",
      sessionID: session.sessionID,
      turnID,
      generationID,
      segment,
      delta: text
    });
  }
  for (const chunk of audioChunks || []) {
    pushSessionAudio(session, {
      turnID,
      generationID,
      segment,
      audio: Buffer.from(chunk)
    });
  }
}

function pushSessionEvent(session, event) {
  const seq = session.nextEventSeq;
  session.nextEventSeq += 1;
  session.events.push({ seq, at: new Date().toISOString(), ...event });
}

function pushSessionAudio(session, { turnID, generationID, segment, audio, sampleRate = 24000 }) {
  const seq = session.nextAudioSeq;
  session.nextAudioSeq += 1;
  session.audio.push({
    seq,
    turnID,
    generationID,
    segment,
    audioBase64: Buffer.from(audio).toString("base64"),
    audioByteLength: audio.byteLength,
    sampleRate
  });
}

function matchHTTPSessionRoute(pathname) {
  const match = pathname.match(/^\/deep-response\/sessions\/([^/]+)\/([^/]+)$/);
  if (!match) {
    return null;
  }
  return {
    sessionID: decodeURIComponent(match[1]),
    action: match[2]
  };
}

async function handleHTTPTurn(request, response, { mode, env, createPipeline, audioReplayIntervalMs, recordEvent = () => {} }) {
  try {
    const body = await readRequestBody(request);
    const sessionID = request.headers["x-deep-response-session"] || "";
    recordEvent("http_turn", {
      bytes: body.length,
      remoteAddress: request.socket.remoteAddress || "unknown",
      userAgent: request.headers["user-agent"] || "",
      deepResponseClient: request.headers["x-deep-response-client"] || "",
      sessionID
    });

    if (mode === "echo") {
      recordEvent("http_turn_complete", {
        audioByteLength: body.length,
        sessionID,
        mode: "echo"
      });
      sendJSON(response, 200, {
        ok: true,
        sessionID,
        transcript: "",
        text: "echo",
        audioBase64: body.toString("base64"),
        audioByteLength: body.length,
        sampleRate: 16000,
        timing: {},
        providerMeta: { mode: "echo" }
      });
      return;
    }

    const pipeline = createPipeline ? createPipeline() : createDefaultPipeline(env);
    const result = await pipeline.run({
      audioChunks: replayChunks(chunkPCM16(body, {
        sampleRate: Number(env.DOUBAO_ASR_SAMPLE_RATE || 16000),
        chunkMs: 100
      }), audioReplayIntervalMs)
    });
    const audio = Buffer.concat((result.audioChunks || []).map((chunk) => Buffer.from(chunk)));
    recordEvent("http_turn_complete", {
      audioByteLength: audio.length,
      sessionID,
      transcript: result.transcript || "",
      text: result.firstPhrase || result.responseText || "",
      timing: result.timing || {}
    });
    sendJSON(response, 200, {
      ok: true,
      sessionID,
      transcript: result.transcript || "",
      text: result.firstPhrase || result.responseText || "",
      audioBase64: audio.toString("base64"),
      audioByteLength: result.audioByteLength ?? audio.length,
      sampleRate: Number(env.DOUBAO_TTS_SAMPLE_RATE || 24000),
      timing: result.timing || {},
      providerMeta: result.providerMeta || {}
    });
  } catch (error) {
    recordEvent("http_turn_failed", {
      message: error instanceof Error ? error.message : String(error)
    });
    sendJSON(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleSegmentedHTTPTurn(request, response, { mode, env, createPipeline, audioReplayIntervalMs, recordEvent = () => {} }) {
  try {
    const body = await readRequestBody(request);
    const sessionID = request.headers["x-deep-response-session"] || "";
    recordEvent("http_turn_v2", {
      bytes: body.length,
      remoteAddress: request.socket.remoteAddress || "unknown",
      userAgent: request.headers["user-agent"] || "",
      deepResponseClient: request.headers["x-deep-response-client"] || "",
      sessionID
    });

    if (mode === "echo") {
      const first = body.subarray(0, Math.ceil(body.length / 2));
      const followup = body.subarray(first.length);
      recordEvent("http_turn_v2_complete", {
        audioByteLength: body.length,
        sessionID,
        mode: "echo"
      });
      sendJSON(response, 200, {
        ok: true,
        sessionID,
        transcript: "",
        segments: [
          buildHTTPSegment("first", "echo first", first),
          buildHTTPSegment("followup", "echo followup", followup)
        ],
        audioByteLength: body.length,
        sampleRate: 16000,
        timing: {},
        providerMeta: { mode: "echo" }
      });
      return;
    }

    const pipeline = createPipeline ? createPipeline() : createDefaultPipeline(env);
    const result = await pipeline.runSegmented({
      audioChunks: replayChunks(chunkPCM16(body, {
        sampleRate: Number(env.DOUBAO_ASR_SAMPLE_RATE || 16000),
        chunkMs: 100
      }), audioReplayIntervalMs)
    });
    const firstAudio = Buffer.concat((result.first?.audioChunks || []).map((chunk) => Buffer.from(chunk)));
    const followupAudio = Buffer.concat((result.followup?.audioChunks || []).map((chunk) => Buffer.from(chunk)));
    const audioByteLength = firstAudio.length + followupAudio.length;
    recordEvent("http_turn_v2_complete", {
      audioByteLength,
      sessionID,
      transcript: result.transcript || "",
      firstText: result.first?.text || "",
      followupText: result.followup?.text || "",
      timing: result.timing || {}
    });
    sendJSON(response, 200, {
      ok: true,
      sessionID,
      transcript: result.transcript || "",
      segments: [
        buildHTTPSegment("first", result.first?.text || "", firstAudio),
        buildHTTPSegment("followup", result.followup?.text || "", followupAudio)
      ],
      audioByteLength,
      sampleRate: Number(env.DOUBAO_TTS_SAMPLE_RATE || 24000),
      timing: result.timing || {},
      providerMeta: result.providerMeta || {}
    });
  } catch (error) {
    recordEvent("http_turn_v2_failed", {
      message: error instanceof Error ? error.message : String(error)
    });
    sendJSON(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function buildHTTPSegment(kind, text, audio) {
  return {
    kind,
    text,
    audioBase64: Buffer.from(audio).toString("base64"),
    audioByteLength: audio.byteLength
  };
}

async function* replayChunks(chunks, intervalMs) {
  let isFirst = true;
  for await (const chunk of chunks || []) {
    if (!isFirst && intervalMs > 0) {
      await sleep(intervalMs);
    }
    isFirst = false;
    yield chunk;
  }
}

function* chunkPCM16(pcm, { sampleRate = 16_000, chunkMs = 100 } = {}) {
  const bytesPerChunk = Math.max(2, Math.round(sampleRate * chunkMs / 1_000) * 2);
  for (let offset = 0; offset < pcm.byteLength; offset += bytesPerChunk) {
    yield pcm.subarray(offset, Math.min(offset + bytesPerChunk, pcm.byteLength));
  }
}

async function* rechunkPCM16Async(chunks, { sampleRate = 16_000, chunkMs = 100 } = {}) {
  const bytesPerChunk = Math.max(2, Math.round(sampleRate * chunkMs / 1_000) * 2);
  let buffer = Buffer.alloc(0);
  for await (const chunk of chunks) {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (buffer.byteLength >= bytesPerChunk) {
      yield buffer.subarray(0, bytesPerChunk);
      buffer = buffer.subarray(bytesPerChunk);
    }
  }
  if (buffer.byteLength > 0) {
    yield buffer;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createDefaultPipeline(env) {
  requireDeepResponseCredentials(env);
  return new VoicePipeline({
    asr: new DoubaoASRProvider({ env }),
    llm: new ArkLLMProvider({ env }),
    tts: new DoubaoTTSProvider({ env }),
    firstPhraseMode: env.DEEP_RESPONSE_FIRST_PHRASE_MODE || "llm"
  });
}

function sendJSON(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
}

function envNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function truthyEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readJSONBody(request) {
  const body = await readRequestBody(request);
  if (body.byteLength === 0) {
    return {};
  }
  return JSON.parse(body.toString("utf8"));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

class AsyncChunkQueue {
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

export function isDirectRun(importMetaURL, scriptPath) {
  return Boolean(scriptPath) && importMetaURL === pathToFileURL(scriptPath).href;
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  startDeepResponseServer().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
