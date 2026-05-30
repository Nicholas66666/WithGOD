#!/usr/bin/env node

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import {
  DEEP_RESPONSE_EVENTS,
  encodeDeepResponseMessage,
  isDeepResponseRealtimePath,
  decodeDeepResponseMessage
} from "./deep-response/protocol/deep-response-protocol.mjs";
import { acceptWebSocketUpgrade } from "./deep-response/lib/server-websocket.mjs";
import { loadDeepResponseEnv, requireDeepResponseCredentials } from "./deep-response/lib/env.mjs";
import { DoubaoASRProvider } from "./deep-response/providers/doubao-asr.mjs";
import { ArkLLMProvider } from "./deep-response/providers/ark-llm.mjs";
import { DoubaoTTSProvider } from "./deep-response/providers/doubao-tts.mjs";
import { VoicePipeline } from "./deep-response/pipeline/voice-pipeline.mjs";

export async function startDeepResponseServer({
  port = Number(process.env.DEEP_RESPONSE_PORT || 8797),
  host = "0.0.0.0",
  mode = process.env.DEEP_RESPONSE_MODE || "echo",
  log = true,
  env = loadDeepResponseEnv(),
  createPipeline = null,
  audioReplayIntervalMs = Number(process.env.DEEP_RESPONSE_AUDIO_REPLAY_INTERVAL_MS || 100)
} = {}) {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && url.pathname === "/health") {
      sendJSON(response, 200, {
        ok: true,
        service: "deep-response",
        mode,
        providerConfigured: Boolean(env.ARK_API_KEY && env.DOUBAO_SPEECH_APP_ID && env.DOUBAO_SPEECH_ACCESS_TOKEN)
      });
      return;
    }
    sendJSON(response, 404, { error: "not_found" });
  });

  server.on("upgrade", (request, socket) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (!isDeepResponseRealtimePath(url.pathname)) {
      socket.destroy();
      return;
    }
    const ws = acceptWebSocketUpgrade(request, socket);
    if (!ws) {
      return;
    }
    handleRealtimeConnection(ws, { mode, env, createPipeline, audioReplayIntervalMs });
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

function handleRealtimeConnection(ws, { mode, env, createPipeline, audioReplayIntervalMs }) {
  if (mode === "echo") {
    handleEchoConnection(ws);
    return;
  }
  if (mode === "provider") {
    handleProviderConnection(ws, { env, createPipeline, audioReplayIntervalMs });
    return;
  }

    ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.Error, {
      code: "unsupported_mode",
      message: `Unsupported DeepResponse mode: ${mode}`
    }));
    ws.close();
}

function handleEchoConnection(ws) {
  const startedAt = performance.now();
  let turnID = 0;
  let chunksIn = 0;
  let chunksOut = 0;
  let bargeIns = 0;

  ws.onText = (text) => {
    let message;
    try {
      message = decodeDeepResponseMessage(text);
    } catch (error) {
      ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.Error, {
        code: "bad_message",
        message: error instanceof Error ? error.message : String(error)
      }));
      return;
    }

    if (message.type === DEEP_RESPONSE_EVENTS.SessionStart) {
      ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.SessionReady, {
        sessionID: message.sessionID || "",
        mode: "echo",
        sampleRate: message.sampleRate || 16000
      }));
    } else if (message.type === DEEP_RESPONSE_EVENTS.BargeIn) {
      turnID += 1;
      bargeIns += 1;
      ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.AudioDone, {
        reason: "barge_in",
        turnID
      }));
    } else if (message.type === DEEP_RESPONSE_EVENTS.InputStop) {
      ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.AudioDone, {
        reason: "input_stop",
        turnID
      }));
      ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.Timing, {
        timing: {
          voice_pipeline_total_ms: Math.round(performance.now() - startedAt),
          chunks_in: chunksIn,
          chunks_out: chunksOut,
          barge_ins: bargeIns
        }
      }));
    }
  };

  ws.onBinary = (chunk) => {
    chunksIn += 1;
    chunksOut += 1;
    ws.sendBinary(chunk);
  };
}

function handleProviderConnection(ws, { env, createPipeline, audioReplayIntervalMs }) {
  let chunks = [];
  let isRunning = false;
  let sessionID = "";

  ws.onText = (text) => {
    let message;
    try {
      message = decodeDeepResponseMessage(text);
    } catch (error) {
      sendError(ws, "bad_message", error);
      return;
    }

    if (message.type === DEEP_RESPONSE_EVENTS.SessionStart) {
      sessionID = message.sessionID || "";
      ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.SessionReady, {
        sessionID,
        mode: "provider",
        sampleRate: message.sampleRate || 16000
      }));
    } else if (message.type === DEEP_RESPONSE_EVENTS.BargeIn) {
      chunks = [];
      ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.AudioDone, {
        reason: "barge_in"
      }));
    } else if (message.type === DEEP_RESPONSE_EVENTS.InputStop && !isRunning) {
      isRunning = true;
      runProviderPipeline(ws, {
        chunks,
        env,
        createPipeline,
        audioReplayIntervalMs
      }).finally(() => {
        isRunning = false;
        chunks = [];
      });
    }
  };

  ws.onBinary = (chunk) => {
    if (!isRunning) {
      chunks.push(Buffer.from(chunk));
    }
  };
}

async function runProviderPipeline(ws, { chunks, env, createPipeline, audioReplayIntervalMs }) {
  try {
    const pipeline = createPipeline ? createPipeline() : createDefaultPipeline(env);
    const result = await pipeline.run({
      audioChunks: replayChunks(chunks, audioReplayIntervalMs)
    });
    ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.TranscriptFinal, {
      transcript: result.transcript
    }));
    ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.AssistantTextDelta, {
      delta: result.firstPhrase || result.responseText || ""
    }));
    for (const chunk of result.audioChunks || []) {
      ws.sendBinary(chunk);
    }
    ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.AudioDone, {
      reason: "provider_complete",
      audioByteLength: result.audioByteLength
    }));
    ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.Timing, {
      timing: result.timing,
      providerMeta: result.providerMeta
    }));
  } catch (error) {
    sendError(ws, "provider_pipeline_failed", error);
  }
}

async function* replayChunks(chunks, intervalMs) {
  let isFirst = true;
  for (const chunk of chunks || []) {
    if (!isFirst && intervalMs > 0) {
      await sleep(intervalMs);
    }
    isFirst = false;
    yield chunk;
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
    tts: new DoubaoTTSProvider({ env })
  });
}

function sendError(ws, code, error) {
  ws.sendText(encodeDeepResponseMessage(DEEP_RESPONSE_EVENTS.Error, {
    code,
    message: error instanceof Error ? error.message : String(error)
  }));
}

function sendJSON(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(body));
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
